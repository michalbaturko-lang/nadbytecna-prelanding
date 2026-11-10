import test from'node:test';import assert from'node:assert/strict';import{generateKeyPairSync}from'node:crypto';import{startAdminServer,token,otherToken}from'./helpers/admin-server.mjs';
let s,baseFetch,graphReads=0,total=1;
test.before(async()=>{s=await startAdminServer();baseFetch=globalThis.fetch;globalThis.fetch=async(input,options={})=>{const u=new URL(String(input));if(u.hostname==='graph.microsoft.com'&&u.pathname.endsWith('/mailFolders/inbox')){graphReads++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(u.pathname,'/v1.0/users/veryvera%40nadbytecna.cz/mailFolders/inbox');assert.equal(u.searchParams.get('$select'),'totalItemCount,unreadItemCount');return Response.json({totalItemCount:total,unreadItemCount:0});}return baseFetch(input,options);};});
test.after(async()=>{globalThis.fetch=baseFetch;await s?.close();});
const call=(t=token)=>s.fetch(s.url+'/api/admin-mail/',{method:'POST',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify({action:'source_check'})});
test('source comparison rejects unauthorized callers and disabled import before reading Microsoft',async()=>{
 assert.equal((await call('')).status,401);assert.equal((await call(otherToken)).status,403);assert.equal((await call()).status,423);assert.equal(graphReads,0);
});
test('read-only Inbox count comparison reports exact match and discrepancy without exposing message content',async()=>{
 const{privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});Object.assign(process.env,{M365_INGEST_ENABLED:'true',M365_AUTH_MODE:'certificate',M365_MAILBOX:'veryvera@nadbytecna.cz',M365_FOLDER_ID:'inbox',M365_SINCE:'2026-11-01T00:00:00Z',M365_TENANT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',M365_CLIENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',M365_CERT_SHA256_THUMBPRINT:'ab'.repeat(32),M365_CERT_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'})});s.setMailResponse('success');
 let r=await call();assert.equal(r.status,200);let d=await r.json();assert.equal(d.matches,true);assert.equal(d.sourceMessages,1);assert.equal(d.activeMessages,1);assert.equal(d.allMessages,1);assert.equal(d.scope,'Inbox');assert.equal(graphReads,1);
 total=2;r=await call();d=await r.json();assert.equal(d.matches,false);assert.equal(d.sourceMessages,2);assert.equal(d.activeMessages,1);assert.equal(graphReads,2);
 const safe=JSON.stringify(d);for(const text of['body_text','sender','subject','access_token','synthetic-graph-token'])assert.ok(!safe.includes(text));assert.equal(s.metrics.external,0);
});
