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
 let challenge, exchanges=0, otpStatus=200;
 await ctx.route('https://**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='offline.supabase.invalid')return route.abort();
  if(url.pathname==='/auth/v1/otp'){
   const body=request.postDataJSON();assert.equal(body.email,'admin@example.invalid');assert.equal(body.code_challenge_method,'s256');challenge=body.code_challenge;
   return route.fulfill({status:otpStatus,contentType:'application/json',body:otpStatus===200?'{}':JSON.stringify({code:'over_email_send_rate_limit'})});
  }
  if(url.pathname==='/auth/v1/token'){
   const body=request.postDataJSON();assert.equal(body.auth_code,'synthetic-code');assert.equal(crypto.createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);exchanges++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',expires_in:3600})});
  }
  return route.abort();
 });
 const first=await ctx.newPage();await first.goto(s.url+'/admin/');await first.locator('#admin-email').fill('admin@example.invalid');await first.locator('#admin-send').click();await first.getByText(/Otevřete poslední odkaz/).waitFor();
 assert.ok(challenge);checks.push('OTP request uses a real browser-generated S256 challenge');
 const initialChallenge=challenge;
 const initialProof=await first.evaluate(()=>localStorage.getItem('nadbytecna-admin-pkce'));
 otpStatus=429;await first.locator('#admin-send').click();await first.getByText(/Odesílání přihlašovacích e-mailů je dočasně omezené/).waitFor();
 assert.equal(challenge,initialChallenge);assert.equal(await first.evaluate(()=>localStorage.getItem('nadbytecna-admin-pkce')),initialProof);
 checks.push('rate-limited resend explains the limit and preserves the original unexpired proof and challenge');
 const sans=await first.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily);assert.match(sans,/^Jost,/);assert.match(sans,/sans-serif/);assert.doesNotMatch(sans,/Playfair|Georgia/);
 checks.push('admin main heading uses the Jost sans-serif font');
 for(const path of ['/','/sdilet-pribeh/','/mohu-pomoci/']){
  const publicPage=await ctx.newPage();await publicPage.goto(s.url+path);await publicPage.evaluate(()=>document.fonts.ready);
  const families=await publicPage.locator('h1,h2,h3,p,label,button,input,select,textarea').evaluateAll(els=>els.filter(e=>e.getClientRects().length).map(e=>getComputedStyle(e).fontFamily));
  assert.ok(families.length);assert.ok(families.every(f=>f.startsWith('Jost,')),path+': '+families.join(';'));await publicPage.close();
 }
 checks.push('public homepage and both forms render visible text and controls in Jost');
 const callback=await ctx.newPage();await callback.goto(s.url+'/admin/?code=synthetic-code');await callback.locator('.story-card').first().waitFor();
 assert.equal(exchanges,1);assert.equal(new URL(callback.url()).search,'');checks.push('new-tab callback exchanges matching PKCE proof and loads local authenticated API');
 const stored=await callback.evaluate(()=>({pending:localStorage.getItem('nadbytecna-admin-pkce'),keys:Object.keys(localStorage),session:JSON.parse(localStorage.getItem('nadbytecna-admin'))}));
 assert.equal(stored.pending,null);assert.equal(stored.keys.includes('nadbytecna-admin'),true);assert.equal(stored.session.access_token,token);assert.ok(stored.session.remember_until>Date.now());checks.push('pending proof removed; login is remembered with a fixed 30-day deadline');
 const replay=await ctx.newPage();await replay.goto(s.url+'/admin/?code=synthetic-code');await replay.locator('.story-card').first().waitFor();assert.equal(exchanges,1);checks.push('replayed callback does not exchange a code again; existing remembered login stays valid');
 await ctx.close();
 const failed=await browser.newContext();await failed.route('https://**/*',route=>route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({code:'over_email_send_rate_limit'})}));
 const failedPage=await failed.newPage();await failedPage.goto(s.url+'/admin/');await failedPage.locator('#admin-email').fill('admin@example.invalid');await failedPage.locator('#admin-send').click();await failedPage.getByText(/Odesílání přihlašovacích e-mailů je dočasně omezené/).waitFor();
 assert.equal(await failedPage.evaluate(()=>localStorage.getItem('nadbytecna-admin-pkce')),null);checks.push('a rejected first send clears its unused proof');await failed.close();
 const result={environment:'offline browser + actual local API; simulated Supabase OTP/token endpoints',checks:checks.length,results:checks,realAuthEmails:0};
 fs.writeFileSync(new URL('../docs/admin/login-browser-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {await browser.close();await s.close();}
