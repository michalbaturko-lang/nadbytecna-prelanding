import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailArchiveHandler} from '../api/mail-archive-worker.js';

const verified={ok:true,upload:true,read:true,hashVerified:true,deleted:true,bytes:217};
async function invoke(handler,method='GET'){
 const headers={};let body;
 const response={setHeader(name,value){headers[name]=value;},end(raw){body=JSON.parse(raw);}};
 await handler({method,headers:{}},response);
 return{status:response.statusCode,body,headers};
}
test('cron authentication and method validation precede reading the diagnostic flag or doing any work',async()=>{
 let auth=0,work=0;
 const handler=createMailArchiveHandler({
  authorized:()=>{auth++;return false;},
  env:new Proxy({},{get(){assert.fail('unauthorized caller must not read flags');}}),
  run:async()=>{work++;},verify:async()=>{work++;},
 });
 assert.equal((await invoke(handler,'PUT')).status,405);assert.equal(auth,0);
 assert.equal((await invoke(handler)).status,401);assert.equal(auth,1);assert.equal(work,0);
});
test('missing and nonliteral verification flags preserve the existing archive worker path',async()=>{
 for(const value of [undefined,'false','TRUE','1',true]){
  let runs=0,probes=0;
  const result=await invoke(createMailArchiveHandler({authorized:()=>true,env:{M365_MAIL_ARCHIVE_VERIFY_ENABLED:value},run:async()=>{runs++;return{processed:0,cleanup:0};},verify:async()=>{probes++;}}));
  assert.equal(result.status,200);assert.deepEqual(result.body,{processed:0,cleanup:0});assert.equal(runs,1);assert.equal(probes,0);
 }
});
test('opt-in diagnostic performs exactly one synthetic probe and never accesses real mail archival',async()=>{
 for(const method of ['GET','POST']){
  let probes=0;const reports=[];
  const result=await invoke(createMailArchiveHandler({
   authorized:()=>true,env:{M365_MAIL_ARCHIVE_VERIFY_ENABLED:'true',M365_MAIL_ARCHIVE_ENABLED:'false'},
   run:async()=>assert.fail('diagnostic must not run real mail archival'),
   verify:async()=>{probes++;return{...verified,path:'private-path',token:'private-token',body:'private-original'};},
   report:record=>reports.push(record),
  }),method);
  assert.equal(probes,1);assert.equal(result.status,200);assert.deepEqual(result.body,{storageVerified:true,bytes:217});
  assert.deepEqual(reports,[{event:'archive_storage_verified',storageVerified:true,bytes:217}]);
  assert.equal(JSON.stringify(result.body).includes('private-'),false);
  assert.equal(result.headers['Cache-Control'],'no-store');assert.match(result.headers['X-Robots-Tag'],/noindex/);
 }
});
test('partial probe success, bad metadata and thrown private errors return only a fixed failure',async()=>{
 for(const verify of [
  async()=>({...verified,deleted:false}),async()=>({...verified,hashVerified:false}),
  async()=>({...verified,bytes:'217'}),async()=>({...verified,bytes:218}),
  async()=>{throw Object.assign(new Error('private-path-token-body'),{code:'private-error-code'});},
 ]){
  let reports=0;
  const result=await invoke(createMailArchiveHandler({authorized:()=>true,env:{M365_MAIL_ARCHIVE_VERIFY_ENABLED:'true'},run:async()=>assert.fail('not an archive run'),verify,report:()=>{reports++;}}));
  assert.equal(result.status,503);assert.deepEqual(result.body,{error:'archive_storage_probe_failed'});assert.equal(reports,0);
 }
});
