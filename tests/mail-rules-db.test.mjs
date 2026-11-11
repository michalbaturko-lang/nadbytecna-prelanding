import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { startAdminServer } from './helpers/admin-server.mjs';
import { ADMIN, SESSION } from './helpers/admin-db.mjs';
const migration=fs.readFileSync(new URL('../supabase/migrations/20261111202111_mail_rule_labels.sql',import.meta.url),'utf8');
let s,db;
test.beforeEach(async()=>{s=await startAdminServer();db=s.db;await db.exec('SET ROLE service_role');await db.query('SELECT public.admin_access($1,$2,$3)',[ADMIN,'admin@example.invalid',SESSION]);});
test.afterEach(async()=>await s?.close());
const rpc=async(name,args=[],casts=[])=> (await db.query('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)+(casts[i]?'::'+casts[i]:'')).join(',')+') result',args)).rows[0].result;
const thread=async()=> (await db.query('SELECT * FROM public.email_threads LIMIT 1')).rows[0];
const pending=(version='rules-v1')=>rpc('mail_rules_pending',[25,version],['integer','text']);
const apply=async(labels=[{code:'newsletter',reason:'Hlavička hromadné zprávy.'}],disposition='normal',version='rules-v1',revision)=>{
 const t=await thread();return rpc('mail_rules_apply',[t.id,revision??t.revision,version,JSON.stringify(labels),disposition,'Ověřené pravidlo.'],['uuid','integer','text','jsonb','text','text']);
};
const manual=async(add=[],remove=[],disposition=null,revision)=>{
 const t=await thread();return rpc('mail_labels_manual',[t.id,revision??t.revision,add,remove,disposition,ADMIN,'admin@example.invalid'],['uuid','integer','text[]','text[]','text','uuid','text']);
};
const fields=async()=> (await db.query('SELECT private.mail_rules_fields($1) f',[(await thread()).id])).rows[0].f;
const list=(filters={})=>rpc('mail_list_sorted',[JSON.stringify(filters)],['jsonb']);

test('rule results are bounded, revision/version idempotent, auditable without content and replay preserves manual state',async()=>{
 const initial=(await pending()).jobs;assert.equal(initial.length,1);assert.equal(initial[0].message_count,1);assert.equal(initial[0].context_truncated,false);
 assert.equal((await apply()).applied,true);assert.equal((await pending()).jobs.length,0);
 assert.equal((await apply()).reason,'unchanged');
 const audit=(await db.query("SELECT diff FROM public.admin_audit_log WHERE action='mail_rules'")).rows;assert.equal(audit.length,1);assert.ok(!JSON.stringify(audit).includes('pisatelka'));
 await manual(['work'],['newsletter'],'normal');
 const before=await fields();await db.exec('RESET ROLE');await db.exec(migration);await db.exec('SET ROLE service_role');assert.deepEqual(await fields(),before);
 assert.equal((await pending('rules-v2')).jobs.length,1);
 const clean=new PGlite();try{await clean.exec(migration);}finally{await clean.close();}
});

test('manual label removal and restore take precedence across automatic reruns and fresh revisions',async()=>{
 await apply([{code:'spam',reason:'Ověřený blokovaný odesílatel.'},{code:'work',reason:'Téma práce.'}],'suspect');
 assert.equal((await fields()).disposition,'suspect');
 await manual(['legal'],['spam'],'normal');
 await apply([{code:'spam',reason:'Nová verze pravidla.'}],'suspect','rules-v2');
 let f=await fields();assert.equal(f.disposition,'normal');assert.equal(f.disposition_source,'manual');assert.deepEqual(f.labels.map(x=>x.code),['legal']);assert.equal(f.labels[0].source,'manual');
 await db.query('UPDATE public.email_threads SET revision=revision+1 WHERE id=$1',[(await thread()).id]);
 f=await fields();assert.equal(f.disposition,'normal');assert.deepEqual(f.labels.map(x=>x.code),['legal']);
 await apply([{code:'spam',reason:'Stejné pravidlo po odpovědi.'}],'suspect','rules-v2');
 assert.deepEqual((await fields()).labels.map(x=>x.code),['legal']);
 await manual([],[],'auto');assert.equal((await fields()).disposition,'suspect');
});

test('list, detail, filters and counts share effective labels/disposition; normal includes review and defaults stay all-visible',async()=>{
 await apply([{code:'work',reason:'Téma práce.'}],'review');
 assert.equal((await list()).total,1);assert.equal((await list({disposition:'normal'})).total,1);assert.equal((await list({disposition:'review'})).total,1);assert.equal((await list({disposition:'suspect'})).total,0);
 assert.equal((await list({label:'work'})).rows[0].labels[0].code,'work');assert.equal((await list({label:'legal'})).total,0);
 await manual([],[],'suspect');assert.equal((await list()).total,1);assert.equal((await list({disposition:'all'})).total,1);assert.equal((await list({disposition:'normal'})).total,0);assert.equal((await list({disposition:'suspect',label:'work'})).total,1);
 const t=await thread();const detail=await rpc('admin_mail',['detail',JSON.stringify({id:t.id,actor_id:ADMIN,actor_email:'admin@example.invalid'})],['text','jsonb']);assert.equal(detail.thread.disposition,'suspect');assert.equal(detail.thread.labels[0].code,'work');
 await assert.rejects(list({disposition:'invalid'}),/mail_filter/);await assert.rejects(list({label:'unknown'}),/mail_filter/);
});

test('stale automatic/manual results are rejected and erased records cannot be recreated',async()=>{
 const old=await thread();await db.query('UPDATE public.email_threads SET revision=revision+1 WHERE id=$1',[old.id]);
 assert.deepEqual(await apply(undefined,'suspect','rules-v1',old.revision),{applied:false,reason:'changed'});
 assert.deepEqual(await manual([],[],'suspect',old.revision),{saved:false,reason:'changed'});assert.equal((await fields()).disposition,'normal');
 await apply();await db.query('DELETE FROM public.email_threads WHERE id=$1',[old.id]);
 assert.equal((await db.query('SELECT count(*)::int n FROM private.mail_thread_labels')).rows[0].n,0);
 assert.deepEqual(await rpc('mail_rules_apply',[old.id,old.revision,'rules-v1','[]','suspect',''],['uuid','integer','text','jsonb','text','text']),{applied:false,reason:'missing'});
});

test('unknown labels, oversized payloads, forged identity and unsafe hide of incomplete/mixed threads are rejected or reviewed',async()=>{
 await assert.rejects(apply([{code:'unknown',reason:''}]),/mail_rules_label/);
 await assert.rejects(apply([{code:'work',reason:'x'.repeat(241)}]),/mail_rules_label/);
 await assert.rejects(apply([{code:'work',reason:'a'},{code:'work',reason:'b'}]),/mail_rules_label/);
 const t=await thread();await assert.rejects(rpc('mail_labels_manual',[t.id,t.revision,[],[],'suspect',ADMIN,'outsider@example.invalid'],['uuid','integer','text[]','text[]','text','uuid','text']),/mail_labels_identity/);
 await db.query('UPDATE public.email_messages SET body_truncated=true WHERE thread_id=$1',[t.id]);
 assert.equal((await pending()).jobs[0].context_truncated,true);await apply([],'suspect');assert.equal((await fields()).disposition,'review');
 await db.query('UPDATE public.email_messages SET body_truncated=false WHERE thread_id=$1',[t.id]);
 await db.query("INSERT INTO public.email_messages SELECT (jsonb_populate_record(NULL::public.email_messages,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'external_id','mixed-extra','body_text','Skutečná žádost o pomoc.'))).* FROM public.email_messages m WHERE m.thread_id=$1 LIMIT 1",[t.id]);
 await apply([],'suspect','mixed-v2');assert.equal((await fields()).disposition,'review');
 await db.query('UPDATE public.email_threads SET status=\'archived\' WHERE id=$1',[t.id]);assert.equal((await pending('new-version')).jobs.length,1);assert.equal((await apply([],'suspect','new-version')).applied,true);assert.equal((await thread()).status,'archived');
});

test('rule contexts bound newest messages and text while reporting omitted context',async()=>{
 const t=await thread();await db.query("UPDATE public.email_messages SET body_text=$2 WHERE thread_id=$1",[t.id,'x'.repeat(50000)]);
 const job=(await pending()).jobs[0];assert.equal(job.context_truncated,true);assert.ok(job.messages.reduce((n,m)=>n+m.subject.length+m.body_text.length+8,0)<=20000);
 assert.equal(job.messages[0].body_truncated,true);
 await assert.rejects(rpc('mail_rules_pending',[26,'v1'],['integer','text']),/mail_rules_invalid/);
});

test('label tables and every new RPC remain service-only with RLS and invoker functions',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('RESET ROLE');await db.exec('SET ROLE '+role);
  await assert.rejects(db.query('SELECT * FROM private.mail_thread_labels'),/permission denied/);
  await assert.rejects(db.query("SELECT public.mail_rules_pending(1,'v1')"),/permission denied/);
  await assert.rejects(db.query("SELECT public.mail_rules_apply(null,1,'v1','[]','normal','')"),/permission denied/);
  await assert.rejects(db.query("SELECT public.mail_labels_manual(null,1)"),/permission denied/);
 }
 await db.exec('RESET ROLE');const guards=(await db.query("SELECT proname,prosecdef FROM pg_proc WHERE proname IN('mail_rules_pending','mail_rules_apply','mail_labels_manual')")).rows;assert.equal(guards.length,3);assert.ok(guards.every(x=>x.prosecdef===false));
 const rls=(await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='private.mail_thread_labels'::regclass")).rows[0];assert.equal(rls.relrowsecurity,true);assert.equal(rls.relforcerowsecurity,true);
});


test('partial source erasure forgets label inferences and audits, preserves remaining content/status, and rejects queued pre-erasure results',async()=>{
 const original=await thread();
 await db.query("INSERT INTO public.email_messages SELECT (jsonb_populate_record(NULL::public.email_messages,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'external_id','privacy-other','sender_email','other@example.invalid','body_text','Jiná zbývající projektová zpráva.'))).* FROM public.email_messages m WHERE m.thread_id=$1 LIMIT 1",[original.id]);
 await db.query("UPDATE public.email_threads SET status='in_progress' WHERE id=$1",[original.id]);
 await apply([{code:'psychological_support',reason:'Odvozené citlivé téma.'}],'review');
 await manual(['psychological_support'],[],'normal');
 const snapshot=await thread();
 const exportedThread=await rpc('admin_mail',['thread_export',JSON.stringify({id:original.id,actor_id:ADMIN,actor_email:'admin@example.invalid'})],['text','jsonb']);
 assert.equal(exportedThread.threads[0].labels[0].code,'psychological_support');assert.equal(exportedThread.threads[0].labels[0].source,'manual');assert.equal(exportedThread.requires_review,false);
 const personExport=await rpc('admin_mail',['export',JSON.stringify({email:'pisatelka@example.invalid',actor_id:ADMIN,actor_email:'admin@example.invalid'})],['text','jsonb']);
 assert.equal(personExport.threads[0].labels[0].code,'psychological_support');assert.equal(personExport.requires_review,true);
 await db.query("DELETE FROM public.email_messages WHERE thread_id=$1 AND sender_email='pisatelka@example.invalid'",[original.id]);
 const remaining=await thread();assert.equal(remaining.status,'in_progress');assert.ok(remaining.revision>snapshot.revision);
 assert.equal((await db.query('SELECT count(*)::int n FROM public.email_messages WHERE thread_id=$1',[original.id])).rows[0].n,1);
 const f=await fields();assert.deepEqual(f.labels,[]);assert.equal(f.disposition_source,'default');assert.equal(remaining.manual_disposition,null);assert.equal(remaining.rules_version,null);
 assert.equal((await db.query("SELECT count(*)::int n FROM public.admin_audit_log WHERE entity_id=$1 AND action IN('mail_rules','mail_labels_manual')",[original.id])).rows[0].n,0);
 assert.deepEqual(await apply([{code:'psychological_support',reason:'Starý čekající výsledek.'}],'review','old-job',snapshot.revision),{applied:false,reason:'changed'});
 assert.equal((await pending()).jobs[0].messages[0].body_text,'Jiná zbývající projektová zpráva.');
});
