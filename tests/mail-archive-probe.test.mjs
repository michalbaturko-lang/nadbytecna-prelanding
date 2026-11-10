import test from 'node:test';import assert from 'node:assert/strict';
import {checkArchiveStorage,readProbeObject} from '../lib/mail-archive-probe.mjs';
const path='objects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.eml';
function harness(){let object=null;const calls=[];return{calls,args:{call:async(action,payload)=>{calls.push([action,payload]);if(action==='probe_begin')return{path};if(action==='probe_finish')return{deleted:true};throw new Error('unexpected RPC');},write:async(p,bytes)=>{assert.equal(p,path);object=Buffer.from(bytes);calls.push(['write',bytes.length]);},read:async p=>{assert.equal(p,path);calls.push(['read']);if(!object)throw Object.assign(new Error('private missing body'),{status:404});return object;},remove:async p=>{assert.equal(p,path);object=null;calls.push(['remove']);}}};}
test('synthetic probe verifies exact bytes and hash, confirms404 afterdelete, then removes private intent',async()=>{
 const h=harness();const result=await checkArchiveStorage(h.args);assert.deepEqual(result,{ok:true,upload:true,read:true,hashVerified:true,deleted:true,bytes:h.calls.find(x=>x[0]==='write')[1]});
 assert.deepEqual(h.calls.map(x=>x[0]),['probe_begin','write','read','remove','read','probe_finish']);assert.equal(JSON.stringify(result).includes('objects/'),false);
});
test('corrupt or failed read cannot claim success and still cleans only its own object',async()=>{
 for(const bad of [Buffer.from('corrupt'),null]){const h=harness();let removed=false;h.args.read=async()=>{if(removed)throw Object.assign(new Error('missing'),{status:404});if(bad)return bad;throw new Error('private-secret-body');};h.args.remove=async p=>{assert.equal(p,path);removed=true;};await assert.rejects(checkArchiveStorage(h.args),e=>e.code==='archive_storage_probe_failed'&&!e.message.includes('secret'));assert.equal(h.calls.at(-1)[0],'probe_finish');}
});
test('failed or unconfirmed Storage deletion leaves durable intent for cron rather than reporting success',async()=>{
 for(const fails of [true,false]){const h=harness();h.args.remove=async()=>{if(fails)throw new Error('private credential');};await assert.rejects(checkArchiveStorage(h.args),e=>e.code==='archive_storage_probe_failed');assert.equal(h.calls.some(x=>x[0]==='probe_finish'),false);}
});
test('failed upload cleans absent object but cannot claim upload verified',async()=>{const h=harness();h.args.write=async()=>{throw new Error('private provider response');};await assert.rejects(checkArchiveStorage(h.args),e=>e.code==='archive_storage_probe_failed');assert.equal(h.calls.at(-1)[0],'probe_finish');});
test('invalid intent or RPC errors cannot disclose paths or credentials or mutate arbitrary storage',async()=>{for(const pathValue of ['other-bucket/private',null]){const h=harness();h.args.call=async()=>({path:pathValue});await assert.rejects(checkArchiveStorage(h.args),e=>e.code==='archive_storage_probe_failed');assert.equal(h.calls.length,0);}const h=harness();h.args.call=async()=>{throw new Error('private credential');};await assert.rejects(checkArchiveStorage(h.args),e=>e.code==='archive_storage_probe_failed');assert.equal(h.calls.length,0);});
test('failed final ledger removal never reports completed probe',async()=>{const h=harness();const call=h.args.call;h.args.call=async(a,p)=>a==='probe_finish'?{deleted:false}:call(a,p);await assert.rejects(checkArchiveStorage(h.args),e=>e.code==='archive_storage_probe_failed');});

test('probe failure diagnostics contain only one of seven fixed phases and no original errors',async()=>{
 for(const phase of ['begin','write','read','integrity','delete','delete_verify','finish']){
  const h=harness(),records=[];h.args.reportFailure=record=>records.push(record);
  const fail=async()=>{throw new Error('private-path-token-response');};
  if(phase==='begin')h.args.call=fail;
  if(phase==='write')h.args.write=fail;
  if(phase==='read'){const read=h.args.read;let first=true;h.args.read=p=>{if(first){first=false;return fail();}return read(p);};}
  if(phase==='integrity'){const read=h.args.read;let first=true;h.args.read=p=>{if(first){first=false;return Buffer.from('corrupt');}return read(p);};}
  if(phase==='delete')h.args.remove=fail;
  if(phase==='delete_verify')h.args.remove=async()=>{};
  if(phase==='finish'){const call=h.args.call;h.args.call=(action,payload)=>action==='probe_finish'?fail():call(action,payload);}
  await assert.rejects(checkArchiveStorage(h.args),error=>error.code==='archive_storage_probe_failed'&&!error.stack.includes('private-path'));
  assert.deepEqual(records,[{event:'archive_storage_probe_failed',phase}]);
 }
});

test('dedicated Storage GET recognizes precise modern and legacy missing-key responses only',async()=>{
 const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role'};
 for(const [status,payload,missing] of [
  [404,{code:'NoSuchKey',message:'private-object-path'},true],
  [400,{code:'NoSuchKey',statusCode:'404',message:'private-object-path'},true],
  [400,{error:'not_found',statusCode:'404',message:'private-object-path'},true],
  [404,null,true],
  [400,{code:'InvalidRequest',statusCode:'400'},false],
  [400,{error:'AccessDenied',statusCode:'404'},false],
  [403,{code:'NoSuchKey'},false],
  [404,{code:'NoSuchBucket'},false],
  [500,{code:'NoSuchKey'},false],
  [400,{statusCode:'404',message:'not found'},false],
 ]){
  await assert.rejects(readProbeObject(path,{env,fetcher:async(url,options)=>{
   assert.equal(url,'https://synthetic.supabase.co/storage/v1/object/mail-originals/'+path);
   assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal);
   return new Response(payload?JSON.stringify(payload):'',{status,headers:{'content-type':'application/json'}});
  }}),error=>{
   assert.equal(error.status,missing?404:503);assert.equal(error.stack.includes('private-object'),false);assert.equal(error.cause,undefined);return true;
  });
 }
});

test('dedicated Storage GET bounds missing-key JSON and returns exact success bytes',async()=>{
 const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-key'};
 const bytes=Buffer.from('Synthetic original bytes\r\n');
 assert.deepEqual(await readProbeObject(path,{env,fetcher:async()=>new Response(bytes)}),bytes);
 let cancelled=false;
 await assert.rejects(readProbeObject(path,{env,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(Buffer.alloc(4097));},cancel(){cancelled=true;}}),{status:400})}),error=>error.status===503);
 assert.equal(cancelled,true);
 await assert.rejects(readProbeObject(path,{env,fetcher:async()=>({redirected:true})}),error=>error.status===503);
 await assert.rejects(readProbeObject(path,{env,fetcher:async()=>{throw new Error('private-network-path-token');}}),error=>error.status===503&&!error.stack.includes('private-network'));
});
