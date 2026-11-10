import { createHash } from 'node:crypto';
import { archiveRpc } from './mail-archive.mjs';
import { supa, fail } from './admin-server.mjs';
const MAX_BYTES=4096;
const PATH=/^objects\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.eml$/;
// This fixed payload contains no mailbox, customer, credential or real message.
const SYNTHETIC=Buffer.from('From: storage-probe@example.invalid\r\nTo: storage-probe@example.invalid\r\nSubject: Synthetic storage verification\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSynthetic test. No personal information.\r\n','utf8');
const encoded=path=>path.split('/').map(encodeURIComponent).join('/');
async function writeObject(path,bytes){
 const base=String(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,'');
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)throw fail(503,'archive_storage_probe_failed');
 const response=await fetch(base+'/storage/v1/object/mail-originals/'+encoded(path),{
  method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'message/rfc822','x-upsert':'false'},
  body:bytes,signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store',
 });
 if(!response.ok){await response.body?.cancel();throw fail(503,'archive_storage_probe_failed');}
 await response.body?.cancel();
}
export async function readProbeObject(path,{env=process.env,fetcher=fetch}={}){
 try{
 if(!PATH.test(path||''))throw fail(503,'archive_storage_probe_failed');
 const base=String(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)throw fail(503,'archive_storage_probe_failed');
 const response=await fetcher(base+'/storage/v1/object/mail-originals/'+encoded(path),{
  method:'GET',headers:{apikey:key,Authorization:'Bearer '+key},
  signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store',
 });
 if(response.redirected)throw fail(503,'archive_storage_probe_failed');
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BYTES){await response.body?.cancel();throw fail(503,'archive_storage_probe_failed');}
 if(response.status===404&&response.body==null)throw fail(404,'archive_storage_probe_missing');
 if(!response.body?.getReader)throw fail(503,'archive_storage_probe_failed');
 const reader=response.body.getReader();const parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw fail(503,'archive_storage_probe_failed');}parts.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 const bytes=Buffer.concat(parts,size);
 if(!response.ok){
  let payload;try{payload=JSON.parse(bytes.toString('utf8'));}catch{}
  const code=payload?.code||payload?.error;
  const logicalStatus=payload?.statusCode??payload?.httpStatusCode;
  //Supabase documents NoSuchKey and legacy not_found. Some deployments use
  //HTTP400 with a404 body; never treat other400s or permission errors as absent.
  const missing=[400,404].includes(response.status)&&(
   code==='NoSuchKey'||(code==='not_found'&&[404,'404'].includes(logicalStatus))||
   (response.status===404&&bytes.length===0)
  );
  if(missing)throw fail(404,'archive_storage_probe_missing');
  throw fail(503,'archive_storage_probe_failed');
 }
 return bytes;
 }catch(error){
  if(error?.code==='archive_storage_probe_missing'&&error.status===404)throw error;
  throw fail(503,'archive_storage_probe_failed');
 }
}
const removeObject=path=>supa('/storage/v1/object/mail-originals',{method:'DELETE',body:{prefixes:[path]}});
export async function checkArchiveStorage({call=archiveRpc,write=writeObject,read=readProbeObject,remove=removeObject,reportFailure=record=>console.warn(JSON.stringify(record))}={}){
 let path;
 const report=phase=>{try{reportFailure({event:'archive_storage_probe_failed',phase});}catch{}};
 try{const intent=await call('probe_begin');path=intent?.path;if(!PATH.test(path||''))throw new Error('invalid_probe');}
 catch{report('begin');throw fail(503,'archive_storage_probe_failed');}
 let verified=false,deleted=false;
 let phase='write';
 try{
  await write(path,SYNTHETIC);
  phase='read';
  const actual=await read(path);
  phase='integrity';
  if(!Buffer.isBuffer(actual)||actual.length!==SYNTHETIC.length||!actual.equals(SYNTHETIC)||createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(SYNTHETIC).digest('hex'))throw new Error('integrity');
  verified=true;
 }catch{report(phase);/* Private transport/database errors never escape. */}
 try{
  phase='delete';
  await remove(path);
  // A deletion response alone does not prove the private object is unavailable.
  phase='delete_verify';
  let absent=false;try{await read(path);}catch(error){absent=error?.status===404;}
  if(!absent)throw new Error('delete_not_confirmed');
  phase='finish';
  const result=await call('probe_finish',{path});
  if(result?.deleted!==true)throw new Error('intent_not_removed');
  deleted=true;
 }catch{report(phase);/* Durable intent remains for cron cleanup after5m. */}
 if(!verified||!deleted)throw fail(503,'archive_storage_probe_failed');
 return {ok:true,upload:true,read:true,hashVerified:true,deleted:true,bytes:SYNTHETIC.length};
}
