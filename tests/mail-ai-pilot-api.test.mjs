import test from 'node:test';import assert from 'node:assert/strict';import{startAdminServer,token,otherToken}from'./helpers/admin-server.mjs';
test('pilot stays admin-only, previews with global AI off and preserves production-classification fields',async()=>{
 const s=await startAdminServer();const call=(b,t=token)=>s.fetch(s.url+'/api/admin-mail/',{method:'POST',headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:JSON.stringify(b)});
 const old=process.env.AI_EMAIL_PILOT_SAMPLE,oldKey=process.env.OPENAI_API_KEY;
 try{
 const row=(await s.db.query('SELECT * FROM public.email_threads LIMIT 1')).rows[0];
 const b={action:'ai_pilot',index:0,confirm:'TEST_AI_BEZ_ZMEN'};
 assert.equal((await call(b,'')).status,401);assert.equal((await call(b,otherToken)).status,403);assert.equal((await call(b)).status,423);
 process.env.OPENAI_API_KEY='synthetic';s.setAIResponse('success');
 process.env.AI_EMAIL_PILOT_SAMPLE=JSON.stringify({ids:[row.id],expiresAt:new Date(Date.now()+3600000).toISOString()});
 assert.equal((await call({...b,confirm:'bad'})).status,423);
 const r=await call(b);assert.equal(r.status,200);const d=await r.json();assert.equal(d.previewOnly,true);assert.equal(d.source,'real_email');assert.equal(d.id,row.id);assert.ok(d.output.summary);
 assert.deepEqual((await s.db.query('SELECT * FROM public.email_threads WHERE id=$1',[row.id])).rows[0],row);
 assert.equal(process.env.AI_TRIAGE_ENABLED,'false');assert.equal(process.env.AI_EMAIL_AUTOMATION_ENABLED,'false');assert.equal(s.metrics.ai,1);
 }finally{if(old===undefined)delete process.env.AI_EMAIL_PILOT_SAMPLE;else process.env.AI_EMAIL_PILOT_SAMPLE=old;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await s.close();}
});
