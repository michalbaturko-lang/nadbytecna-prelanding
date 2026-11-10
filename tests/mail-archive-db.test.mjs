import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cleanupArchiveObjects,prepareArchiveErase,finishArchiveErase} from '../lib/mail-archive.mjs';
import {freshAdminDb,ADMIN,SESSION} from './helpers/admin-db.mjs';
const ARCHIVE_SECRET='synthetic-archive-suppression-secret-long32';
const dir=new URL('../supabase/migrations/',import.meta.url);
const sql=n=>fs.readFileSync(new URL(n,dir),'utf8');
const migration=sql('20261110222424_mail_original_archive.sql');
let db;
const rpc=async(a,p={})=>(await db.query('select public.mail_archive($1,$2::jsonb) result',[a,JSON.stringify(p)])).rows[0].result;
const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0];
const fixture=async({external='synthetic-id',thread=null,email='synthetic@example.invalid',body='Synthetic preview',received='2026-01-01'}={})=>{
 const tid=thread||(await scalar("INSERT INTO public.email_threads(mailbox,conversation_id) VALUES('veryvera@nadbytecna.cz',$1) RETURNING id",[external])).id;
 const row=await scalar("INSERT INTO public.email_messages(thread_id,mailbox,external_id,sender_email,subject,body_text,received_at,has_attachments,message_hash,sender_hash) VALUES($1,'veryvera@nadbytecna.cz',$2,$3,'Synthetic subject',$4,$5,true,repeat('a',64),repeat('b',64)) RETURNING id",[tid,external,email,body,received]);return {...row,thread:tid};
};
const finish=lease=>rpc('finish',{lease,size:128,sha256:'a'.repeat(64)});
test.beforeEach(async()=>{db=await freshAdminDb();await db.exec(sql('20261109000000_admin_mail.sql'));await db.exec(migration);await db.exec('SET ROLE service_role');});
test.afterEach(async()=>await db?.close());
test('private RLS/service-only RPC; migration preserves function and is idempotent',async()=>{
 const oid=await scalar("select 'public.mail_sync_commit(uuid,jsonb,jsonb,text,boolean,text)'::regprocedure::oid oid");
 await db.exec('RESET ROLE');await db.exec(migration);assert.deepEqual(await scalar("select 'public.mail_sync_commit(uuid,jsonb,jsonb,text,boolean,text)'::regprocedure::oid oid"),oid);
 for(const role of ['anon','authenticated']){
  await db.exec('SET ROLE '+role);await assert.rejects(rpc('status'),/permission denied/);await assert.rejects(db.query('select * from private.mail_archive_jobs'),/permission denied/);await db.exec('RESET ROLE');
 }
});
test('insert enqueue is atomic; identical update does not queue archived MIME again; attachment change does',async()=>{
 const m=await fixture();const job=await rpc('claim');assert.equal(job.id,m.id);assert.equal(job.revision,1);assert.match(job.path,/^objects\//);assert.equal((await rpc('active',{lease:job.lease})).active,true);
 assert.equal((await finish(job.lease)).saved,true);await db.query('UPDATE public.email_messages SET body_text=body_text WHERE id=$1',[m.id]);assert.equal(await rpc('claim'),null);
 await db.query('UPDATE public.email_messages SET source_change_key=$2 WHERE id=$1',[m.id,'synthetic-new-version']);assert.equal((await rpc('claim')).revision,2);
});
test('finish metadata persists; never raw payloads; archive list only exposes current completed path',async()=>{
 const m=await fixture();const job=await rpc('claim');await finish(job.lease);const row=(await rpc('list',{threadId:m.thread})).messages[0];assert.equal(row.status,'archived');assert.equal(row.size,128);assert.equal(row.hasAttachments,true);assert.equal(row.sha256,'a'.repeat(64));assert.equal(row.path,job.path);
 assert.equal((await rpc('status')).archived,1);assert.equal((await rpc('list',{id:m.id})).messages.length,1);
});
test('revision invalidates stale result; previous object intent remains cleanup discoverable',async()=>{
 const m=await fixture();const old=await rpc('claim');await db.query('UPDATE public.email_messages SET body_text=$2 WHERE id=$1',[m.id,'Synthetic updatedpreview']);assert.equal((await finish(old.lease)).saved,false);
 assert.deepEqual(await rpc('cleanup_list'),[{path:old.path}]);const next=await rpc('claim');assert.equal(next.revision,2);await finish(next.lease);assert.equal((await rpc('status')).archived,1);
});
test('bounded attempts, crash recovery, explicit oversize and error sanitization',async()=>{
 await fixture();let job=await rpc('claim');await rpc('fail',{lease:job.lease,error:'secret-real-body-must-not-persist'});assert.equal((await scalar('select error from private.mail_archive_jobs')).error,'archive_failed');assert.equal(await rpc('claim'),null);
 await db.exec("UPDATE private.mail_archive_jobs SET available_at=now()-interval '1 second' WHERE status='pending'");job=await rpc('claim');await db.exec("UPDATE private.mail_archive_jobs SET lease_until=now()-interval '1 second' WHERE status='processing'");job=await rpc('claim');assert.ok(job);await db.exec("UPDATE private.mail_archive_jobs SET lease_until=now()-interval '1 second' WHERE status='processing'");assert.equal(await rpc('claim'),null);assert.equal((await rpc('status')).failed,1);
 await fixture({external:'synthetic-oversized'});job=await rpc('claim');await rpc('fail',{lease:job.lease,error:'response_too_large'});assert.equal((await rpc('status')).failed,2);
});
test('person erasure blocks whole-thread originals and future messages, cascades jobs but preserves late-upload tombstones',async()=>{
 const a=await fixture({email:'target@example.invalid'});const b=await fixture({external:'synthetic-other',thread:a.thread,email:'other@example.invalid'});const active=await rpc('claim');
 await rpc('prepare_delete',{email:'target@example.invalid',hash_secret:ARCHIVE_SECRET});assert.equal((await rpc('active',{lease:active.lease})).active,false);assert.equal((await finish(active.lease)).saved,false);assert.equal((await rpc('status')).blocked,2);
 await fixture({external:'synthetic-future',thread:a.thread});assert.equal((await rpc('status')).blocked,3);assert.equal(await rpc('claim'),null);
 await db.query('DELETE FROM public.email_threads WHERE id=$1',[a.thread]);assert.equal((await rpc('status')).blocked,0);assert.deepEqual(await rpc('cleanup_list'),[{path:active.path}]);
 await rpc('cleanup_done',{path:active.path});assert.equal((await scalar('select count(*)::int n from private.mail_archive_objects')).n,1);assert.deepEqual(await rpc('cleanup_list'),[]);
 await db.exec("UPDATE private.mail_archive_objects SET settle_after=now()-interval '1 second',next_cleanup_at=now()-interval '1 second' WHERE delete_requested");assert.deepEqual(await rpc('cleanup_list'),[{path:active.path}]);await rpc('cleanup_done',{path:active.path});assert.equal((await scalar('select count(*)::int n from private.mail_archive_objects')).n,0);
});
test('retention delete trigger marks archived objects even when caller crashes before cleanup',async()=>{
 const m=await fixture();const job=await rpc('claim');await finish(job.lease);await db.query('DELETE FROM public.email_messages WHERE id=$1',[m.id]);assert.deepEqual(await rpc('cleanup_list'),[{path:job.path}]);assert.equal((await rpc('status')).archived,0);
});
test('orphan upload intents are reclaimed after their maximum worker lifetime',async()=>{
 await fixture();const job=await rpc('claim');await db.exec("UPDATE private.mail_archive_objects SET settle_after=now()-interval '1 second' WHERE path IS NOT NULL");assert.deepEqual(await rpc('cleanup_list'),[{path:job.path}]);assert.equal((await finish(job.lease)).saved,false);
});
test('mail_sync_commit stores metadata and queue in the same transaction as cursor; invalid page rolls back',async()=>{
 const secret='synthetic-long-mail-secret-at-least32characters';
 const state=(await db.query("select public.mail_sync_claim('veryvera@nadbytecna.cz','inbox','1970-01-01') result")).rows[0].result;
 const messages=[{external_id:'synthetic-sync',conversation_id:'synthetic-sync',sender_email:'synthetic@example.invalid',received_at:'2026-01-01',body_text:'Synthetic boundedpreview',has_attachments:true,body_truncated:true,source_change_key:'synthetic-change'}];
 await db.query('select public.mail_sync_commit($1,$2::jsonb,\'[]\'::jsonb,$3,true,$4)',[state.lease,JSON.stringify(messages),'synthetic-cursor',secret]);
 const m=await scalar('select has_attachments,body_truncated,source_change_key from public.email_messages');assert.deepEqual(m,{has_attachments:true,body_truncated:true,source_change_key:'synthetic-change'});assert.equal((await rpc('status')).pending,1);
 const next=(await db.query("select public.mail_sync_claim('veryvera@nadbytecna.cz','inbox','1970-01-01') result")).rows[0].result;
 const mixed=[{...messages[0],external_id:'synthetic-valid-before-bad',conversation_id:'synthetic-second'}, {...messages[0],external_id:'synthetic-invalid-body',body_text:'x'.repeat(100001)}];
 await assert.rejects(db.query('select public.mail_sync_commit($1,$2::jsonb,\'[]\'::jsonb,$3,true,$4)',[next.lease,JSON.stringify(mixed),'synthetic-must-not-advance',secret]),/mail_message_input/);
 assert.equal((await scalar('select count(*)::int n from public.email_messages')).n,1);
 assert.equal((await rpc('status')).pending,1);
 assert.equal((await scalar('select cursor from private.mail_sync_state')).cursor,'synthetic-cursor');
});

test('restrictive private bucket policy defeats broad legacy SELECT/INSERT for both browser roles',async()=>{
 await db.exec('RESET ROLE');
 await db.exec("GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO service_role,anon,authenticated; CREATE POLICY legacy_broad_storage ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true); INSERT INTO storage.objects(bucket_id,name) VALUES('mail-originals','synthetic.eml'),('other-bucket','synthetic.txt')");
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);assert.equal((await db.query("SELECT name FROM storage.objects WHERE bucket_id='mail-originals'")).rows.length,0);await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('mail-originals','forbidden.eml')"),/row-level security/);assert.equal((await db.query("SELECT name FROM storage.objects WHERE bucket_id='other-bucket'")).rows.length,1);await db.exec('RESET ROLE');}
 await db.exec('SET ROLE service_role');assert.equal((await db.query("SELECT name FROM storage.objects WHERE bucket_id='mail-originals'")).rows.length,1);
});
const intents=async(m,count)=>db.query(`INSERT INTO private.mail_archive_objects(path,message_id,thread_id,lease,revision,settle_after,uploaded_at)
 SELECT 'objects/'||$1::text||'/'||g.lease::text||'.eml',$1::uuid,$2::uuid,g.lease,1,now()-interval '1 second',now() FROM(SELECT gen_random_uuid() lease FROM generate_series(1,$3))g`,[m.id,m.thread,count]);
test('scope cleanup drains over100 originals despite unrelated older global backlog',async()=>{
 const target=await fixture();const unrelated=await fixture({external:'synthetic-unrelated'});await intents(target,101);await intents(unrelated,101);await rpc('prepare_delete',{threadId:unrelated.thread});
 const batches=[];const cleanup=args=>cleanupArchiveObjects({...args,removeBatch:async paths=>batches.push(paths)});
 const prepared=await prepareArchiveErase({threadId:target.thread},{call:rpc,cleanup});assert.equal(prepared.blocked,1);assert.deepEqual(prepared.scope.messageIds,[target.id]);assert.deepEqual(prepared.scope.threadIds,[target.thread]);assert.deepEqual(batches.map(x=>x.length),[100,1]);
 assert.equal((await scalar('SELECT count(*)::int n FROM private.mail_archive_objects WHERE thread_id=$1',[target.thread])).n,0);assert.equal((await scalar('SELECT count(*)::int n FROM private.mail_archive_objects WHERE thread_id=$1',[unrelated.thread])).n,101);
});
test('active upload settlement or scope above bounded300 remains explicitly pending with metadata retained',async()=>{
 const target=await fixture();await rpc('claim');const cleanup=args=>cleanupArchiveObjects({...args,removeBatch:async()=>{}});
 await assert.rejects(prepareArchiveErase({threadId:target.thread},{call:rpc,cleanup}),e=>e.code==='mail_archive_cleanup_pending'&&e.status===409);assert.equal((await scalar('select count(*)::int n from public.email_messages')).n,1);
 await db.exec("DELETE FROM private.mail_archive_objects WHERE path IS NOT NULL");await intents(target,301);
 await assert.rejects(prepareArchiveErase({threadId:target.thread},{call:rpc,cleanup}),e=>e.code==='mail_archive_cleanup_pending');assert.equal((await scalar('select count(*)::int n from private.mail_archive_objects')).n,1);
});
test('provider throttling delay takes precedence over local retry backoff',async()=>{
 await fixture();const job=await rpc('claim');await rpc('fail',{lease:job.lease,error:'throttled',retry_after_seconds:3600});assert.equal((await scalar("select available_at>=now()+interval '59 minutes' ok from private.mail_archive_jobs")).ok,true);assert.equal((await scalar('select attempts from private.mail_archive_jobs')).attempts,0);
});

test('failed jobs can be explicitly retried without reviving GDPR-blocked messages',async()=>{const m=await fixture();const job=await rpc('claim');await rpc('fail',{lease:job.lease,error:'source_missing'});assert.equal((await rpc('retry',{id:m.id})).queued,true);assert.ok(await rpc('claim'));await rpc('prepare_delete',{threadId:m.thread});assert.equal((await rpc('retry',{id:m.id})).queued,false);});

test('finish rejects missing or zero size without publishing an archived result',async()=>{await fixture();const job=await rpc('claim');await assert.rejects(rpc('finish',{lease:job.lease,sha256:'a'.repeat(64)}),/mail_archive_input/);await assert.rejects(rpc('finish',{lease:job.lease,size:0,sha256:'a'.repeat(64)}),/mail_archive_input/);assert.equal((await rpc('status')).archived,0);assert.equal((await rpc('active',{lease:job.lease})).active,true);});

test('finish uses actual deleted IDs and whole participant threads after preparation, ignores unrelated101 tombstones',async()=>{
 const target=await fixture({email:'erase-target@example.invalid'});await intents(target,1);
 const unrelated=await fixture({external:'synthetic-unrelated-backlog'});await intents(unrelated,101);await rpc('prepare_delete',{threadId:unrelated.thread});
 const batches=[];const cleanup=args=>cleanupArchiveObjects({...args,removeBatch:async paths=>batches.push(paths)});
 const prepared=await prepareArchiveErase({email:'erase-target@example.invalid',hash_secret:ARCHIVE_SECRET},{call:rpc,cleanup});
 // This new conversation did not exist during preparation. Its other sender's
 // original can quote the participant and must also be blocked and removed.
 const late=await fixture({external:'synthetic-late-target',email:'erase-target@example.invalid'});
 const quoted=await fixture({external:'synthetic-late-quoted',thread:late.thread,email:'other@example.invalid'});await intents(late,1);await intents(quoted,1);
 await db.query("select public.admin_access($1,'admin@example.invalid',$2)",[ADMIN,SESSION]);
 const erased=(await db.query("select public.admin_mail('erase',$1::jsonb) result",[JSON.stringify({email:'erase-target@example.invalid',hash_secret:ARCHIVE_SECRET,actor_id:ADMIN,actor_email:'admin@example.invalid'})])).rows[0].result;
 assert.ok(erased.archive_scope.messageIds.includes(late.id));assert.ok(erased.archive_scope.threadIds.includes(late.thread));
 assert.equal((await scalar('SELECT count(*)::int n FROM public.email_messages WHERE id=$1',[late.id])).n,0);
 assert.equal((await scalar('SELECT status FROM private.mail_archive_jobs WHERE message_id=$1',[quoted.id])).status,'blocked');
 assert.deepEqual(await finishArchiveErase(prepared,erased,{call:rpc,cleanup}),{complete:true});
 assert.equal((await scalar('SELECT count(*)::int n FROM private.mail_archive_objects WHERE thread_id=$1',[late.thread])).n,0);
 assert.equal((await scalar('SELECT count(*)::int n FROM private.mail_archive_objects WHERE thread_id=$1',[unrelated.thread])).n,101);
});

test('person and retention retries rediscover durable pending originals after source rows disappear',async()=>{
 for(const action of ['erase','retention']){
  const email=action+'-retry@example.invalid';const scope=action==='erase'?{email,hash_secret:ARCHIVE_SECRET}:{cutoff:'2026-02-01'};
  const target=await fixture({external:'synthetic-'+action+'-before',email,received:'2026-01-01'});
  const cleanup=args=>cleanupArchiveObjects({...args,removeBatch:async()=>{}});
  const prepared=await prepareArchiveErase(scope,{call:rpc,cleanup});
  const late=await fixture({external:'synthetic-'+action+'-late',email,received:'2026-01-02'});const job=await rpc('claim');assert.equal(job.id,late.id);
  await db.query("select public.admin_access($1,'admin@example.invalid',$2)",[ADMIN,SESSION]);
  const payload={...scope,dry_run:false,hash_secret:ARCHIVE_SECRET,actor_id:ADMIN,actor_email:'admin@example.invalid'};
  const erased=(await db.query('select public.admin_mail($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
  await assert.rejects(finishArchiveErase(prepared,erased,{call:rpc,cleanup}),e=>e.code==='mail_archive_cleanup_pending');
  assert.equal((await scalar('select count(*)::int n from public.email_messages WHERE id=ANY($1::uuid[])',[[target.id,late.id]])).n,0);
  await assert.rejects(prepareArchiveErase(scope,{call:rpc,cleanup}),e=>e.code==='mail_archive_cleanup_pending');
  const saved=await db.query('SELECT scope_key,message_ids,thread_ids FROM private.mail_archive_erasure_scopes');assert.ok(saved.rows.length>0);assert.equal(JSON.stringify(saved.rows).includes(email),false);
  await db.exec("UPDATE private.mail_archive_objects SET settle_after=now()-interval '1 second',next_cleanup_at=now()-interval '1 second' WHERE delete_requested");
  const retry=await prepareArchiveErase(scope,{call:rpc,cleanup});assert.ok(retry.scope.messageIds.includes(late.id));
  assert.equal((await scalar('select count(*)::int n from private.mail_archive_erasure_scopes')).n,0);
  assert.equal((await rpc('cleanup_pending',retry.scope)).pending,0);
 }
});
