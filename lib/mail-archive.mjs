import { createHash } from 'node:crypto';
import { rpc, supa, fail } from './admin-server.mjs';
import { getM365AccessToken } from './m365-auth.mjs';
import { delegatedMode, getDelegatedMailToken, oauthRpc } from './mail-oauth-service.mjs';
import { readM365Mime } from './m365-mime.mjs';
const BUCKET='mail-originals';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PATH=/^objects\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.eml$/i;
const CODES=new Set(['response_too_large','source_missing','authentication_failed','throttled','timeout','network_error','http_error','invalid_response','invalid_configuration','storage_failed','connection_changed']);
export const archiveRpc=(action,payload={})=>rpc('mail_archive',{p_action:action,p_payload:payload});
export const archiveStatus=()=>archiveRpc('status');
export const retryArchive=(id)=>archiveRpc('retry',{id});
export async function archiveThread(id){const result=await archiveRpc('list',{threadId:id});return {...result,messages:(result.messages||[]).map(({path,...row})=>row)};}
export function archiveEnabled(env=process.env){return env.M365_INGEST_ENABLED==='true'&&env.M365_MAIL_ARCHIVE_ENABLED==='true';}
function validPath(path){if(!PATH.test(path||''))throw fail(503,'archive_path');return path;}
const encoded=path=>validPath(path).split('/').map(encodeURIComponent).join('/');
async function sign(row){
 const result=await supa('/storage/v1/object/sign/'+BUCKET+'/'+encoded(row.path),{method:'POST',body:{expiresIn:60}});
 if(typeof result?.signedURL!=='string'||!result.signedURL.startsWith('/object/sign/'+BUCKET+'/'))throw fail(503,'archive_storage');
 const base=String(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,'');
 return base+'/storage/v1'+result.signedURL;
}
export async function archiveDownload(id){
 if(!UUID.test(id||''))throw fail(400,'id');
 const rows=await archiveRpc('list',{id}); const row=rows?.messages?.[0];
 if(!row||row.status!=='archived'||!row.path)throw fail(409,'archive_not_ready');
 return {url:await sign(row),expires_in:60,size:row.size,sha256:row.sha256};
}
export async function archiveExport(scope){
 const result=await archiveRpc('list',scope); const messages=[];
 for(const row of result.messages||[]){
  const {path,...metadata}=row;
  messages.push({...metadata,...(row.status==='archived'&&path?{signed_url:await sign(row),expires_in:60}:{})});
 }
 return {messages,requires_review:true,complete:messages.every(row=>row.status==='archived'),format:'message/rfc822',links_expire_in:60};
}
async function readStoredOriginal(path,maxBytes){
 const response=await supa('/storage/v1/object/'+BUCKET+'/'+encoded(path),{raw:true});
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maxBytes){await response.body?.cancel();throw fail(413,'export_too_large');}
 if(!response.body?.getReader)throw fail(503,'archive_storage');
 const reader=response.body.getReader();const parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw fail(413,'export_too_large');}parts.push(Buffer.from(value));}}
 catch(error){if(error?.code==='export_too_large')throw error;throw fail(503,'archive_storage');}
 return Buffer.concat(parts,size);
}
export async function archiveExportFiles(scope,{maxBytes=100*1024*1024,call=archiveRpc,read=readStoredOriginal}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw fail(413,'export_too_large');
 const result=await call('list',scope);const files={},messages=[];let size=0;
 for(const row of result.messages||[]){
  const {path,...metadata}=row;
  if(row.status!=='archived'){messages.push(metadata);continue;}
  if(!UUID.test(row.id||'')||!Number.isSafeInteger(row.size)||row.size<1||row.size>52428800||row.size>maxBytes-size)throw fail(413,'export_too_large');
  const bytes=await read(validPath(path),Math.min(52428800,maxBytes-size));
  if(!Buffer.isBuffer(bytes)||bytes.length!==row.size||createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw fail(503,'archive_integrity');
  const filename='originaly/'+row.id+'.eml';files[filename]=bytes;size+=bytes.length;messages.push({...metadata,file:filename});
 }
 return {files,size,manifest:{messages,requires_review:true,complete:messages.every(row=>row.status==='archived'),format:'message/rfc822'}};
}
export async function cleanupArchiveObjects({call=archiveRpc,scope={},remove,removeBatch=paths=>supa('/storage/v1/object/'+BUCKET,{method:'DELETE',body:{prefixes:paths}})}={}){
 const rows=await call('cleanup_list',scope);let removed=0;
 const paths=(rows||[]).map(row=>validPath(row.path));
 if(remove){for(const path of paths){await remove(path);await call('cleanup_done',{path});removed++;}}
 else if(paths.length){await removeBatch(paths);await call('cleanup_done_batch',{paths});removed=paths.length;}
 return {removed};
}
export async function prepareArchiveErase(scope,{call=archiveRpc,cleanup=cleanupArchiveObjects}={}){
 if(scope.email&&!scope.hash_secret)scope={...scope,hash_secret:(await import('./mail-service.mjs')).mailHashSecret()};
 const prepared=await call('prepare_delete',scope);
 const selected={messageIds:prepared.messageIds||[],threadIds:prepared.threadIds||[],scopeKeys:prepared.scopeKey?[prepared.scopeKey]:[]};
 // Three bounded batches. A large scope or an active upload returns explicit
 // pending; existing message metadata is retained so retry remains reviewable.
 for(let batch=0;batch<3;batch++){
  const result=await cleanup({call,scope:selected});
  if(!result.removed)break;
 }
 const state=await call('cleanup_pending',selected);
 if(state.pending>0)throw fail(409,'mail_archive_cleanup_pending');
 await call('scope_done',selected);
 return {blocked:prepared.blocked,scope:selected};
}
export async function finishArchiveErase(prepared,erased,{call=archiveRpc,cleanup=cleanupArchiveObjects}={}){
 const first=prepared?.scope||{};const actual=erased?.archive_scope||{};
 const scope={messageIds:[...new Set([...(first.messageIds||[]),...(actual.messageIds||[])])],threadIds:[...new Set([...(first.threadIds||[]),...(actual.threadIds||[])])],scopeKeys:[...new Set([...(first.scopeKeys||[]),...(actual.scopeKey?[actual.scopeKey]:[])])]};
 for(let batch=0;batch<3;batch++){const result=await cleanup({call,scope});if(!result.removed)break;}
 const state=await call('cleanup_pending',scope);
 if(state.pending>0)throw fail(409,'mail_archive_cleanup_pending');
 await call('scope_done',scope);
 return {complete:true};
}
async function upload(path,bytes,env){
 validPath(path);
 const base=String(env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,'');
 const key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)throw fail(503,'storage_failed');
 let response;
 try{response=await fetch(base+'/storage/v1/object/'+BUCKET+'/'+encoded(path),{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'message/rfc822','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000),redirect:'error',cache:'no-store'});}catch{throw fail(503,'storage_failed');}
 if(!response.ok)throw fail(503,'storage_failed');
 await response.body?.cancel();
}
export async function runMailArchive({env=process.env,call=archiveRpc,cleanup=cleanupArchiveObjects,getToken=env=>delegatedMode(env)?getDelegatedMailToken({env}):getM365AccessToken({env}),getConnection=()=>oauthRpc('status'),read=readM365Mime,put=upload,now=Date.now}={}){
 // Cleanup is intentionally independent of import/archive flags: revoking a
 // mailbox connection must never stop pending GDPR deletion of local copies.
 const started=now();
 const cleaned=await cleanup({call});
 if(!archiveEnabled(env))return {skipped:true,cleanup:cleaned.removed};
 const totals={processed:0,cleanup:cleaned.removed};
 const add=(key,value)=>{totals[key]=(totals[key]||0)+value;};
 //270s includes initial cleanup. Each next claim reserves180s for the bounded
 //auth/read/connection/active/upload/finish sequence; deployment limit is300s.
 for(let index=0;index<20;index++){
  if(now()-started>=90000)return {...totals,deadline:true};
  const job=await call('claim');if(!job)return totals;
  if(!UUID.test(job.id||'')||!UUID.test(job.lease||'')||job.path!==`objects/${job.id}/${job.lease}.eml`||!Number.isSafeInteger(job.revision)||job.revision<1)throw fail(503,'archive_job');
  let mime,phase='auth';
  try{
   let continueBatch=true;
   try{
    const auth=await getToken(env);
    phase='read';
    mime=await read({env,accessToken:auth.accessToken,externalId:job.externalId});
    if(!mime?.enabled||!Buffer.isBuffer(mime.bytes)||mime.size!==mime.bytes.length||mime.size<1||mime.size>52428800||!/^[0-9a-f]{64}$/.test(mime.sha256||''))throw fail(503,'invalid_response');
    phase='connection';
    if(delegatedMode(env)){
     const current=await getConnection();
     if(current?.connected!==true||!Number.isSafeInteger(auth.generation)||current.generation!==auth.generation)throw fail(503,'connection_changed');
    }
    phase='active';
    const state=await call('active',{lease:job.lease});
    if(!state?.active){totals.processed++;add('discarded',1);continue;}
    phase='upload';
    await put(job.path,mime.bytes,env);
   }catch(error){
    const code=CODES.has(error?.code)?error.code:'archive_failed';
    const retryAfter=Number.isInteger(error?.retryAfterSeconds)?Math.max(0,Math.min(86400,error.retryAfterSeconds)):undefined;
    const result=await call('fail',{lease:job.lease,error:code,...(retryAfter!==undefined?{retry_after_seconds:retryAfter}:{})});
    totals.processed++;add('failed',result.saved?1:0);add('discarded',result.saved?0:1);totals.error=code;
    //A malformed/deleted/oversize message must not block unrelated originals.
    //Connection, throttling, infrastructure and unknown errors stop this run.
    continueBatch=phase==='read'&&['response_too_large','source_missing','invalid_response'].includes(code);
    if(!continueBatch)return totals;
    continue;
   }
   //Ambiguous finish stays outside the failure path. Do not repeat upload or
   //issue fail against a possibly committed lease; durable intents recover it.
   const result=await call('finish',{lease:job.lease,size:mime.size,sha256:mime.sha256});
   totals.processed++;add('archived',result.saved?1:0);add('discarded',result.saved?0:1);
  }finally{
   //Do not retain a previous50MiB buffer while fetching the next original.
   mime=undefined;
  }
 }
 return totals;
}
