import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import{freshAdminDb}from'./helpers/admin-db.mjs';
const sql=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const patch=sql('20261112184837_mail_transient_retry_recovery.sql');
let db;const rpc=async(a,p={})=>(await db.query('select public.mail_archive($1,$2::jsonb) d',[a,JSON.stringify(p)])).rows[0].d;
test.beforeEach(async()=>{db=await freshAdminDb();await db.exec(sql('20261109000000_admin_mail.sql'));await db.exec(sql('20261110222424_mail_original_archive.sql'));await db.exec(patch);await db.exec('SET ROLE service_role');await db.exec("INSERT INTO public.email_threads(id,mailbox,conversation_id) VALUES('11111111-1111-4111-8111-111111111111','veryvera@nadbytecna.cz','synthetic'); INSERT INTO public.email_messages(thread_id,mailbox,external_id,sender_email,subject,body_text,received_at,message_hash,sender_hash) VALUES('11111111-1111-4111-8111-111111111111','veryvera@nadbytecna.cz','synthetic','writer@example.invalid','synthetic','synthetic',now(),repeat('a',64),repeat('b',64));");});test.afterEach(async()=>db.close());
test('temporary failures remain durable past three attempts, back off and eventually finish',async()=>{
 for(let i=0;i<6;i++){const j=await rpc('claim');assert.ok(j);assert.ok((await db.query("select lease_until>now()+interval '4 minutes' ok from private.mail_archive_jobs")).rows[0].ok);await rpc('fail',{lease:j.lease,error:'timeout'});const row=(await db.query('select * from private.mail_archive_jobs')).rows[0];assert.equal(row.status,'pending');assert.ok(new Date(row.available_at)>new Date());await db.exec("UPDATE private.mail_archive_jobs SET available_at=now()-interval '1 second'");}
 const j=await rpc('claim');assert.ok(j);assert.equal((await rpc('finish',{lease:j.lease,size:128,sha256:'a'.repeat(64)})).saved,true);assert.equal((await rpc('status')).archived,1);
});
test('permanent errors stay visible; erasure blocks and public permissions are preserved',async()=>{
 let j=await rpc('claim');await rpc('fail',{lease:j.lease,error:'source_missing'});assert.equal((await rpc('status')).failed,1);await rpc('prepare_delete',{threadId:'11111111-1111-4111-8111-111111111111'});await db.exec('RESET ROLE');await db.exec(patch);assert.equal(await rpc('claim'),null);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(rpc('status'),/permission denied/);await db.exec('RESET ROLE');}
});
test('interrupted third lease is delayed for retry instead of dropped',async()=>{
 let j=await rpc('claim');await db.exec("UPDATE private.mail_archive_jobs SET attempts=3,lease_until=now()-interval '1 second'");assert.equal(await rpc('claim'),null);const s=await rpc('status');assert.equal(s.failed,0);assert.equal(s.pending,1);
});

test('provider throttling after repeated timeouts remains claimable after Retry-After',async()=>{
 let j=await rpc('claim');await db.exec('UPDATE private.mail_archive_jobs SET attempts=5');await rpc('fail',{lease:j.lease,error:'throttled',retry_after_seconds:60});await db.exec("UPDATE private.mail_archive_jobs SET available_at=now()-interval '1 second'");assert.ok(await rpc('claim'));
});
