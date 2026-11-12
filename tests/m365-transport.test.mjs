import test from 'node:test';import assert from 'node:assert/strict';
import {graphGet,graphRetryAfter} from '../lib/m365-transport.mjs';
const base={url:'https://graph.microsoft.com/v1.0/me/messages',headers:{Authorization:'Bearer synthetic-token'},sleep:async()=>{},consume:r=>r.text()};
test('read GET retries transient failures on the exact URL and never leaks source errors',async()=>{
 for(const failure of [new Response('private',{status:503}),Object.assign(new Error('private-token'),{name:'TimeoutError'}),new Error('private-network')]){
  let calls=0;const out=await graphGet({...base,fetcher:async(url,opts)=>{assert.equal(url,base.url);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');calls++;if(calls===1){if(failure instanceof Response)return failure;throw failure;}return new Response('complete');}});assert.equal(out,'complete');assert.equal(calls,2);
 }
});
test('a timeout includes a stalled body, discards partial bytes and retries cleanly',async()=>{
 let calls=0;const out=await graphGet({...base,timeoutMs:15,fetcher:async(_url,{signal})=>{calls++;if(calls===2)return new Response('whole-body');return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial'));signal.addEventListener('abort',()=>c.error(new Error('private-stall')));}}));}});assert.equal(out,'whole-body');assert.equal(calls,2);
});
test('Retry-After is respected without occupying a function for long delays; auth is not retried',async()=>{
 for(const status of [429,503]){let calls=0;await assert.rejects(graphGet({...base,fetcher:async()=>{calls++;return new Response('private',{status,headers:{'retry-after':'120'}});},sleep:()=>assert.fail()}),e=>e.code==='throttled'&&e.retryAfterSeconds===120);assert.equal(calls,1);}
 let calls=0;await assert.rejects(graphGet({...base,fetcher:async()=>{calls++;return new Response('',{status:401});},consume:()=>{throw Object.assign(new Error('private'),{code:'authentication_failed'});}}),e=>e.code==='authentication_failed'&&!e.stack.includes('private'));assert.equal(calls,1);
 assert.equal(graphRetryAfter(new Headers({'retry-after':'Thu, 12 Nov 2026 20:00:00 GMT'}),Date.parse('2026-11-12T19:59:00Z')),60);
});
test('persistent network faults are bounded to two attempts with sanitized final error',async()=>{let calls=0;await assert.rejects(graphGet({...base,fetcher:async()=>{calls++;throw new Error('private token url');}}),e=>e.code==='network_error'&&!e.stack.includes('private'));assert.equal(calls,2);});
