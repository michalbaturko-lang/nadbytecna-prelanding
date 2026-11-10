// Synthetic PostgreSQL + actual API/UI; no Microsoft, mail or model calls.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { startAdminServer, token } from "../tests/helpers/admin-server.mjs";
const root=path.resolve(new URL("../",import.meta.url).pathname);
const out=process.env.MAIL_AI_ARTIFACT_DIR || path.join(root,"docs/admin/screenshots");
fs.mkdirSync(out,{recursive:true});
const s=await startAdminServer();
const browser=await chromium.launch({channel:process.env.ADMIN_BROWSER_CHANNEL||"chrome"});
const results=[];
try {
  const lease=(await s.db.query("select mail_sync_claim('veryvera@nadbytecna.cz','inbox','1970-01-01T00:00:00Z') d")).rows[0].d;
  const now=Date.now();
  const messages=[
    {external_id:"priority-old",conversation_id:"priority-old",sender_email:"old@example.invalid",subject:"Starší naléhavý test",body_text:"Pouze syntetická zpráva.",received_at:new Date(now-864e5).toISOString()},
    {external_id:"priority-new",conversation_id:"priority-new",sender_email:"new@example.invalid",subject:"Novější běžný test",body_text:"Pouze syntetická zpráva.",received_at:new Date(now-3600000).toISOString()},
  ];
  await s.db.query("select mail_sync_commit($1,$2::jsonb,'[]'::jsonb,'synthetic-cursor',true,$3)",[lease.lease,JSON.stringify(messages),"synthetic-only-hash-secret-for-local-tests"]);
  await s.db.exec("update email_threads set admin_urgency='acute' where conversation_id='priority-old'; update email_threads set admin_urgency='high' where conversation_id='priority-new'");
  const axe=fs.readFileSync(path.join(root,"node_modules/axe-core/axe.min.js"),"utf8");
  for(const width of [375,1440]){
    const ctx=await browser.newContext({viewport:{width,height:1100}});
    await ctx.addInitScript(t=>sessionStorage.setItem("nadbytecna-admin",JSON.stringify({access_token:t,expires_at:Date.now()+3600000})),token);
    const page=await ctx.newPage();
    await page.goto(s.url+"/admin/");
    await page.getByRole("button",{name:"E-maily",exact:true}).click();
    await page.getByRole("heading",{name:"Starší naléhavý test",exact:true}).waitFor();
    const first=()=>page.locator("#mail-cards article h2").first().textContent();
    assert.equal(await first(),"Starší naléhavý test");
    assert.match(await page.locator("#mail-sync-status").textContent(),/AI analýza je vypnutá/);
    assert.match(await page.locator("#mail-sync-status").textContent(),/Čeká na automatickou AI: 3/);
    await page.locator("#mail-sort").selectOption("newest");
    await page.waitForFunction(()=>document.querySelector("#mail-cards article h2")?.textContent==="Novější běžný test");
    await page.locator("#mail-sort").selectOption("urgency");
    await page.waitForFunction(()=>document.querySelector("#mail-cards article h2")?.textContent==="Starší naléhavý test");
    await page.getByText("Hledání a filtry e-mailů",{exact:true}).click();
    await page.locator("#mail-filter-urgency").selectOption("high");
    await page.waitForFunction(()=>document.querySelectorAll("#mail-cards article").length===1);
    assert.equal(await first(),"Novější běžný test");
    await page.getByRole("button",{name:"Zrušit filtry e-mailů",exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll("#mail-cards article").length===3);
    assert.equal(await first(),"Starší naléhavý test");
    assert.equal(await page.locator("#mail-sort").inputValue(),"urgency");
    await page.addScriptTag({content:axe});
    const accessibility=await page.evaluate(()=>axe.run(document,{runOnly:["wcag2a","wcag2aa","wcag21aa","best-practice"]}));
    assert.deepEqual(accessibility.violations.map(v=>v.id),[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.screenshot({path:path.join(out,width+"-mail-ai-priority.png"),fullPage:false});
    results.push({width,priorityOrder:true,dateAlternative:true,filterAndReset:true,disabledAiAndQueuedCount:true,axeViolations:0,overflow:false});
    await ctx.close();
  }
  // A leased job is visible as processing without calling a model.
  await s.db.query("select mail_ai_claim()");
  const ctx=await browser.newContext();
  await ctx.addInitScript(t=>sessionStorage.setItem("nadbytecna-admin",JSON.stringify({access_token:t,expires_at:Date.now()+3600000})),token);
  const page=await ctx.newPage();await page.goto(s.url+"/admin/");
  await page.getByRole("button",{name:"E-maily",exact:true}).click();
  await page.getByText(/Právě se zpracovává: 1/).waitFor();
  results.push({processingCountVisible:true});
  assert.equal(s.metrics.ai,0);assert.equal(s.metrics.graph,0);assert.equal(s.metrics.external,0);
  fs.writeFileSync(path.join(root,"docs/admin/mail-ai-browser-results.json"),JSON.stringify({date:new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Prague"}),environment:"local synthetic PostgreSQL/API; no provider calls",results,realModelCalls:0,realGraphCalls:0},null,2)+"\n");
  console.log("Mail AI browser checks passed: "+results.length);
  await ctx.close();
} finally {await browser.close();await s.close();}
