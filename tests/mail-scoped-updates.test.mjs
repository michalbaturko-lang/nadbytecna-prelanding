// PGlite has no safeupdate C extension: inspect actual function statements as a
// regression guard, then exercise all three affected paths with real SQL/RLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {freshAdminDb,ADMIN,SESSION} from './helpers/admin-db.mjs';
const dir=new URL('../supabase/migrations/',import.meta.url);
const sql=name=>fs.readFileSync(new URL(name,dir),'utf8');
const patch=()=>sql('20261110221500_mail_scoped_updates.sql');
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mailbox='veryvera@nadbytecna.cz';
const secret='synthetic-scoped-mail-hash-secret-longer-than-32';
const actor={actor_id:ADMIN,actor_email:'admin@example.invalid'};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
let db,legacy;
const definition=async signature=>(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signature])).rows[0].definition;
const updates=source=>[...source.matchAll(/UPDATE\s+private\.mail_sync_state\b[^;]*;/gi)].map(x=>x[0]);
test.beforeEach(async()=>{
 db=await freshAdminDb();await db.exec(sql('20261109000000_admin_mail.sql'));await db.exec(sql('20261110000000_mail_oauth.sql'));
 legacy=[await definition('public.mail_oauth(text,jsonb)'),await definition('public.admin_mail(text,jsonb)')];
 await db.exec(patch());await db.exec('SET ROLE service_role');
 await db.query("select public.admin_access($1,'admin@example.invalid',$2)",[ADMIN,SESSION]);
});
test.afterEach(async()=>await db?.close());
const oauth=async(action,payload={},asAdmin=true)=>(await db.query('select public.mail_oauth($1,$2::jsonb) result',[action,JSON.stringify({...asAdmin?actor:{},...payload})])).rows[0].result;
const connect=async(label)=>{
 await oauth('issue',{tenant_id:tenant,token_hash:hash('invite-'+label)});
 const pending=await oauth('begin',{token_hash:hash('invite-'+label),state_hash:hash('state-'+label),cookie_hash:hash('cookie-'+label),encrypted_flow:'synthetic-encrypted-flow'},false);
 const claimed=await oauth('callback_claim',{state_hash:hash('state-'+label),cookie_hash:hash('cookie-'+label)},false);
 assert.equal(claimed.attempt_id,pending.attempt_id);
 return oauth('save_connection',{attempt_id:claimed.attempt_id,ciphertext:'synthetic-encrypted-cache',account_id:'synthetic-home-account',tenant_id:tenant,mailbox},false);
};
const syncState=async()=>{
 await db.query(`INSERT INTO private.mail_sync_state(mailbox,folder,not_before,cursor,initial_complete,lease,lease_until,retry_after)
 VALUES($1,'inbox',now()-interval '30 days','synthetic-old-cursor',true,gen_random_uuid(),now()+interval '5 minutes',now()+interval '1 minute'),
 ($1,'archive',now()-interval '30 days','synthetic-old-archive-cursor',true,gen_random_uuid(),now()+interval '5 minutes',now()+interval '1 minute')`,[mailbox]);
};

test('all legacy unscoped statements are detected; patched definitions scope every affected UPDATE',async()=>{
 const originals=legacy.flatMap(updates);assert.equal(originals.length,3);assert.ok(originals.every(s=>!s.includes('WHERE')));
 const oauthUpdates=updates(await definition('public.mail_oauth(text,jsonb)'));
 const mailUpdates=updates(await definition('public.admin_mail(text,jsonb)'));
 assert.equal(oauthUpdates.length,2);assert.equal(mailUpdates.length,1);
 for(const statement of [...oauthUpdates,...mailUpdates]) assert.match(statement,/\bWHERE\s+mail_sync_state\.mailbox\s*=\s*(?:c\.mailbox|'veryvera@nadbytecna\.cz')/i);
});

test('scoped patch is idempotent and preserves existing function identities/security',async()=>{
 const before=(await db.query("select oid,proname,prosecdef,proacl::text acl from pg_proc where oid in ('public.mail_oauth(text,jsonb)'::regprocedure,'public.admin_mail(text,jsonb)'::regprocedure) order by proname")).rows;
 await db.exec('RESET ROLE');await db.exec(patch());await db.exec(patch());
 const after=(await db.query("select oid,proname,prosecdef,proacl::text acl from pg_proc where oid in ('public.mail_oauth(text,jsonb)'::regprocedure,'public.admin_mail(text,jsonb)'::regprocedure) order by proname")).rows;
 assert.deepEqual(after,before);assert.ok(after.every(f=>f.prosecdef===false));
});

test('OAuth save resets authorized mailbox cursors and leases after successful claimed exchange',async()=>{
 await syncState();assert.equal((await connect('save')).saved,true);
 const rows=(await db.query('select cursor,initial_complete,lease,lease_until,retry_after,not_before from private.mail_sync_state order by folder')).rows;
 assert.equal(rows.length,2);
 for(const r of rows){assert.equal(r.cursor,null);assert.equal(r.initial_complete,false);assert.equal(r.lease,null);assert.equal(r.lease_until,null);assert.equal(r.retry_after,null);assert.ok(new Date(r.not_before)<new Date());}
 assert.equal((await oauth('status',{},false)).connected,true);
});

test('clear and disconnect release authorized mailbox leases without erasing cursors',async()=>{
 await syncState();
 for(const action of ['clear','disconnect']){
  await connect(action);
  await db.query("update private.mail_sync_state set cursor='synthetic-retained-cursor',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes' where mailbox=$1",[mailbox]);
  await oauth(action);
  const rows=(await db.query('select cursor,lease,lease_until from private.mail_sync_state')).rows;
  for(const r of rows){assert.equal(r.cursor,'synthetic-retained-cursor');assert.equal(r.lease,null);assert.equal(r.lease_until,null);}
  assert.equal((await oauth('status',{},false)).connected,false);
 }
});

test('real retention path advances mailbox cutoff monotonically even with no messages',async()=>{
 await syncState();const cutoff=new Date(Date.now()-86400000).toISOString();
 const run=async when=>(await db.query('select public.admin_mail($1,$2::jsonb) result',['retention',JSON.stringify({...actor,cutoff:when,dry_run:false,hash_secret:secret})])).rows[0].result;
 const result=await run(cutoff);assert.equal(result.ok,true);assert.equal(result.messages_deleted,0);
 for(const r of (await db.query('select not_before from private.mail_sync_state')).rows) assert.equal(new Date(r.not_before).toISOString(),cutoff);
 await run(new Date(Date.now()-2*86400000).toISOString());
 for(const r of (await db.query('select not_before from private.mail_sync_state')).rows) assert.equal(new Date(r.not_before).toISOString(),cutoff);
});

test('replacing definitions preserves service-only RPC permissions',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('RESET ROLE');await db.exec('SET ROLE '+role);
  await assert.rejects(db.query("select public.mail_oauth('status','{}'::jsonb)"),/permission denied/);
  await assert.rejects(db.query("select public.admin_mail('status','{}'::jsonb)"),/permission denied/);
 }
 await db.exec('RESET ROLE');await db.exec('SET ROLE service_role');assert.equal((await oauth('status',{},false)).connected,false);
});
