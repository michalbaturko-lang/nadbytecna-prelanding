import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { startAdminServer, token } from "../tests/helpers/admin-server.mjs";
import { runMailRules } from "../lib/mail-rules-worker.mjs";

const s=await startAdminServer(),browser=await chromium.launch(process.env.ADMIN_BROWSER_EXECUTABLE?{executablePath:process.env.ADMIN_BROWSER_EXECUTABLE}:{channel:"chrome"});
const out=process.env.LABEL_BROWSER_OUTPUT||"/tmp/nadbytecna-mail-labels-browser";fs.mkdirSync(out,{recursive:true});
const axe=fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js",import.meta.url),"utf8"),results=[];
try {
  const rules=await runMailRules({env:{},rpc:async(name,args)=>{
    const r=await s.adapter("https://offline.supabase.invalid/rest/v1/rpc/"+name,{method:"POST",headers:{Authorization:"Bearer synthetic-service","Content-Type":"application/json"},body:JSON.stringify(args)});
    if(!r.ok)throw new Error("synthetic_rpc_"+r.status);return r.json();
  }});
  assert.equal(rules.saved,1);
  for(const width of [320,375,768,1024,1440,1920]){
    const context=await browser.newContext({viewport:{width,height:1000}});await context.route("https://**/*",r=>r.abort());
    await context.addInitScript(t=>sessionStorage.setItem("nadbytecna-admin",JSON.stringify({access_token:t,expires_at:Date.now()+3600000})),token);
    const p=await context.newPage(),errors=[];p.on("pageerror",e=>errors.push(e.message));await p.goto(s.url+"/admin/");await p.locator("#admin-view-mail").click();
    await expect(p.locator("#mail-cards article")).toHaveCount(1);
    if(width<1024)await p.locator("#mail-cards .card-open").click();
    await p.getByRole("button",{name:"Štítky",exact:true}).click();
    await p.locator("#mail-add-label").selectOption("press");await p.getByRole("button",{name:"Přidat štítek",exact:true}).click();
    await expect(p.getByRole("button",{name:"Odebrat štítek Média",exact:true})).toBeVisible();
    await p.getByRole("button",{name:"Označit jako podezřelé",exact:true}).click();
    await expect(p.locator("#mail-cards article")).toHaveCount(0);
    await p.getByRole("button",{name:"Podezřelé",exact:true}).click();await expect(p.locator("#mail-cards article")).toHaveCount(1);
    if(width<1024)await p.locator("#mail-cards .card-open").click();
    await p.getByRole("button",{name:"Štítky",exact:true}).click();
    await expect(p.getByRole("button",{name:"Vrátit do pošty",exact:true})).toBeVisible();
    await p.getByRole("button",{name:"Vrátit do pošty",exact:true}).click();await expect(p.locator("#mail-cards article")).toHaveCount(0);
    await p.getByRole("button",{name:"Doručené",exact:true}).click();await expect(p.locator("#mail-cards article")).toHaveCount(1);
    if(width<1024)await p.locator("#mail-cards .card-open").click();
    await p.getByRole("button",{name:"Štítky",exact:true}).click();
    await expect(p.getByRole("button",{name:"Odebrat štítek Spam",exact:true})).toHaveCount(0);
    await p.getByRole("button",{name:"Odebrat štítek Média",exact:true}).click();
    await expect(p.getByRole("button",{name:"Odebrat štítek Média",exact:true})).toHaveCount(0);
    await p.evaluate(()=>document.fonts.ready);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await p.addScriptTag({content:axe});const a=await p.evaluate(()=>axe.run(document,{runOnly:["wcag2a","wcag2aa","wcag21aa","best-practice"]}));assert.deepEqual(a.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
    if([375,1440].includes(width))await p.screenshot({path:out+"/"+width+"-labels.png"});
    assert.deepEqual(errors,[]);results.push({width,addRemove:true,suspectRestore:true,sourceMessagesRetained:true,axeViolations:0,overflow:false});await context.close();
  }
  assert.equal((await s.db.query("SELECT count(*)::int n FROM public.email_messages")).rows[0].n,1);
  assert.equal(s.metrics.ai,0);console.log(JSON.stringify({environment:"isolated local API/database/browser",rules,results,aiCalls:0}));
}finally{await browser.close();await s.close();}
