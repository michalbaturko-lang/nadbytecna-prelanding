import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/admin-session.js',import.meta.url),'utf8');
const life=30*86400000,key='nadbytecna-admin';
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function tab(local,session=storage(),clock={now:1000000}){
 const window={localStorage:local,sessionStorage:session};vm.runInNewContext(source,{window,Date:{now:()=>clock.now}});return window.NadbytecnaAdminSession;
}
const credential={access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:1000001};
test('remembered login survives closing all tabs/reopening and expires at the fixed 30-day boundary',()=>{
 const local=storage(),clock={now:1000000},first=tab(local,storage(),clock);first.save(credential);
 const deadline=clock.now+life;assert.equal(first.load().remember_until,deadline);
 const reopened=tab(local,storage(),clock);assert.equal(reopened.load().access_token,credential.access_token);
 clock.now=deadline-1;assert.ok(reopened.load());clock.now=deadline;
 assert.equal(reopened.load(),null);assert.equal(local.getItem(key),null);
});
test('refresh retains the original deadline and stores credentials only, not mailbox content',()=>{
 const local=storage(),clock={now:1000000},a=tab(local,storage(),clock);a.save({...credential,body:'private mail',email:'private contact'});
 const previous=a.load();clock.now+=86400000;a.save({...previous,access_token:'refreshed',body:'private text'});
 assert.equal(a.load().remember_until,1000000+life);assert.equal(local.getItem(key).includes('private'),false);
});
test('legacy session-only login migrates once and logout cannot restore from another tab or old storage',()=>{
 const local=storage(),legacy=storage();legacy.setItem(key,JSON.stringify(credential));
 const a=tab(local,legacy);assert.equal(a.load().access_token,credential.access_token);assert.equal(legacy.getItem(key),null);
 const b=tab(local);assert.ok(b.load());a.clear();assert.equal(b.load(),null);assert.equal(a.load(),null);
});
test('blocked persistent storage keeps the current tab usable without promising browser restart persistence',()=>{
 const denied={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 const session=storage(),a=tab(denied,session);a.save(credential);assert.ok(a.load());assert.ok(session.getItem(key));a.clear();assert.equal(a.load(),null);
 const b=tab(denied,denied);b.save(credential);assert.ok(b.load());b.clear();assert.equal(b.load(),null);
});
test('expired persistent credentials cannot resurrect a stale legacy session',()=>{
 const local=storage(),legacy=storage();local.setItem(key,JSON.stringify({...credential,remember_until:1}));legacy.setItem(key,JSON.stringify(credential));
 assert.equal(tab(local,legacy).load(),null);assert.equal(legacy.getItem(key),null);
});
