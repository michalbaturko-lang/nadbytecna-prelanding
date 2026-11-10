import test from 'node:test';
import assert from 'node:assert/strict';
import { startAdminServer,token,otherToken } from './helpers/admin-server.mjs';
let s,id;
test.before(async()=>{s=await startAdminServer();id=(await s.db.query('select id from public.email_threads limit 1')).rows[0].id;});
test.after(async()=>await s?.close());
const call=(body,t=token)=>s.fetch(s.url+'/api/admin-mail/',{method:'POST',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify(body)});
const thread=async()=>(await s.db.query('select * from public.email_threads where id=$1',[id])).rows[0];
const list=async(filters)=>(await(await call({action:'list',filters})).json());
test('human review is authenticated, revision-bound and does not set publication consent',async()=>{
 const t=await thread();
 assert.equal((await call({action:'review',id,revision:t.revision,reviewed:true},'')).status,401);
 assert.equal((await call({action:'review',id,revision:t.revision,reviewed:true},otherToken)).status,403);
 for(const patch of [{revision:0,reviewed:true},{revision:t.revision,reviewed:'true'}])assert.equal((await call({action:'review',id,...patch})).status,400);
 assert.deepEqual(await(await call({action:'review',id,revision:t.revision,reviewed:true})).json(),{saved:true});
 const reviewed=await thread();assert.equal(reviewed.reviewed_revision,t.revision);assert.ok(reviewed.reviewed_email);assert.equal(reviewed.consent_state,'unknown');
 assert.equal((await list({review:'pending'})).total,0);assert.equal((await list({review:'reviewed'})).total,1);
 await s.db.query('update public.email_threads set revision=revision+1 where id=$1',[id]);
 assert.deepEqual(await(await call({action:'review',id,revision:t.revision,reviewed:true})).json(),{saved:false,reason:'changed'});
 assert.equal((await list({review:'pending'})).total,1);assert.equal((await list({review:'reviewed'})).total,0);
 assert.equal((await thread()).reviewed_revision,t.revision);
});
test('both automatic and manual proposals persist triage, preserve human decisions and clear on new content',async()=>{
 const t=await thread();
 await s.db.query("update public.email_threads set admin_urgency='low',admin_category='terapie' where id=$1",[id]);
 const output={summary:'Syntetická prosba o radu.',category:'potrebuji_pomoc',urgency:'acute',email_type:'story',help_type:'Zkontrolovat.',model:'synthetic-model',subtype:'request_help',review_required:false,review_reason:'',confidence:'low'};
 const lease=(await s.db.query('select public.mail_ai_claim() job')).rows[0].job;assert.equal(lease.id,id);
 assert.deepEqual((await s.db.query('select public.mail_ai_finish($1,$2::jsonb,false) result',[lease.lease,JSON.stringify(output)])).rows[0].result,{saved:true});
 let saved=await thread();assert.equal(saved.ai_subtype,'request_help');assert.equal(saved.ai_review_required,true);assert.ok(saved.ai_review_reason);assert.equal(saved.ai_confidence,'low');assert.equal(saved.admin_urgency,'low');assert.equal(saved.admin_category,'terapie');
 assert.equal((await list({subtype:'request_help'})).total,1);assert.equal((await list({subtype:'press'})).total,0);
 const actor=(await s.db.query('select user_id,email from public.admins join public.admin_emails on true limit 1')).rows[0];
 const manual={actor_id:actor.user_id,actor_email:actor.email,id,revision:saved.revision,...output,subtype:'personal_story',review_required:true,review_reason:'Ruční kontrola.',confidence:'medium',error:false};
 assert.deepEqual((await s.db.query("select public.admin_mail('ai_save',$1::jsonb) result",[JSON.stringify(manual)])).rows[0].result,{saved:true});
 saved=await thread();assert.equal(saved.ai_subtype,'personal_story');assert.equal(saved.ai_confidence,'medium');
 await s.db.query('select private.mail_refresh_thread($1)',[id]);
 saved=await thread();assert.ok(saved.revision>t.revision);for(const key of ['ai_subtype','ai_review_reason','ai_review_required','ai_confidence'])assert.equal(saved[key],null);
});
test('triage filters and metadata are bounded; service-only SQL rejects malformed proposals',async()=>{
 assert.equal((await call({action:'list',filters:{review:'arbitrary'}})).status,400);
 assert.equal((await call({action:'list',filters:{subtype:'arbitrary'}})).status,400);
 const status=await(await call({action:'status'})).json();assert.equal(status.triageStats.unreviewed,1);assert.equal(status.triageStats.urgent,0);assert.equal(status.triageStats.subtypes.other,1);
 for(const bad of [{subtype:'press'},{subtype:'request_help',review_required:true,review_reason:'x',confidence:'high',email_type:'help'}, {subtype:'other',review_required:true,review_reason:'x'.repeat(301),confidence:'high',email_type:'other'}])await assert.rejects(s.db.query('select private.mail_triage_fields($1::jsonb)',[JSON.stringify(bad)]),/mail_triage/);
 const audit=JSON.stringify((await s.db.query("select diff from public.admin_audit_log where action='mail_review'")).rows);assert.ok(!audit.includes('Syntetická'));
 for(const role of ['anon','authenticated']){
  await s.db.exec('RESET ROLE;SET ROLE '+role);
  await assert.rejects(s.db.query('select public.mail_triage_status()'),/permission denied/);
  await assert.rejects(s.db.query('select public.mail_mark_reviewed(null,1,true,null,null)'),/permission denied/);
 }
 await s.db.exec('RESET ROLE;SET ROLE service_role');
});

test('review queue counts match active filtering and AI snapshots carry source dates',async()=>{
 const snapshot=(await s.db.query('select public.mail_ai_snapshot($1) result',[id])).rows[0].result;
 assert.ok(snapshot.messages.length>0);assert.match(snapshot.messages[0].received_at,/^\d{4}-\d{2}-\d{2}T.*Z$/);
 await s.db.query("update public.email_threads set status='archived' where id=$1",[id]);
 assert.equal((await list({review:'pending'})).total,0);
 assert.equal((await list({review:'pending',status:'archived'})).total,1);
 assert.equal((await(await call({action:'status'})).json()).triageStats.unreviewed,0);
 await s.db.query("update public.email_threads set status='new' where id=$1",[id]);
});
test('attachment-only source updates persist metadata, invalidate old review and requeue the original',async()=>{
 const message=(await s.db.query('select * from public.email_messages where thread_id=$1 limit 1',[id])).rows[0];const before=await thread();
 assert.equal((await(await call({action:'review',id,revision:before.revision,reviewed:true})).json()).saved,true);
 const lease=(await s.db.query("select public.mail_sync_claim('veryvera@nadbytecna.cz','inbox','2026-11-01T00:00:00Z') result")).rows[0].result;
 const record={external_id:message.external_id,conversation_id:message.conversation_id||'synthetic-conversation',internet_message_id:message.internet_message_id,sender_email:message.sender_email,sender_name:message.sender_name,subject:message.subject,body_text:message.body_text,received_at:message.received_at,has_attachments:true,body_truncated:true,source_change_key:'synthetic-new-source-revision'};
 const commit=(await s.db.query("select public.mail_sync_commit($1,$2::jsonb,'[]','synthetic-metadata-cursor',true,$3) result",[lease.lease,JSON.stringify([record]),process.env.GDPR_HASH_SECRET])).rows[0].result;assert.equal(commit.imported,1);
 const saved=(await s.db.query('select has_attachments,body_truncated,source_change_key from public.email_messages where id=$1',[message.id])).rows[0];assert.deepEqual(saved,{has_attachments:true,body_truncated:true,source_change_key:'synthetic-new-source-revision'});
 const after=await thread();assert.ok(after.revision>before.revision);assert.notEqual(after.reviewed_revision,after.revision);
 const snapshot=(await s.db.query('select public.mail_ai_snapshot($1) result',[id])).rows[0].result;assert.equal(snapshot.messages[0].body_truncated,true);
 assert.equal((await s.db.query('select status from private.mail_archive_jobs where message_id=$1',[message.id])).rows[0].status,'pending');
});
