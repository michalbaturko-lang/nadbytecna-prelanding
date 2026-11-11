import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {freshAdminDb,ADMIN,SESSION} from './helpers/admin-db.mjs';
test('30-day server window accepts a 13-hour/29-day return but absolute expiry and revocation remain final',async()=>{
 const db=await freshAdminDb();try{
 await db.exec('set role service_role');
 assert.equal((await db.query("select admin_access($1,'admin@example.invalid',$2) ok",[ADMIN,SESSION])).rows[0].ok,true);
 await db.exec('reset role');
 const original=(await db.query('select expires_at from private.admin_sessions where session_id=$1',[SESSION])).rows[0].expires_at;
 for(const age of ['13 hours','29 days']){
  await db.exec(`update private.admin_sessions set last_seen=now()-interval '${age}' where session_id='${SESSION}'`);
  await db.exec('set role service_role');assert.equal((await db.query("select admin_access($1,'admin@example.invalid',$2) ok",[ADMIN,SESSION])).rows[0].ok,true);await db.exec('reset role');
  assert.equal(String((await db.query('select expires_at from private.admin_sessions where session_id=$1',[SESSION])).rows[0].expires_at),String(original));
 }
 await db.query('select set_config(\'request.jwt.claim.sub\',$1,false),set_config(\'request.jwt.claims\',$2,false)',[ADMIN,JSON.stringify({session_id:SESSION})]);
 await db.exec('set role authenticated');assert.equal((await db.query('select private.is_admin() ok')).rows[0].ok,true);await db.exec('reset role');
 await db.exec(`update private.admin_sessions set expires_at=now()-interval '1 second' where session_id='${SESSION}'`);
 await db.exec('set role authenticated');assert.equal((await db.query('select private.is_admin() ok')).rows[0].ok,false);await db.exec('reset role');
 await db.exec('set role service_role');assert.equal((await db.query("select admin_access($1,'admin@example.invalid',$2) ok",[ADMIN,SESSION])).rows[0].ok,false);await db.exec('reset role');
 await db.exec(`update private.admin_sessions set expires_at=now()+interval '30 days',last_seen=now() where session_id='${SESSION}'`);
 await db.exec('set role service_role');assert.equal((await db.query("select admin_access($1,'admin@example.invalid',$2) ok",[ADMIN,SESSION])).rows[0].ok,false);await db.exec('reset role');
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261111141207_admin_remember_30_days.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select revoked from private.admin_sessions where session_id=$1',[SESSION])).rows[0].revoked,true);
 }finally{await db.close();}
});
