import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/admin-pkce.js', import.meta.url),'utf8');
const key='nadbytecna-admin-pkce';
const storage=(map=new Map())=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)});
function tab(local,session=storage(),now=1000000){const window={localStorage:local,sessionStorage:session};vm.runInNewContext(source,{window,Date:{now:()=>now}});return window.NadbytecnaAdminPkce;}
test('PKCE survives a new tab but expires and is removed after use',()=>{
 const shared=storage();const first=tab(shared);const second=tab(shared);const verifier='x'.repeat(43);
 assert.equal(first.save(verifier),true);assert.equal(second.read(),verifier);
 second.clear(verifier);assert.equal(first.read(),null);
 first.save(verifier);assert.equal(tab(shared,storage(),1900000).read(),null);assert.equal(shared.getItem(key),null);
});
test('malformed, future and missing PKCE proofs fail closed; newer login survives old cleanup',()=>{
 const shared=storage();const current=tab(shared);assert.equal(current.save('short'),false);
 for(const value of ['bad','null',JSON.stringify({verifier:'a'.repeat(43),at:1000001})]){shared.setItem(key,value);assert.equal(current.read(),null);}
 current.save('a'.repeat(43));current.save('b'.repeat(43));current.clear('a'.repeat(43));assert.equal(current.read(),'b'.repeat(43));
});
test('blocked persistent storage falls back to the requesting tab without storing login tokens',()=>{
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 const localSession=storage();const first=tab(blocked,localSession);assert.equal(first.save('z'.repeat(43)),true);
 assert.equal(first.read(),'z'.repeat(43));assert.equal(tab(blocked).read(),null);
 const saved=JSON.parse(localSession.getItem(key));assert.deepEqual(Object.keys(saved).sort(),['at','verifier']);
 assert.equal(tab(blocked,blocked).save('z'.repeat(43)),false);
});
