import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { freshAdminDb, ADMIN } from "./helpers/admin-db.mjs";
const sql = (name) => fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const MAIL_SQL=sql('20261109000000_admin_mail.sql');
const QUEUE_SQL=sql('20261110211204_mail_ai_queue.sql');
const secret='synthetic-queue-hash-secret-at-least-32-characters';
const mailbox='veryvera@nadbytecna.cz';
const ago=(n)=>new Date(Date.now()-n*86400000).toISOString();
const defaultReceived=ago(1);
const message=(id='m1',extra={})=>({external_id:id,conversation_id:'thread-one',sender_email:'sender@example.invalid',subject:'Syntetický předmět',body_text:'Výhradně smyšlená žádost o pomoc.',received_at:defaultReceived,...extra});
const output={summary:'Syntetická žádost o pomoc.',category:'pravni',urgency:'high',email_type:'story',help_type:'Prověřit potřeby.',model:'synthetic-model'};
let db;
test.beforeEach(async()=>{db=await freshAdminDb();await db.exec(MAIL_SQL);await db.exec(QUEUE_SQL);await db.exec('SET ROLE service_role');});
test.afterEach(async()=>await db?.close());
const jsonRpc=async(name,args=[],types=[])=>{
 const q='SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)+(types[i]?'::'+types[i]:'')).join(',')+') result';
 return (await db.query(q,args)).rows[0].result;
};
const sync=async(messages,removed=[])=>{
 const s=await jsonRpc('mail_sync_claim',[mailbox,'inbox',ago(90)]);
 return jsonRpc('mail_sync_commit',[s.lease,JSON.stringify(messages),JSON.stringify(removed),'opaque-synthetic-cursor',true,secret],['uuid','jsonb','jsonb','text','boolean','text']);
};
const admin=async(action,payload={})=>jsonRpc('admin_mail',[action,JSON.stringify({actor_id:ADMIN,actor_email:'admin@example.invalid',...payload})],['text','jsonb']);
const claim=()=>jsonRpc('mail_ai_claim');
const finish=(lease,out=output,error=false)=>jsonRpc('mail_ai_finish',[lease,JSON.stringify(out),error],['uuid','jsonb','boolean']);
const row=async()=> (await db.query('select * from public.email_threads order by id limit 1')).rows[0];
const job=async()=> (await db.query('select * from private.mail_ai_jobs order by thread_id limit 1')).rows[0];
const due=()=>db.exec("update private.mail_ai_jobs set available_at=now()-interval '1 second'");
const expire=()=>db.exec("update private.mail_ai_jobs set lease_until=now()-interval '1 second'");

test('queue migration is idempotent, guarded on clean DB, and backfills only eligible local mirrors',async()=>{
 await sync([message()]);
 const first=await claim();
 await db.exec('RESET ROLE');await db.exec(QUEUE_SQL);await db.exec('SET ROLE service_role');
 assert.equal((await job()).lease,first.lease);assert.equal((await job()).attempts,1);
 const clean=new PGlite();try{await clean.exec(QUEUE_SQL);}finally{await clean.close();}
 await db.exec('DELETE FROM private.mail_ai_jobs');
 await db.exec('RESET ROLE');await db.exec(QUEUE_SQL);await db.exec('SET ROLE service_role');
 assert.equal((await job()).revision,(await row()).revision);
 const guard=(await db.query("select pg_get_triggerdef(oid) definition from pg_trigger where tgname='mail_ai_source_lock'")).rows[0].definition;
 assert.match(guard,/BEFORE UPDATE OF source_removed_at/);
 assert.match(guard,/FOR EACH STATEMENT/);
});

test('anon and authenticated cannot read queue/context or execute worker RPCs',async()=>{
 await sync([message()]);const id=(await row()).id;
 for(const role of ['anon','authenticated']){
  await db.exec('RESET ROLE');await db.exec('SET ROLE '+role);
  for(const query of ['select * from private.mail_ai_jobs','select public.mail_ai_claim()',"select public.mail_ai_finish(null,'{}',false)",'select public.mail_ai_status()',`select public.mail_ai_snapshot('${id}')`])
   await assert.rejects(db.query(query),/permission denied/);
 }
});

test('new/changed imports enqueue one revision; exact replay never resets a lease or retries',async()=>{
 await sync([message()]);const first=await claim();assert.equal(first.id,(await row()).id);assert.equal(first.revision,(await row()).revision);assert.equal(first.messages[0].body_text,message().body_text);
 await sync([message()]);assert.equal((await job()).lease,first.lease);assert.equal((await job()).attempts,1);assert.equal(await claim(),null);
 await sync([message('m1',{body_text:'Nová smyšlená verze zprávy.'})]);
 assert.equal((await job()).attempts,0);assert.equal((await job()).lease,null);
 assert.equal((await finish(first.lease)).saved,false);
 const second=await claim();assert.ok(second.revision>first.revision);assert.ok(second.messages[0].body_text.includes('Nová'));
});

test('automatic success preserves human classification/status and audits metadata only',async()=>{
 await sync([message()]);const id=(await row()).id;
 await admin('mutate',{id,patch:{admin_category:'terapie',admin_urgency:'low',email_type:'help',status:'contacted'}});
 const first=await claim();assert.equal((await finish(first.lease)).saved,true);
 const saved=await row();assert.equal(saved.ai_summary,output.summary);assert.equal(saved.admin_category,'terapie');assert.equal(saved.admin_urgency,'low');assert.equal(saved.admin_email_type,'help');assert.equal(saved.status,'contacted');assert.equal((await job()).done,true);assert.equal(await claim(),null);
 const audit=JSON.stringify((await db.query("select diff from admin_audit_log where action='mail_ai_automatic'")).rows);
 assert.ok(!audit.includes(message().body_text));assert.ok(!audit.includes(output.summary));assert.ok(!audit.includes('sender@example.invalid'));
 assert.deepEqual(await jsonRpc('mail_ai_status'),{queued:0,processing:0,failed:0,completed:1});
});

test('manual AI success cancels in-flight automatic result and failure without downgrading it',async()=>{
 await sync([message()]);const automatic=await claim();const id=automatic.id;
 await admin('ai_save',{id,revision:automatic.revision,...output,summary:'Ručně vyžádaný nový výsledek.',error:false});
 assert.equal((await job()).done,true);assert.equal((await finish(automatic.lease)).saved,false);assert.equal((await finish(automatic.lease,{},true)).saved,false);
 assert.equal((await row()).ai_summary,'Ručně vyžádaný nový výsledek.');assert.equal((await row()).ai_error,null);
});

test('failure backs off and stops after three attempts; expired crashes have the same cap',async()=>{
 await sync([message()]);
 for(let i=1;i<=3;i++){
  const next=await claim();assert.ok(next);assert.equal((await finish(next.lease,{},true)).saved,true);assert.equal((await job()).attempts,i);assert.equal(await claim(),null);await due();
 }
 assert.equal(await claim(),null);assert.equal((await job()).done,true);assert.equal((await row()).ai_error,'classification_failed');assert.equal((await jsonRpc('mail_ai_status')).failed,1);
 await sync([message('m1',{body_text:'Změněná smyšlená zpráva po selhání.'})]);
 let previous;
 for(let i=1;i<=3;i++){
  const next=await claim();assert.ok(next);if(previous)assert.equal((await finish(previous)).saved,false);previous=next.lease;await expire();
 }
 assert.equal(await claim(),null);assert.equal((await job()).attempts,3);assert.equal((await job()).last_error,'retries_exhausted');
});

test('expired result is rejected and a fresh ticket is issued without duplicate concurrent claim',async()=>{
 await sync([message()]);const first=await claim();assert.equal(await claim(),null);await expire();
 assert.equal((await finish(first.lease)).saved,false);const second=await claim();assert.notEqual(second.lease,first.lease);assert.equal((await finish(second.lease)).saved,true);
});

test('source removal invalidates results, excludes content, and identical restoration enqueues again',async()=>{
 const newer=message('m2',{received_at:ago(0.5),body_text:'Novější smyšlená zpráva.'});
 await sync([message('m1'),newer]);const initial=await claim();
 await sync([],['m2']);assert.equal((await finish(initial.lease)).saved,false);
 const afterRemove=await claim();assert.equal(afterRemove.messages.length,1);assert.equal(afterRemove.messages[0].body_text,message().body_text);
 await sync([],['m2']);assert.equal((await job()).lease,afterRemove.lease);
 await sync([newer]);assert.equal((await finish(afterRemove.lease)).saved,false);
 const restored=await claim();assert.ok(restored.revision>afterRemove.revision);assert.equal(restored.messages.length,2);
 await sync([],['m1','m2']);assert.equal((await finish(restored.lease)).saved,false);assert.equal(await claim(),null);assert.equal((await row()).ai_summary,null);
});

test('thread GDPR erasure cascades the queue and late results never recreate mail',async()=>{
 await sync([message()]);const active=await claim();await admin('thread_erase',{id:active.id,hash_secret:secret});
 assert.equal((await finish(active.lease)).saved,false);assert.equal((await db.query('select count(*)::int n from private.mail_ai_jobs')).rows[0].n,0);assert.equal(await row(),undefined);
 await sync([message()]);assert.equal(await claim(),null);
});

test('partial sender erasure and retention invalidate snapshots and keep only remaining context',async()=>{
 await sync([message('m1',{received_at:ago(4)}),message('m2',{sender_email:'other@example.invalid',received_at:ago(1),body_text:'Jiný syntetický odesílatel.'})]);
 const before=await claim();await admin('erase',{email:'sender@example.invalid',hash_secret:secret});assert.equal((await finish(before.lease)).saved,false);
 const after=await claim();assert.equal(after.messages.length,1);assert.equal(after.messages[0].body_text,'Jiný syntetický odesílatel.');
 await admin('retention',{cutoff:ago(0.5),dry_run:false,hash_secret:secret});assert.equal((await finish(after.lease)).saved,false);assert.equal(await claim(),null);
});

test('snapshot and claim share bounded latest context; archive cancels and unarchive requeues',async()=>{
 const messages=Array.from({length:40},(_,i)=>message('context-'+i,{subject:'subject-'+i,body_text:'x'.repeat(10000)+i,received_at:ago(40-i)}));
 await sync(messages);const id=(await row()).id;const snapshot=await jsonRpc('mail_ai_snapshot',[id],['uuid']);
 assert.ok(snapshot.messages.length<=30);assert.equal(snapshot.messages.at(-1).subject,'subject-39');
 assert.ok(snapshot.messages.reduce((sum,m)=>sum+m.subject.length+m.body_text.length+8,0)<=20000);
 const active=await claim();assert.deepEqual(active.messages,snapshot.messages);
 await admin('mutate',{id,patch:{status:'archived'}});assert.equal((await finish(active.lease)).saved,false);assert.equal(await claim(),null);
 await admin('mutate',{id,patch:{status:'new'}});assert.ok(await claim());
});

test('invalid model output rolls back safely; failure can release the same lease',async()=>{
 await sync([message()]);const active=await claim();
 for(const invalid of [{...output,urgency:'invalid'},{...output,summary:''},{...output,category:'nonexistent'},{...output,model:5}]) await assert.rejects(finish(active.lease,invalid),/mail_ai|mail_category/);
 assert.equal((await row()).ai_summary,null);assert.equal((await job()).lease,active.lease);
 assert.equal((await finish(active.lease,{},true)).saved,true);
});


test('manual acute/high take priority, then fresh replies outrank an old import backlog',async()=>{
 await sync([
  message('plain-old',{conversation_id:'plain-old',received_at:ago(30)}),
  message('reply-old',{conversation_id:'reply-thread',received_at:ago(40)}),
  message('acute-old',{conversation_id:'acute-thread',received_at:ago(60)}),
  message('high-old',{conversation_id:'high-thread',received_at:ago(50)}),
  message('low-old',{conversation_id:'low-thread',received_at:ago(45)}),
 ]);
 const ids=Object.fromEntries((await db.query('select conversation_id,id from public.email_threads')).rows.map(x=>[x.conversation_id,x.id]));
 await admin('mutate',{id:ids['acute-thread'],patch:{admin_urgency:'acute'}});
 await admin('mutate',{id:ids['high-thread'],patch:{admin_urgency:'high'}});
 await admin('mutate',{id:ids['low-thread'],patch:{admin_urgency:'low'}});
 await sync([message('fresh-reply',{conversation_id:'reply-thread',received_at:ago(0.1),body_text:'Nová smyšlená odpověď do staršího vlákna.'})]);
 for(const expected of ['acute-thread','high-thread','reply-thread','plain-old','low-thread']) {
  const next=await claim();assert.equal(next.id,ids[expected],expected);
  assert.equal((await finish(next.lease)).saved,true);
 }
 assert.equal(await claim(),null);
});
