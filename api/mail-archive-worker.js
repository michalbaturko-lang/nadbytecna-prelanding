import { json } from '../lib/http.js';
import { cronAuthorized } from '../lib/mail-service.mjs';
import { runMailArchive } from '../lib/mail-archive.mjs';
import { checkArchiveStorage } from '../lib/mail-archive-probe.mjs';
export function createMailArchiveHandler({authorized=cronAuthorized,run=runMailArchive,verify=checkArchiveStorage,env,report=record=>console.info(JSON.stringify(record))}={}){
 return async function handler(req,res){
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return json(res,405,{error:'method'});}
  if(!authorized(req))return json(res,401,{error:'auth'});
  //One-shot diagnostic mode uses only the synthetic private-Storage probe.
  //It never claims, fetches, analyzes or archives any real mailbox content.
  if((env||process.env).M365_MAIL_ARCHIVE_VERIFY_ENABLED==='true'){
   try{
    const result=await verify();
    if(result?.ok!==true||result.upload!==true||result.read!==true||result.hashVerified!==true||result.deleted!==true||result.bytes!==217)throw new Error('probe_result');
    const safe={storageVerified:true,bytes:217};
    try{report({event:'archive_storage_verified',...safe});}catch{}
    return json(res,200,safe);
   }catch{return json(res,503,{error:'archive_storage_probe_failed'});}
  }
  try{const result=await run();try{report({event:'mail_archive_run',processed:result.processed||0,archived:result.archived||0,failed:result.failed||0,...(result.error?{code:result.error}:{})});}catch{}return json(res,200,result);}catch{return json(res,503,{error:'archive_failed'});}
 };
}
export default createMailArchiveHandler();
