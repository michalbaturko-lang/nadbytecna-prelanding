import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {startAdminServer,token} from './helpers/admin-server.mjs';import {STORY} from './helpers/admin-db.mjs';
let s;test.before(async()=>{s=await startAdminServer()});test.after(async()=>{await s?.close()});
const list=async()=>{const r=await s.fetch(s.url+'/api/admin/',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'list',filters:{sort:'oldest'}})});assert.equal(r.status,200);return r.json()};
test('story list provides bounded fresh previews without returning full message or transcript',async()=>{
 await s.db.query("update public.stories set story_text=$1 where id=$2",['Začátek příběhu. '+ 'Dlouhý text. '.repeat(500),STORY]);
 let d=await list(),r=d.rows.find(r=>r.id===STORY);assert.ok(r);assert.match(r.preview,/Začátek příběhu/);assert.ok(r.preview.length<=180);assert.equal('body' in r,false);assert.equal('transcript'in r,false);
 await s.db.query("update public.stories set story_text='Aktualizované znění.' where id=$1",[STORY]);d=await list();assert.equal(d.rows.find(r=>r.id===STORY).preview,'Aktualizované znění.');
});
test('preview view is service-only and migration reapplication preserves grants and records',async()=>{
 for(const role of ['anon','authenticated']){await s.db.exec('set role '+role);await assert.rejects(s.db.query('select preview from public.admin_inbox_records'),/permission denied/);await s.db.exec('reset role')}
 const count=(await s.db.query('select count(*) n from public.stories')).rows[0].n;
 await s.db.exec(fs.readFileSync(new URL('../supabase/migrations/20261111153428_admin_inbox_previews.sql',import.meta.url),'utf8'));
 assert.equal((await s.db.query('select count(*) n from public.stories')).rows[0].n,count);assert.equal((await s.db.query("select reloptions from pg_class where oid='public.admin_inbox_records'::regclass")).rows[0].reloptions.includes('security_invoker=true'),true);
});
test('mail list preview follows the newest stored text, is bounded and retains attachment/count metadata',async()=>{
 const id=(await s.db.query('select id from public.email_messages limit 1')).rows[0].id;
 await s.db.query('update public.email_messages set body_text=$1,has_attachments=true where id=$2',['Dobrý den,\n\nnová zpráva. '+'Text '.repeat(500),id]);
 let d=(await s.db.query("select public.mail_list_sorted('{}') d")).rows[0].d;assert.equal(d.rows.length,1);assert.match(d.rows[0].preview,/Dobrý den, nová zpráva/);assert.ok(d.rows[0].preview.length<=180);assert.equal(d.rows[0].has_attachments,true);assert.equal(d.rows[0].message_count,1);assert.equal('body_text' in d.rows[0],false);
});
