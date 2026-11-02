const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {build,marker} = require('../scripts/build-portrait-backend.cjs');
const fixture = `function api(path,body,token) { try { var me=sessionUser_(token); if(!me)return res_(401,{}); switch(path) {\n${marker}\n} return res_(404,{}); } catch(e) { return res_(500,{}); } }`;
const privatePath=process.env.PORTRAITS_BACKEND_SOURCE;
const sources=[['portable',fixture]];
if (privatePath) sources.push(['production',fs.readFileSync(privatePath,'utf8')]);
else test('production portrait integration',{skip:'set PORTRAITS_BACKEND_SOURCE to an unpatched private bundle'},()=>{});
const copy=x=>JSON.parse(JSON.stringify(x));
const image='data:image/jpeg;base64,'+Buffer.from([255,216,5,8,255,217]).toString('base64');
function setup(source) {
  let now=1700000000000, locked=false; const files=new Map(), writes=[], trashes=[], properties=new Map(), clockWrites=[];
  const ctx=vm.createContext({Utilities:{base64Decode:s=>Array.from(Buffer.from(s,'base64')),base64Encode:b=>Buffer.from(b).toString('base64')}, Date:{now:()=>now}});
  vm.runInContext(build(source),ctx);
  Object.assign(ctx,{
    sessionUser_: t=>({a:'alice',b:'bob',t:'tester'})[t]||'', bump_:()=>0, plainJson_:()=>true,
    safe_: x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30),
    sameActor_:(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase(),
    roster_:()=>({alice:'Alice',bob:'Bob',tester:'Tester'}),isTester_:x=>String(x).toLowerCase()==='tester',
    readJson_:(n,f)=>files.has(n)?copy(files.get(n)):f,
    readText_:n=>files.has(n)?JSON.stringify(files.get(n)):null,
    props_:()=>({getProperty:k=>properties.has(k)?properties.get(k):null,setProperty:(k,v)=>{assert.equal(locked,true);properties.set(k,v);clockWrites.push([k,v]);}}),
    writeJson_:(n,v)=>{assert.equal(locked,true);files.set(n,copy(v));writes.push(n)},
    trash_:n=>{assert.equal(locked,true);if(files.delete(n))trashes.push(n)},
    withLock_:fn=>{assert.equal(locked,false);locked=true;try{return fn()}finally{locked=false}},
    syncFor_:roster=>({recs:Object.keys(roster)[0]==='alice'?[{rec:{data:{sims:[{id:'sync_1'}]}}}]:[]}),
    hostLog_:()=>{},res_:(s,d)=>({s,d})
  });
  files.set('fam__alice.json',{sims:{'123':{f:'A'}}}); files.set('fam__bob.json',{sims:{'321':{}}});
  return {ctx,files,writes,trashes,properties,clockWrites,call:(token,body)=>ctx.api('portrait',body,token), tick:()=>now++};
}
for(const [label,source] of sources){
 test(`${label}: authenticated roster access, validation and separate storage`,()=>{
  const s=setup(source), put={action:'put',owner:'Alice',simId:'123',image,ifAt:0};
  assert.equal(s.call('',put).s,401); assert.equal(s.call('b',put).s,403);
  assert.equal(s.call('a',{action:'list',owner:'Tester'}).s,404);
  assert.equal(s.call('a',{action:'list',owner:'Unknown'}).s,404);
  assert.equal(s.call('t',{action:'list',owner:'Alice'}).s,200);
  assert.equal(s.call('a',{...put,simId:'missing'}).s,404);
  for(const bad of ['../a','','a.b','x'.repeat(41),'a/b']) assert.equal(s.call('a',{...put,simId:bad}).s,400);
  for(const bad of ['https://x', 'data:image/svg+xml;base64,AAAA','data:image/jpeg;base64,@@@@','data:image/jpeg;base64,AAAA','data:image/jpeg;base64,'+'A'.repeat(48004)]) assert.equal(s.call('a',{...put,image:bad}).s,400);
  assert.equal(s.writes.length,0); assert.equal(s.trashes.length,0);
  assert.equal(s.call('a',put).s,200);
  assert.deepEqual(s.writes,['portrait__alice__123.json','portraits__alice.json']);
  assert.equal(s.call('b',{action:'get',owner:'Alice',simId:'123'}).d.image,image);
  assert.equal(s.call('b',{action:'list',owner:'Alice'}).d.portraits[0].simId,'123');
  assert.equal(s.call('a',{action:'put',owner:'Alice',simId:'sync_1',image,ifAt:0}).s,200);
  assert.equal(s.call('a',{action:'get',owner:'Alice',simId:'missing'}).s,404);
  assert.equal(s.files.get('fam__alice.json').sims['123'].f,'A');
 });
 test(`${label}: repeated puts repair index and removal is safe`,()=>{
  const s=setup(source), put={action:'put',owner:'Alice',simId:'123',image,ifAt:0}, remove={action:'remove',owner:'Alice',simId:'123',ifAt:0};
  const at=s.call('a',put).d.at; s.tick();
  assert.equal(s.call('a',put).d.at,at); assert.equal(s.writes.length,2);
  s.files.delete('portraits__alice.json'); assert.equal(s.call('a',put).d.at,at);
  assert.equal(s.writes.filter(n=>n==='portrait__alice__123.json').length,1);
  assert.equal(s.call('b',remove).s,403); assert.equal(s.call('a',{...remove,ifAt:at}).s,200); assert.equal(s.call('a',remove).s,200);
  assert.equal(s.trashes.length,1); assert.equal(s.call('a',{...remove,action:'get'}).s,404);
 });
 test(`${label}: index bound is fail closed`,()=>{
  const s=setup(source); s.files.set('portraits__alice.json',Array.from({length:900},(_,i)=>({simId:'x'+i,at:1})));
  assert.equal(s.call('a',{action:'put',owner:'Alice',simId:'123',image,ifAt:0}).d.error,'portrait_limit'); assert.equal(s.writes.length,0);
 });
 test(`${label}: compare-and-swap prevents stale changes`,()=>{
  const s=setup(source), first={action:'put',owner:'Alice',simId:'123',image,ifAt:0};
  const newer='data:image/jpeg;base64,'+Buffer.from([255,216,12,255,217]).toString('base64');
  const a=s.call('a',first); assert.equal(a.s,200); const at=a.d.at;
  assert.equal(s.call('a',{...first,image:newer}).d.error,'portrait_conflict');
  assert.equal(s.call('a',{...first,ifAt:999}).d.dup,true);
  assert.equal(s.call('a',{action:'remove',owner:'Alice',simId:'123',ifAt:0}).d.error,'portrait_conflict');
  assert.equal(s.writes.length,2); assert.equal(s.trashes.length,0);
  const b=s.call('a',{...first,image:newer,ifAt:at}); assert.equal(b.s,200); assert.equal(b.d.at,at+1);
  assert.equal(s.call('a',{...first,ifAt:at}).d.error,'portrait_conflict');
  assert.equal(s.call('a',{action:'remove',owner:'Alice',simId:'123',ifAt:at}).d.error,'portrait_conflict');
  assert.equal(s.call('a',{action:'remove',owner:'Alice',simId:'123',ifAt:b.d.at}).s,200);
  assert.equal(s.call('a',{action:'remove',owner:'Alice',simId:'123',ifAt:at}).s,200);
  assert.equal(s.call('a',{...first,ifAt:-1}).s,400); assert.equal(s.call('a',{...first,ifAt:undefined}).s,400);
 });
 test(`${label}: corrupt existing records cannot be overwritten or removed`,()=>{
  const s=setup(source), name='portrait__alice__123.json';
  s.files.set(name,{at:1,image:'invalid'});
  const put={action:'put',owner:'Alice',simId:'123',image,ifAt:0};
  assert.equal(s.call('a',put).s,500); assert.equal(s.call('a',{...put,action:'remove'}).s,500);
  assert.equal(s.writes.length,0); assert.equal(s.trashes.length,0);
 });
 test(`${label}: owner clock prevents deletion and recreation from reusing a version`,()=>{
  const s=setup(source), put={action:'put',owner:'Alice',simId:'123',image,ifAt:0};
  const first=s.call('a',put).d.at; assert.equal(s.clockWrites.length,1);
  assert.equal(s.call('a',{...put,ifAt:999}).d.dup,true); assert.equal(s.clockWrites.length,1);
  assert.equal(s.call('a',{action:'remove',owner:'Alice',simId:'123',ifAt:first}).s,200);
  const next=s.call('a',put).d.at; assert.equal(next,first+1);
  assert.equal(s.call('a',{action:'remove',owner:'Alice',simId:'123',ifAt:first}).d.error,'portrait_conflict');
  assert.equal(s.clockWrites.length,2); assert.equal(s.properties.get('portrait_clock_alice'),String(next));
 });
 test(`${label}: missing clock uses existing timestamp and invalid clocks fail closed`,()=>{
  const s=setup(source), put={action:'put',owner:'Alice',simId:'123',image,ifAt:0};
  const first=s.call('a',put).d.at; s.properties.delete('portrait_clock_alice');
  const other='data:image/jpeg;base64,'+Buffer.from([255,216,9,255,217]).toString('base64');
  const second=s.call('a',{...put,image:other,ifAt:first}).d.at; assert.equal(second,first+1);
  for(const bad of ['','-1','nan',String(Number.MAX_SAFE_INTEGER),String(Number.MAX_SAFE_INTEGER+1)]) {
    s.properties.set('portrait_clock_alice',bad); const writes=s.writes.length, clocks=s.clockWrites.length;
    assert.equal(s.call('a',{...put,ifAt:second}).s,500); assert.equal(s.writes.length,writes); assert.equal(s.clockWrites.length,clocks);
  }
 });
}
test('builder is single-use, rejects route drift and preserves all other bytes',()=>{
 const module=fs.readFileSync(path.join(__dirname,'../gas/Portraits.gs'),'utf8');
 for(const [,source] of sources){ const out=build(source); assert.throws(()=>build(out),/already present/);
  const restored=out.slice(0,-('\n'+module+'\n').length).replace("\n      case 'portrait': return portraitAction_(me, body);",'');
  assert.equal(restored,source);
 }
 assert.throws(()=>build(fixture.replace("case 'helper'","case 'changed'")),/marker/);
 assert.throws(()=>build(fixture+marker),/marker/);
});
