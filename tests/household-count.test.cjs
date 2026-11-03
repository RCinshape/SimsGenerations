const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {html}=require('./create-debug-fixture.cjs');
async function setup(t){
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});
 t.after(()=>dom.window.close());const w=dom.window;
 for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.eval(`Date.now=()=>1700000000000; LIVE.progress['qa-alpha']={name:'qa-alpha',current:1,gens:{1:{heir:'Founder Sample',heirSimId:'1'}}};
 LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:12},(_,i)=>[String(i+1),{f:i===0?'Founder':i===5?'Former':i===6?'Child':'Sim'+i,l:'Sample',...(i===0?{ps:['6'],c:['7']}:{}),...(i===6?{p:['1','6']}: {})}]))};`);
 return w;
}
const header=w=>w.eval("familyPanel('qa-alpha').querySelector('.ph').textContent");
test('last matching household count excludes historical and unflagged sims while relationships remain',async t=>{
 const w=await setup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'unrelated',data:{sims:[{id:'2',first:'Sim1',last:'Sample',inHousehold:true}]}},{at:1699827200000,hh:'legacy',data:{sims:Array.from({length:12},(_,i)=>({id:String(i+1),first:i===0?'Founder':i===5?'Former':i===6?'Child':'Sim'+i,last:'Sample',...(i<5?{inHousehold:true}:i===5?{inHousehold:false}:{})}))}}]`);
 assert.match(header(w),/5 sims in household · last recorded 2d ago/);
 const panel=w.eval("familyPanel('qa-alpha').textContent");assert.match(panel,/Former Sample/);assert.match(panel,/Child/);assert.equal(w.eval("Object.keys(famOf('qa-alpha')).length"),12);
});
test('no matching snapshot is unavailable, including a newer unrelated household',async t=>{
 const w=await setup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'unrelated',data:{sims:[{id:'99',first:'Other',inHousehold:true}]}}]`);
 assert.match(header(w),/Household count unavailable/);assert.doesNotMatch(header(w),/0 sims in household/);
 w.eval("LIVE.sync['qa-alpha']=[]");assert.match(header(w),/Household count unavailable/);
});
test('existing id preference beats newer name fallback; missing recorded time is explicit',async t=>{
 const w=await setup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'name',data:{sims:[{id:'99',first:'Founder',last:'Sample',inHousehold:true}]}},{at:0,hh:'id',data:{sims:[{id:'1',first:'Founder',last:'Sample',inHousehold:true},{id:'2',inHousehold:true},{id:'3',inHousehold:false},{id:'4'}]}}]`);
 assert.match(header(w),/2 sims in household · recorded time unknown/);
 w.eval("LIVE.sync['qa-alpha'][1].data.sims[1].inHousehold=false");assert.match(header(w),/1 sim in household · recorded time unknown/);
});
