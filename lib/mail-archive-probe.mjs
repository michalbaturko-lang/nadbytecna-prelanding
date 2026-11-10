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
async function readObject(path){
 const response=await supa('/storage/v1/object/mail-originals/'+encoded(path),{raw:true});
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BYTES){await response.body?.cancel();throw fail(503,'archive_storage_probe_failed');}
 if(!response.body?.getReader)throw fail(503,'archive_storage_probe_failed');
 const reader=response.body.getReader();const parts=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw fail(503,'archive_storage_probe_failed');}parts.push(Buffer.from(value));}
 return Buffer.concat(parts,size);
}
const removeObject=path=>supa('/storage/v1/object/mail-originals',{method:'DELETE',body:{prefixes:[path]}});
export async function checkArchiveStorage({call=archiveRpc,write=writeObject,read=readObject,remove=removeObject}={}){
 let path;
 try{const intent=await call('probe_begin');path=intent?.path;if(!PATH.test(path||''))throw new Error('invalid_probe');}
 catch{throw fail(503,'archive_storage_probe_failed');}
 let verified=false,deleted=false;
 try{
  await write(path,SYNTHETIC);
  const actual=await read(path);
  if(!Buffer.isBuffer(actual)||actual.length!==SYNTHETIC.length||!actual.equals(SYNTHETIC)||createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(SYNTHETIC).digest('hex'))throw new Error('integrity');
  verified=true;
 }catch{/* Fixed error below; private transport/database errors never escape. */}
 try{
  await remove(path);
  // A deletion response alone does not prove the private object is unavailable.
  let absent=false;try{await read(path);}catch(error){absent=error?.status===404;}
  if(!absent)throw new Error('delete_not_confirmed');
  const result=await call('probe_finish',{path});
  if(result?.deleted!==true)throw new Error('intent_not_removed');
  deleted=true;
 }catch{/* Durable probe intent remains for cron cleanup after its 5m deadline. */}
 if(!verified||!deleted)throw fail(503,'archive_storage_probe_failed');
 return {ok:true,upload:true,read:true,hashVerified:true,deleted:true,bytes:SYNTHETIC.length};
}
