import { json } from '../lib/http.js';
import { cronAuthorized } from '../lib/mail-service.mjs';
import { runMailArchive } from '../lib/mail-archive.mjs';
export function createMailArchiveHandler({authorized=cronAuthorized,run=runMailArchive}={}){
 return async function handler(req,res){
  res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return json(res,405,{error:'method'});}
  if(!authorized(req))return json(res,401,{error:'auth'});
  try{return json(res,200,await run());}catch{return json(res,503,{error:'archive_failed'});}
 };
}
export default createMailArchiveHandler();
