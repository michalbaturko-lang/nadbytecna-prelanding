import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium,expect } from '@playwright/test';
import { startAdminServer,token } from '../tests/helpers/admin-server.mjs';
import { summarize } from '../lib/shop-orders.mjs';
import { runMailRules } from '../lib/mail-rules-worker.mjs';
const out=process.env.OVERVIEW_OUTPUT||'/tmp/nadbytecna-shop-mail-overview';fs.mkdirSync(out,{recursive:true});
const s=await startAdminServer(),b=await chromium.launch({executablePath:process.env.ADMIN_BROWSER_EXECUTABLE||'/Users/mbo/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const now=new Date('2026-11-12T17:00:00Z');
const rows=Array.from({length:115},(_,i)=>({name:'#'+(1001+i),created_at:i<12?'2026-11-12T12:15:00Z':'2026-11-11T15:25:00Z',currency:i%15?'CZK':'EUR',total:i%15?1290:52,total_czk:1290,items_qty:i%10?1:2,country:i%15?'CZ':'SK',financial_status:'PAID',shipping_method:i%2?'Doručení domů':'Výdejní místo',utm_source:i%3?'přímý vstup':'Vyhledávání'}));
const fixture={generatedAt:now.toISOString(),sync:{last_webhook_at:now.toISOString(),last_reconcile_at:now.toISOString()},...summarize(rows,now),traffic:{today:517,total:1087,conversion:{today:2.32,total:10.58}}};
const axe=fs.readFileSync(new URL('../node_modules/axe-core/axe.min.js',import.meta.url),'utf8');const checks=[];
try{
 await runMailRules({env:{},rpc:async(name,args)=>{const r=await s.adapter('https://offline.supabase.invalid/rest/v1/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer synthetic-service','Content-Type':'application/json'},body:JSON.stringify(args)});assert.ok(r.ok);return r.json();}});
 for(const width of [375,768,1440,1920]){
 const c=await b.newContext({viewport:{width,height:1000}});await c.route('https://**/*',r=>r.abort());await c.addInitScript(t=>sessionStorage.setItem('nadbytecna-admin',JSON.stringify({access_token:t,expires_at:Date.now()+3600000})),token);
 await c.route('**/api/admin-shop/',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}));
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(s.url+'/admin/');await p.locator('#admin-view-shop').click();await expect(p.locator('.shop-metrics')).toBeVisible();await expect(p.locator('.shop-metrics .shop-metric')).toHaveCount(4);await expect(p.locator('.shop-metrics .shop-metric').nth(1)).toContainText('Celkem 115');
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(await p.evaluate(()=>{const a=document.querySelector('#shop-title').getBoundingClientRect(),b=document.querySelector('#shop-refresh').getBoundingClientRect();return a.right<=b.left && a.width>150;}));
 await p.addScriptTag({content:axe});const a=await p.evaluate(()=>axe.run(document,{runOnly:['wcag2a','wcag2aa','wcag21aa','best-practice']}));assert.deepEqual(a.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 if([375,1440].includes(width))await p.screenshot({path:out+'/'+width+'-shop.png',fullPage:true});
 await p.locator('#admin-view-mail').click();await expect(p.locator('#mail-cards article')).toHaveCount(1);await p.locator('#mail-topic').selectOption('newsletter');await expect(p.locator('#mail-cards article')).toHaveCount(0);await expect(p.locator('#mail-filter-label')).toHaveValue('newsletter');await p.locator('#mail-topic').selectOption('');await expect(p.locator('#mail-cards article')).toHaveCount(1);await p.locator('#mail-topic').selectOption('suspected_fraud');await expect(p.locator('#mail-filter-disposition')).toHaveValue('all');await p.locator('#mail-filters summary').click();await p.locator('#mail-reset').click();await expect(p.locator('#mail-topic')).toHaveValue('');await expect(p.locator('#mail-cards article')).toHaveCount(1);
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);if([375,1440].includes(width))await p.screenshot({path:out+'/'+width+'-mail.png'});checks.push({width,shop:true,topicFilter:true,overflow:false,axeViolations:0});await c.close();
 }console.log(JSON.stringify(checks));
}finally{await b.close();await s.close();}
