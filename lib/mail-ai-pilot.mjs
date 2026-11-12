// Time-limited, allowlisted, read-only evaluation. Never enables automation or saves classifications.
import { UUID } from './admin-model.mjs';
import { classifyMail } from './mail-ai.mjs';
const fail=code=>Object.assign(new Error(code),{code,status:423});
export function pilotConfig(env=process.env,now=Date.now()) {
 let c;try{c=JSON.parse(env.AI_EMAIL_PILOT_SAMPLE||'null');}catch{return null;}
 if(!c||!Array.isArray(c.ids)||!c.ids.length||c.ids.length>16||!c.ids.every(id=>UUID.test(id))||new Set(c.ids).size!==c.ids.length||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=now||Date.parse(c.expiresAt)>now+86400000)return null;
 return {ids:c.ids,expiresAt:c.expiresAt};
}
export function pilotStatus(env=process.env){const c=pilotConfig(env);return {available:Boolean(c&&env.OPENAI_API_KEY),actual:c?.ids.length||0,controls:c?2:0,total:c?c.ids.length+2:0,expiresAt:c?.expiresAt||null};}
const controls=[
 {subject:'KONTROLNÍ SCÉNÁŘ — žádost o právní pomoc',body_text:'Dobrý den, dnes jsem dostala výpověď a zaměstnavatel po mně chce do zítřejšího poledne podpis dohody. Nerozumím tomu a potřebuji poradit, na koho se obrátit kvůli právní pomoci.'},
 {subject:'KONTROLNÍ SCÉNÁŘ — nabídka právní pomoci',body_text:'Dobrý den, jsem advokátka a ráda bych projektu nabídla dvě hodiny bezplatných pracovněprávních konzultací týdně pro ženy po ztrátě zaměstnání. Prosím o domluvu možného zapojení.'}
];
export async function runMailPilot({index,confirm,env=process.env,rpc,categories,classify=classifyMail,now=()=>new Date()}){
 const config=pilotConfig(env,now().getTime());
 if(!config||!env.OPENAI_API_KEY||confirm!=='TEST_AI_BEZ_ZMEN'||!Number.isInteger(index)||index<0||index>=config.ids.length+2)throw fail('mail_ai_pilot_unavailable');
 const control=index>=config.ids.length,id=control?null:config.ids[index];
 const before=control?null:await rpc('mail_ai_snapshot',{p_id:id});
 if(!control&&(!before?.messages?.length||before.ai_scope_blocked===true))throw fail('mail_ai_pilot_scope');
 const messages=control?[{...controls[index-config.ids.length],received_at:now().toISOString()}]:before.messages;
 const output=await classify({messages,categories,env:{...env,AI_TRIAGE_ENABLED:'true',AI_EMAIL_CLASSIFICATION_ENABLED:'true',AI_EMAIL_PROCESSING_APPROVED:'true'},now});
 if(!control){const after=await rpc('mail_ai_snapshot',{p_id:id});if(!after?.messages?.length||after.revision!==before.revision||after.ai_scope_version!==before.ai_scope_version||after.ai_scope_blocked===true)throw Object.assign(Error('mail_changed'),{status:409,code:'mail_changed'});}
 const last=messages.at(-1);
 return {index,source:control?'synthetic_control':'real_email',id,revision:before?.revision||null,subject:last.subject,receivedAt:last.received_at,messageCount:messages.length,output,previewOnly:true};
}
