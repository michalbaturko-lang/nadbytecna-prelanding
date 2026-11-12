import test from 'node:test';
import assert from 'node:assert/strict';
import {runMailArchive,verifyArchiveOriginal} from '../lib/mail-archive.mjs';
import {createHash} from 'node:crypto';

const env={M365_INGEST_ENABLED:'true',M365_MAIL_ARCHIVE_ENABLED:'true',M365_AUTH_MODE:'delegated'};
function fixture({jobs=25,cleanupMs=0,jobMs=0,badAt=0,badCode='response_too_large',badPhase='read',inactiveAt=0}={}){
 const events=[],uploaded=[],finished=[],failures=[];
 let next=0,current=0,clock=0,inFlight=0;
 const args={
  env,now:()=>clock,
  cleanup:async()=>{events.push('cleanup');clock+=cleanupMs;return{removed:3};},
  getToken:async()=>{events.push('auth');if(current===badAt&&badPhase==='auth')throw Object.assign(new Error('private-token-error'),{code:badCode});return{accessToken:'synthetic-token',generation:7};},
  getConnection:async()=>{events.push('connection');return{connected:true,generation:current===badAt&&badPhase==='connection'?8:7};},
  read:async()=>{
   events.push('read');assert.equal(inFlight,0,'previous original must finish before fetching the next');
   if(current===badAt&&badPhase==='read')throw Object.assign(new Error('private-MIME-body'),{code:badCode,retryAfterSeconds:120});
   inFlight++;return{enabled:true,bytes:Buffer.from('synthetic'),size:9,sha256:'a'.repeat(64)};
  },
  put:async(path,bytes)=>{events.push('upload');assert.equal(inFlight,1);assert.deepEqual(bytes,Buffer.from('synthetic'));uploaded.push(path);},
  verify:async()=>{events.push('verify');return true;},
  call:async(action,payload)=>{
   events.push(action);
   if(action==='claim'){
    assert.equal(inFlight,0,'no buffer remains in an unfinished job');
    if(next>=jobs)return null;
    current=++next;
    const id=`aaaaaaaa-aaaa-4aaa-8aaa-${String(current).padStart(12,'0')}`;
    const lease=`bbbbbbbb-bbbb-4bbb-8bbb-${String(current).padStart(12,'0')}`;
    return{id,lease,revision:1,externalId:`synthetic-${current}`,path:`objects/${id}/${lease}.eml`};
   }
   if(action==='active'){
    if(current===inactiveAt){inFlight=0;return{active:false};}
    return{active:true};
   }
   if(action==='finish'){
    if(current===badAt&&badPhase==='finish')throw new Error('synthetic-persistence-failure');
    assert.equal(inFlight,1);inFlight=0;finished.push(payload);clock+=jobMs;return{saved:true};
   }
   if(action==='fail'){inFlight=0;failures.push(payload);clock+=jobMs;return{saved:true};}
   throw new Error('Unexpected action');
  },
 };
 return{args,events,uploaded,finished,failures};
}
test('one run archives at most twenty sequential originals with per-job auth and guards',async()=>{
 const f=fixture();const result=await runMailArchive(f.args);
 assert.deepEqual(result,{processed:20,cleanup:3,archived:20,discarded:0});
 assert.equal(f.finished.length,20);assert.equal(f.uploaded.length,20);
 for(const stage of ['auth','read','connection','active','upload','verify','finish'])assert.equal(f.events.filter(event=>event===stage).length,20);
 assert.equal(f.events.filter(event=>event==='claim').length,20);
 assert.deepEqual(f.events.slice(0,9),['cleanup','claim','auth','read','connection','active','upload','verify','finish']);
 assert.equal(new Set(f.uploaded).size,20);
 assert.equal(JSON.stringify(result).includes('synthetic'),false);
});
test('empty queue preserves zero-job return shape and short batches preserve single-job shape',async()=>{
 const empty=fixture({jobs:0});assert.deepEqual(await runMailArchive(empty.args),{processed:0,cleanup:3});
 assert.deepEqual(empty.events,['cleanup','claim']);
 const single=fixture({jobs:1});assert.deepEqual(await runMailArchive(single.args),{processed:1,cleanup:3,archived:1,discarded:0});
 assert.equal(single.events.filter(event=>event==='claim').length,2);
});
test('cleanup counts toward the deadline and a new job always has the270-second reserve',async()=>{
 const f=fixture({cleanupMs:10000,jobMs:10000});const result=await runMailArchive(f.args);
 assert.deepEqual(result,{processed:2,cleanup:3,archived:2,discarded:0,deadline:true});
 assert.equal(f.events.filter(event=>event==='claim').length,2);
 const cutoff=fixture({cleanupMs:30000});assert.deepEqual(await runMailArchive(cutoff.args),{processed:0,cleanup:3,deadline:true});
 assert.deepEqual(cutoff.events,['cleanup']);
});
test('disabled archival still drains GDPR cleanup without claiming or accessing credentials',async()=>{
 const f=fixture();assert.deepEqual(await runMailArchive({...f.args,env:{}}),{skipped:true,cleanup:3});
 assert.deepEqual(f.events,['cleanup']);
});
test('one permanent bad message does not block unrelated originals and records no private payload',async()=>{
 for(const badCode of ['response_too_large','source_missing','invalid_response']){
  const f=fixture({jobs:2,badAt:1,badCode});const result=await runMailArchive(f.args);
  assert.equal(result.processed,2);assert.equal(result.failed,1);assert.equal(result.archived,1);assert.equal(result.error,badCode);
  assert.equal(f.uploaded.length,1);assert.equal(f.failures.length,1);
  assert.equal(JSON.stringify(f.failures).includes('private-'),false);
 }
});
test('throttling, auth and changed connection stop the batch after recording that job',async()=>{
 for(const config of [
  {badCode:'throttled',badPhase:'read'},
  {badCode:'authentication_failed',badPhase:'read'},
  {badCode:'oauth_client_rejected',badPhase:'auth'},
  {badPhase:'connection'},
 ]){
  const f=fixture({badAt:3,...config});const result=await runMailArchive(f.args);
  assert.equal(result.processed,3);assert.equal(result.archived,2);assert.equal(result.failed,1);
  assert.equal(f.uploaded.length,2);assert.equal(f.events.filter(event=>event==='claim').length,3);
  if(config.badCode==='throttled')assert.equal(f.failures[0].retry_after_seconds,120);
  if(config.badPhase==='connection')assert.equal(result.error,'connection_changed');
  assert.equal(JSON.stringify(result).includes('private-'),false);
 }
});
test('erased active lease cannot upload and does not block later independent jobs',async()=>{
 const f=fixture({jobs:3,inactiveAt:2});const result=await runMailArchive(f.args);
 assert.equal(result.processed,3);assert.equal(result.archived,2);assert.equal(result.discarded,1);
 assert.equal(f.uploaded.length,2);assert.equal(f.failures.length,0);
});
test('ambiguous finish stops immediately with durable intent and no failure-finish or repeated upload',async()=>{
 const f=fixture({badAt:2,badPhase:'finish'});
 await assert.rejects(()=>runMailArchive(f.args),/synthetic-persistence-failure/);
 assert.equal(f.uploaded.length,2);assert.equal(f.finished.length,1);assert.equal(f.failures.length,0);
 assert.equal(f.events.filter(event=>event==='claim').length,2);
 assert.equal(f.events.at(-1),'finish');
});

test('every one of twenty uploaded originals is read back and verified before metadata finish',async()=>{
 const f=fixture({jobs:20});const objects=new Map(),verified=[];
 const read=f.args.read;
 f.args.read=async(options)=>{
  const mime=await read(options);const bytes=Buffer.from('Synthetic original '+options.externalId);
  return{...mime,bytes,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 };
 f.args.put=async(path,bytes)=>{objects.set(path,Buffer.from(bytes));};
 f.args.verify=(path,metadata)=>{
  assert.equal(metadata.bytes,undefined,'source buffer is released before read-back');
  return verifyArchiveOriginal(path,metadata,{read:async(requested,maxBytes)=>{
   assert.equal(requested,path);assert.equal(maxBytes,metadata.size);verified.push(path);return objects.get(path);
  }});
 };
 const result=await runMailArchive(f.args);
 assert.equal(result.archived,20);assert.equal(objects.size,20);assert.equal(verified.length,20);
 assert.equal(new Set(verified).size,20);
 assert.equal(f.finished.length,20);
 for(const finish of f.finished){
  const path=[...objects.keys()].find(path=>path.includes(finish.lease));
  assert.equal(finish.size,objects.get(path).length);
  assert.equal(finish.sha256,createHash('sha256').update(objects.get(path)).digest('hex'));
 }
});

test('corrupt, incomplete or unreadable stored originals fail visibly without finishing or processing another job',async()=>{
 for(const failure of ['hash','size','transport']){
  const f=fixture();
  f.args.verify=(path,metadata)=>verifyArchiveOriginal(path,metadata,{read:async()=>{
   if(failure==='transport')throw new Error('private-storage-token');
   return Buffer.from(failure==='size'?'short':'corrupted');
  }});
  const result=await runMailArchive(f.args);
  assert.equal(result.processed,1);assert.equal(result.failed,1);assert.equal(result.archived,undefined);
  assert.equal(result.error,'storage_failed');assert.equal(f.finished.length,0);
  assert.equal(f.events.filter(event=>event==='claim').length,1);
  assert.equal(f.failures[0].error,'storage_failed');
  assert.equal(JSON.stringify(f.failures).includes('private-'),false);
 }
});
