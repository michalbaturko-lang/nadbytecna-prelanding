import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{unzipSync,strFromU8}from'fflate';
import{startAdminServer,token,otherToken}from'./helpers/admin-server.mjs';import{runMailArchive}from'../lib/mail-archive.mjs';
let s,threadId,messageId,objectPath;
const bytes=Buffer.from('From: synthetic@example.invalid\r\nTo: project@example.invalid\r\nSubject: Synthetic archive integration\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOnly synthetic bytes.\r\n');
const sha256=createHash('sha256').update(bytes).digest('hex');
test.before(async()=>{s=await startAdminServer();const row=(await s.db.query('select id,thread_id from public.email_messages limit 1')).rows[0];messageId=row.id;threadId=row.thread_id;});
test.after(async()=>await s?.close());
const call=(body,t=token,path='/api/admin-mail/')=>s.fetch(s.url+path,{method:'POST',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify(body)});
const rpc=async(action,payload={})=>(await s.db.query('select public.mail_archive($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
test('private original backup uses real queue/SQL and preserves exactly the synthetic bytes',async()=>{
 const before=await(await call({action:'status'})).json();assert.equal(before.originals.pending,1);assert.equal(before.archiveEnabled,false);
 assert.equal((await call({action:'archive_download',id:messageId})).status,409);
 const result=await runMailArchive({env:{M365_AUTH_MODE:'certificate',M365_INGEST_ENABLED:'true',M365_MAIL_ARCHIVE_ENABLED:'true'},call:rpc,getToken:async()=>({accessToken:'synthetic-access'}),read:async()=>({enabled:true,bytes,size:bytes.length,sha256}),put:async(path,data)=>{objectPath=path;s.storage.set(path,Buffer.from(data));}});
 assert.equal(result.archived,1);assert.equal(result.processed,1);assert.deepEqual(s.storage.get(objectPath),bytes);
 const detail=await(await call({action:'detail',id:threadId})).json();assert.equal(detail.originals.messages[0].status,'archived');assert.equal(detail.originals.messages[0].sha256,sha256);assert.equal('path' in detail.originals.messages[0],false);
});
test('only authorized admins obtain short-lived download URLs and original bytes appear in person ZIP',async()=>{
 for(const t of ['',otherToken])assert.equal((await call({action:'archive_download',id:messageId},t)).status,t?403:401);
 const download=await(await call({action:'archive_download',id:messageId})).json();assert.equal(download.expires_in,60);assert.equal(download.sha256,sha256);assert.equal(download.size,bytes.length);assert.match(download.url,/\/storage\/v1\/object\/sign\/mail-originals\//);
 const sender=(await s.db.query('select sender_email from public.email_messages where id=$1',[messageId])).rows[0].sender_email;
 const response=await call({action:'person_export',email:sender},token,'/api/admin/');assert.equal(response.status,200);
 const files=unzipSync(new Uint8Array(await response.arrayBuffer()));const original=files['originaly/'+messageId+'.eml'];assert.ok(original);assert.deepEqual(Buffer.from(original),bytes);
 const manifest=JSON.parse(strFromU8(files['data.json']));assert.ok(!JSON.stringify(manifest).includes('token=offline'));assert.ok(JSON.stringify(manifest).includes(sha256));
 const outsider=await call({action:'person_export',email:sender},otherToken,'/api/admin/');assert.equal(outsider.status,403);
});
test('batch integrity check verifies stored bytes, detects corruption and exposes no private paths',async()=>{
 for(const t of ['',otherToken])assert.equal((await call({action:'archive_verify_batch'},t)).status,t?403:401);
 assert.equal((await call({action:'archive_verify_batch',after:'not-a-uuid'})).status,400);
 let r=await call({action:'archive_verify_batch'});assert.equal(r.status,200);let d=await r.json();assert.deepEqual(d,{checked:1,failed:0,pending:0,next:null});
 s.storage.set(objectPath,Buffer.alloc(bytes.length));d=await(await call({action:'archive_verify_batch'})).json();assert.equal(d.failed,1);assert.equal(d.checked,0);s.storage.set(objectPath,bytes);
 assert.ok(!JSON.stringify(d).includes('objects/'));assert.equal((await rpc('status')).archived,1);
});
test('thread erasure removes source, queue and private object; other-scope pending cleanup does not block it',async()=>{
 await s.db.query("insert into private.mail_archive_objects(path,message_id,thread_id,lease,revision,delete_requested,settle_after,next_cleanup_at) values('objects/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.eml','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',1,true,now()+interval '10 minutes',now()+interval '10 minutes')");
 const response=await call({action:'erase',id:threadId,confirm:'SMAZAT'});assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal('archive_scope' in result,false);
 assert.equal((await s.db.query('select count(*)::int n from public.email_messages where id=$1',[messageId])).rows[0].n,0);assert.equal(s.storage.has(objectPath),false);
 assert.equal((await call({action:'archive_download',id:messageId})).status,409);
 const state=await rpc('status');assert.equal(state.cleanupPending,1);
});
test('authorized integrity check writes and deletes only its synthetic fixture and leaves no extra ledger entry',async()=>{
 const beforeFiles=s.storage.size;const before=(await s.db.query('select count(*)::int n from private.mail_archive_objects')).rows[0].n;
 assert.equal((await call({action:'archive_integrity_check'},'')).status,401);assert.equal((await call({action:'archive_integrity_check'},otherToken)).status,403);
 const response=await call({action:'archive_integrity_check'});assert.equal(response.status,200);
 const result=await response.json();assert.deepEqual(result,{ok:true,upload:true,read:true,hashVerified:true,deleted:true,bytes:217});
 assert.equal(s.storage.size,beforeFiles);assert.equal((await s.db.query('select count(*)::int n from private.mail_archive_objects')).rows[0].n,before);
 assert.equal(JSON.stringify(result).includes('objects/'),false);
});
