// Compare immutable IDs, not just totals. Return aggregates only, never source identifiers/content.
import {graphGet} from './m365-transport.mjs';
import {readM365Json,m365Error} from './m365-readonly.mjs';
import {supa,restPath} from './admin-server.mjs';
export async function compareInboxIds({accessToken,fetcher=fetch,now=Date.now,readLocal=async offset=>supa(restPath('email_messages',{select:'external_id,source_removed_at',mailbox:'eq.veryvera@nadbytecna.cz',order:'id.asc',limit:500,offset}))}={}) {
 const started=now(),source=new Set();let next='https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=id&$top=500',pages=0;
 while(next){
  const u=new URL(next),path=decodeURIComponent(u.pathname).toLowerCase();
  if(u.origin!=='https://graph.microsoft.com'||u.username||u.password||u.hash||!["/v1.0/me/mailfolders/inbox/messages","/v1.0/me/mailfolders('inbox')/messages"].includes(path))throw m365Error('invalid_cursor');
  if(++pages>20||now()-started>60000)throw m365Error('timeout');
  const data=await graphGet({url:u.href,fetcher,headers:{Authorization:'Bearer '+accessToken,Accept:'application/json',Prefer:'IdType="ImmutableId"'},consume:async r=>{if(r.status!==200)throw m365Error('http_error');return readM365Json(r);}});
  if(!Array.isArray(data.value)||data.value.length>1000)throw m365Error('invalid_response');
  for(const row of data.value){if(typeof row.id!=='string'||!row.id||row.id.length>2048)throw m365Error('invalid_response');source.add(row.id);}
  next=data['@odata.nextLink']||null;
 }
 const active=new Set();let allMessages=0,complete=false;
 for(let offset=0;offset<10000;offset+=500){if(now()-started>145000)throw m365Error('timeout');const rows=await readLocal(offset);if(!Array.isArray(rows))throw m365Error('invalid_response');allMessages+=rows.length;for(const r of rows)if(!r.source_removed_at)active.add(r.external_id);if(rows.length<500){complete=true;break;}}
 if(!complete)throw m365Error('response_too_large');
 const missingLocally=[...source].filter(id=>!active.has(id)).length,localOnly=[...active].filter(id=>!source.has(id)).length;
 return {scope:'Inbox',comparison:'immutable_ids',sourceMessages:source.size,activeMessages:active.size,allMessages,missingLocally,localOnly,matches:missingLocally===0&&localOnly===0,checkedAt:new Date(now()).toISOString()};
}
