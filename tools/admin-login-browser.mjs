import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from '@playwright/test';
import { startAdminServer, token } from '../tests/helpers/admin-server.mjs';
const s=await startAdminServer();
const browser=await chromium.launch({channel:process.env.ADMIN_BROWSER_CHANNEL||'chrome'});
const checks=[];
try {
 const ctx=await browser.newContext();
 let challenge, exchanges=0;
 await ctx.route('https://**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='offline.supabase.invalid')return route.abort();
  if(url.pathname==='/auth/v1/otp'){
   const body=request.postDataJSON();assert.equal(body.email,'admin@example.invalid');assert.equal(body.code_challenge_method,'s256');challenge=body.code_challenge;
   return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  }
  if(url.pathname==='/auth/v1/token'){
   const body=request.postDataJSON();assert.equal(body.auth_code,'synthetic-code');assert.equal(crypto.createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);exchanges++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',expires_in:3600})});
  }
  return route.abort();
 });
 const first=await ctx.newPage();await first.goto(s.url+'/admin/');await first.locator('#admin-email').fill('admin@example.invalid');await first.locator('#admin-send').click();await first.getByText(/Otevřete poslední odkaz/).waitFor();
 assert.ok(challenge);checks.push('OTP request uses a real browser-generated S256 challenge');
 const callback=await ctx.newPage();await callback.goto(s.url+'/admin/?code=synthetic-code');await callback.locator('.story-card').first().waitFor();
 assert.equal(exchanges,1);assert.equal(new URL(callback.url()).search,'');checks.push('new-tab callback exchanges matching PKCE proof and loads local authenticated API');
 const stored=await callback.evaluate(()=>({pending:localStorage.getItem('nadbytecna-admin-pkce'),keys:Object.keys(localStorage),session:JSON.parse(sessionStorage.getItem('nadbytecna-admin'))}));
 assert.equal(stored.pending,null);assert.equal(stored.keys.includes('nadbytecna-admin'),false);assert.equal(stored.session.access_token,token);checks.push('pending proof removed; access and refresh tokens stay out of persistent storage');
 const replay=await ctx.newPage();await replay.goto(s.url+'/admin/?code=synthetic-code');await replay.getByText(/Požádejte zde o nový odkaz/).waitFor();assert.equal(exchanges,1);checks.push('callback without proof does not exchange a code or sign in');
 await ctx.close();
 const result={environment:'offline browser + actual local API; simulated Supabase OTP/token endpoints',checks:checks.length,results:checks,realAuthEmails:0};
 fs.writeFileSync(new URL('../docs/admin/login-browser-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {await browser.close();await s.close();}
