import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {freshAdminDb} from './helpers/admin-db.mjs';
const dir=new URL('../supabase/migrations/',import.meta.url);const sql=n=>fs.readFileSync(new URL(n,dir),'utf8');let db;
const patch=sql('20261110222500_mail_archive_probe.sql');
const rpc=async(a,p={})=>(await db.query('select public.mail_archive($1,$2::jsonb) result',[a,JSON.stringify(p)])).rows[0].result;
test.beforeEach(async()=>{db=await freshAdminDb();await db.exec(sql('20261109000000_admin_mail.sql'));await db.exec(sql('20261110222424_mail_original_archive.sql'));await db.exec(patch);await db.exec('SET ROLE service_role');});
test.afterEach(async()=>await db?.close());
test('probe intents have no email/UI records, stay outside ordinary cleanup until bounded deadline, clean tozero',async()=>{
 const job=await rpc('probe_begin');assert.match(job.path,/^objects\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.eml$/);const row=(await db.query('select probe,delete_requested,settle_after>now()+interval \'4 minutes\' future from private.mail_archive_objects')).rows[0];assert.deepEqual(row,{probe:true,delete_requested:true,future:true});
 assert.deepEqual(await rpc('cleanup_list'),[]);assert.equal((await db.query('select count(*)::int n from public.email_messages')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.email_threads')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from private.mail_archive_jobs')).rows[0].n,0);
 assert.deepEqual(await rpc('probe_finish',{path:job.path}),{deleted:true});assert.equal((await rpc('status')).cleanupPending,0);
});
test('failed helper teardown remains cleanup eligible after5m; probe_finish cannot remove a real mail intent',async()=>{
 const probe=await rpc('probe_begin');await db.exec("UPDATE private.mail_archive_objects SET settle_after=now()-interval '1 second',next_cleanup_at=now()-interval '1 second' WHERE probe=true");assert.deepEqual(await rpc('cleanup_list'),[{path:probe.path}]);
 await db.query('UPDATE private.mail_archive_objects SET probe=false WHERE path=$1',[probe.path]);assert.deepEqual(await rpc('probe_finish',{path:probe.path}),{deleted:false});assert.equal((await rpc('status')).cleanupPending,1);
});
test('patch idempotence preserves service-only ACL and function identity',async()=>{
 const signature='public.mail_archive(text,jsonb)';const before=(await db.query('select $1::regprocedure::oid oid',[signature])).rows[0].oid;await db.exec('RESET ROLE');await db.exec(patch);assert.equal((await db.query('select $1::regprocedure::oid oid',[signature])).rows[0].oid,before);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(rpc('probe_begin'),/permission denied/);await db.exec('RESET ROLE');}
});
