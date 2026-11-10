import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { freshAdminDb } from "./helpers/admin-db.mjs";
let db, high, overridden, unknown;
test.before(async () => {
  db = await freshAdminDb();
  for (const name of ["20261109000000_admin_mail.sql","20261110211416_mail_priority_sort.sql"])
    await db.exec(fs.readFileSync(new URL("../supabase/migrations/"+name,import.meta.url),"utf8"));
  await db.exec("SET ROLE service_role");
  for (let i=0;i<26;i++) await db.query(`INSERT INTO email_threads(mailbox,conversation_id,subject,last_received_at,admin_urgency,admin_category)
    VALUES('veryvera@nadbytecna.cz',$1,'Syntetický test',now()-make_interval(mins=>$2),'low','pravni')`,["thread-"+i,i]);
  high=randomUUID();overridden=randomUUID();unknown=randomUUID();
  await db.query(`INSERT INTO email_threads(id,mailbox,conversation_id,subject,last_received_at,ai_urgency,admin_urgency) VALUES
    ($1,'veryvera@nadbytecna.cz','old-acute','Syntetický akutní případ',now()-interval '30 days','acute',null),
    ($2,'veryvera@nadbytecna.cz','human-low','Synteticky snížená priorita',now()-interval '1 hour','acute','low'),
    ($3,'veryvera@nadbytecna.cz','unknown','Synteticky nezařazeno',now(),null,null)`,[high,overridden,unknown]);
});
test.after(async()=>{await db?.close();});
const list=async(filters={})=>(await db.query("select public.mail_list_sorted($1::jsonb) d",[JSON.stringify(filters)])).rows[0].d;
test("priority applies across pagination; human urgency wins and unknown is last",async()=>{
  const first=await list();const next=await list({page:1});
  assert.equal(first.total,29);assert.equal(first.rows[0].id,high);
  const all=[...first.rows,...next.rows];assert.equal(new Set(all.map(r=>r.id)).size,29);
  assert.equal(all.at(-1).id,unknown);
  assert.equal(all.find(r=>r.id===overridden).urgency,"low");
  assert.equal(first.rows[0].conversation_id,undefined);assert.equal(first.rows[0].mailbox,undefined);
});
test("date alternatives, filtered counts and out-of-range pages remain consistent",async()=>{
  assert.equal((await list({sort:"oldest"})).rows[0].id,high);
  assert.equal((await list({sort:"newest"})).rows[0].id,unknown);
  const filtered=await list({urgency:"acute"});assert.equal(filtered.total,1);assert.equal(filtered.rows[0].id,high);
  const empty=await list({page:20});assert.equal(empty.rows.length,0);assert.equal(empty.total,29);
});
test("invalid sorts are rejected and SQL-looking search remains literal",async()=>{
  await assert.rejects(list({sort:"urgency; DROP TABLE email_threads"}),/mail_sort/);
  assert.equal((await list({q:"'; DROP TABLE email_threads;--"})).total,0);
  assert.equal((await list()).total,29);
});
test("anonymous and authenticated roles cannot invoke the service-only list",async()=>{
  for(const role of ["anon","authenticated"]){
    try{await db.exec("SET ROLE "+role);await assert.rejects(list(),/permission denied/);}
    finally{await db.exec("RESET ROLE");await db.exec("SET ROLE service_role");}
  }
});
