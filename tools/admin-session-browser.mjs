import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from '@playwright/test';
import {startAdminServer,token} from '../tests/helpers/admin-server.mjs';
const s=await startAdminServer(),browser=await chromium.launch({channel:'chrome'}),checks=[];
const key='nadbytecna-admin',life=30*86400000;let refreshes=0,hold=false,started,release;
async function route(ctx){await ctx.route('https://**/*',async r=>{
 const req=r.request(),u=new URL(req.url());
 if(u.hostname!=='offline.supabase.invalid')return r.abort();
 if(u.pathname==='/auth/v1/token'&&u.searchParams.get('grant_type')==='refresh_token'){
  refreshes++;assert.ok(req.postDataJSON().refresh_token);
  if(hold){started();await new Promise(resolve=>release=resolve);}
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:token,refresh_token:'rotated-'+refreshes,expires_in:3600})});
 }
 if(u.pathname==='/auth/v1/logout')return r.fulfill({status:204});return r.abort();
});}
try{
 let ctx=await browser.newContext();await route(ctx);const deadline=Date.now()+life;
 await ctx.addInitScript(({token,deadline,key})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({access_token:token,refresh_token:'initial',expires_at:Date.now()-1000,remember_until:deadline}));},{token,deadline,key});
 const a=await ctx.newPage(),b=await ctx.newPage();await Promise.all([a.goto(s.url+'/admin/'),b.goto(s.url+'/admin/')]);
 await Promise.all([a.locator('.story-card').first().waitFor(),b.locator('.story-card').first().waitFor()]);
 assert.equal(refreshes,1);assert.equal(await b.evaluate(k=>JSON.parse(localStorage.getItem(k)).remember_until,key),deadline);checks.push('concurrent tabs share one token refresh and keep the original deadline');
 const persisted=await ctx.storageState();await ctx.close();
 ctx=await browser.newContext({storageState:persisted});await route(ctx);const returned=await ctx.newPage();await returned.goto(s.url+'/admin/');await returned.locator('.story-card').first().waitFor();checks.push('closing all tabs and recreating browser context restores the existing login without email');
 const aged=await browser.newContext({storageState:persisted});await route(aged);await aged.addInitScript(()=>{const native=Date.now;Date.now=()=>native()+29*86400000;});
 const day29=await aged.newPage();await day29.goto(s.url+'/admin/');await day29.locator('.story-card').first().waitFor();assert.equal(await day29.evaluate(k=>JSON.parse(localStorage.getItem(k)).remember_until,key),deadline);await aged.close();checks.push('return after 29 days refreshes access without extending the remembered-login deadline');
 const expired=await browser.newContext({storageState:persisted});await route(expired);await expired.addInitScript(()=>{const native=Date.now;Date.now=()=>native()+31*86400000;});
 const day31=await expired.newPage();await day31.goto(s.url+'/admin/');await day31.locator('#admin-login').waitFor();assert.equal(await day31.locator('#admin-app').isVisible(),false);assert.equal(await day31.evaluate(k=>localStorage.getItem(k),key),null);await expired.close();checks.push('after 30 days credentials are removed and protected content is not rendered');
 const peer=await ctx.newPage();await peer.goto(s.url+'/admin/');await peer.locator('.story-card').first().waitFor();
 await peer.evaluate(k=>{const v=JSON.parse(localStorage.getItem(k));v.expires_at=Date.now()-1;localStorage.setItem(k,JSON.stringify(v));},key);
 hold=true;const pending=new Promise(resolve=>started=resolve);await peer.locator('#admin-view-mail').click();await pending;
 await returned.locator('#admin-out').click();await returned.locator('#admin-login').waitFor();await peer.locator('#admin-login').waitFor();release();
 await peer.waitForTimeout(150);assert.equal(await peer.evaluate(k=>localStorage.getItem(k),key),null);assert.equal(await peer.locator('.story-card').count(),0);assert.equal(await peer.locator('#mail-cards').innerText(),'');
 checks.push('logout clears both tabs and a late refresh cannot restore credentials or private content');
 await peer.reload();await peer.locator('#admin-login').waitFor();assert.equal(await peer.locator('#admin-app').isVisible(),false);checks.push('reopening after explicit logout stays logged out');await ctx.close();
 const result={checks:checks.length,results:checks,environment:'offline browser with real local API/database and simulated Auth refresh; no real credentials or emails'};fs.writeFileSync(new URL('../docs/admin/session-browser-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await s.close();}
