// Operator-only read check. Inject existing Production env via `vercel env run`.
// Never print credentials, message IDs, subjects, senders or bodies; no source file is saved.
import fs from 'node:fs';
import {getDelegatedMailToken} from '../lib/mail-oauth-service.mjs';
import {graphGet} from '../lib/m365-transport.mjs';
import {readM365Json} from '../lib/m365-readonly.mjs';
import {supa,restPath,rpc} from '../lib/admin-server.mjs';
import {createMailSyncHandler} from '../api/mail-sync.js';
import {runMailArchive,archiveStatus,verifyArchiveOriginal} from '../lib/mail-archive.mjs';
if(process.env.M365_MAILBOX!=='veryvera@nadbytecna.cz'||new URL(process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='gjzsifxldxaogcuqzivb.supabase.co')throw Error('target_configuration');
const result={checkedAt:new Date().toISOString()};
if(process.argv.includes('--recover')){
 const res={setHeader(){},statusCode:200,end(text){this.body=JSON.parse(text);}};
 await createMailSyncHandler({authorized:()=>true})({method:'POST'},res);result.sync={status:res.statusCode,...res.body};
 result.archive=await runMailArchive();
}
let auth;for(let i=0;i<3;i++){try{auth=await getDelegatedMailToken();break;}catch(e){if(!['mail_connection_changed'].includes(e.code)||i===2)throw Error(e.code||'auth');await new Promise(r=>setTimeout(r,1000));}}
const base='https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages';
let next=base+'?$select=id&$top=500',pages=0;const ids=new Set();
while(next){
 const u=new URL(next);const path=decodeURIComponent(u.pathname).toLowerCase();if(u.origin!=='https://graph.microsoft.com'||u.username||u.password||u.hash||!["/v1.0/me/mailfolders/inbox/messages","/v1.0/me/mailfolders('inbox')/messages"].includes(path)||++pages>30)throw Error('source_scope');
 const data=await graphGet({url:next,headers:{Authorization:'Bearer '+auth.accessToken,Accept:'application/json',Prefer:'IdType="ImmutableId"'},consume:async r=>{if(r.status!==200)throw Object.assign(Error(),{code:'http_error'});return readM365Json(r);}});
 if(!Array.isArray(data.value))throw Error('source_format');for(const item of data.value){if(typeof item.id!=='string')throw Error('source_format');ids.add(item.id);}
 next=data['@odata.nextLink']||null;
}
let rows=[];for(let offset=0;offset<20000;offset+=500){const page=await supa(restPath('email_messages',{select:'id,external_id,source_removed_at',order:'id.asc',limit:500,offset}));rows.push(...page);if(page.length<500)break;}
const active=new Set(rows.filter(r=>!r.source_removed_at).map(r=>r.external_id));
result.comparison={scope:'Inbox',sourceMessages:ids.size,activeLocalMessages:active.size,allLocalMessages:rows.length,missingLocally:[...ids].filter(id=>!active.has(id)).length,localOnly:[...active].filter(id=>!ids.has(id)).length};
result.comparison.matches=result.comparison.missingLocally===0&&result.comparison.localOnly===0;
result.originals=await archiveStatus();
if(process.argv.includes('--verify-originals')){
 let checked=0,failed=0,bytes=0;
 for(let i=0;i<rows.length;i+=4){await Promise.all(rows.slice(i,i+4).map(async row=>{const list=await rpc('mail_archive',{p_action:'list',p_payload:{id:row.id}});const r=list.messages?.[0];if(r?.status!=='archived')return;try{await verifyArchiveOriginal(r.path,r);checked++;bytes+=r.size;}catch{failed++;}}));}
 result.integrity={checked,failed,bytes};
}
if(process.env.MAIL_RELIABILITY_OUTPUT)fs.writeFileSync(process.env.MAIL_RELIABILITY_OUTPUT,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
