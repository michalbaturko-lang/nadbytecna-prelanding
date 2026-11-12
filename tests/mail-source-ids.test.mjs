import test from 'node:test';import assert from 'node:assert/strict';import{compareInboxIds}from'../lib/mail-source-check.mjs';
test('ID reconciliation catches same-count different-message mismatch and omits removed local copies',async()=>{
 const readLocal=async()=>[{external_id:'private-A'},{external_id:'private-C'},{external_id:'private-old',source_removed_at:'2026-01-01'}];
 const d=await compareInboxIds({accessToken:'synthetic',fetcher:async()=>Response.json({value:[{id:'private-A'},{id:'private-B'}]}),readLocal});assert.equal(d.sourceMessages,2);assert.equal(d.activeMessages,2);assert.equal(d.missingLocally,1);assert.equal(d.localOnly,1);assert.equal(d.matches,false);assert.ok(!JSON.stringify(d).includes('private-'));
});
test('paged source IDs are compared completely and foreign continuations cannot receive bearer',async()=>{
 let calls=0;const next="https://graph.microsoft.com/v1.0/me/mailFolders('Inbox')/messages?$skiptoken=opaque";
 const d=await compareInboxIds({accessToken:'synthetic',fetcher:async(url,opts)=>{assert.equal(opts.headers.Prefer,'IdType="ImmutableId"');calls++;return Response.json({value:[{id:calls===1?'A':'B'}],...(calls===1?{'@odata.nextLink':next}:{})});},readLocal:async()=>[{external_id:'A'},{external_id:'B'}]});assert.equal(d.matches,true);assert.equal(calls,2);
 calls=0;await assert.rejects(compareInboxIds({accessToken:'synthetic',fetcher:async()=>{calls++;return Response.json({value:[],'@odata.nextLink':'https://evil.invalid/steal'});},readLocal:async()=>[]}),e=>e.code==='invalid_cursor');assert.equal(calls,1);
});
