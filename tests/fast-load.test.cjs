const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('index.html','utf8');
const group='fixture-backend-000000000000';
const SK='tg-group-'+group+':tg-startup-live:qa-beta';
async function waitFor(check,label){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('expected page state did not arrive: '+(label||''));}
const liveBody=({names=['qa-alpha','qa-beta'],ticks=[],feed=[]}={})=>({s:200,d:{me:'qa-beta',roster:names,
 progress:names.map(name=>({name,data:{name,current:1,updatedAt:1,_revision:name==='qa-beta'?3:1,gens:{1:{ticks:name==='qa-beta'?ticks:[],heir:name+' founder',autoSeen:[]}}}})),
 feed,reactions:[],sync:[{name:'qa-alpha',rec:{at:50,hh:'7',m:{secret:'x'},data:{sims:[{id:'1',first:'Big',secretField:'private'}]}}}],syncKeys:['qa-alpha|7'],fams:[],famKeys:[],syncOn:true,
 votes:[{id:'v1',by:'qa-alpha',target:'qa-beta',q:'PRIVATEQ',opts:['a','b'],counts:[0,0],voters:[],closed:false,ends:Date.now()+1e6}],
 chaos:{actions:[],open:[],mine:false,wallet:{earned:9,spent:0,left:9},today:0,perDay:3},tester:false,mine:{at:5,via:'game',env:{},err:'',meta:{}}}});
function page(t,{store={},token='valid',hold=false,live=liveBody(),status=200}={}){
 const requests=[];let release;const paused=new Promise(r=>release=r);
 const dom=new JSDOM(source,{url:'https://fixture.invalid/#g='+group,runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  w.scrollTo=()=>{};
  w.localStorage.setItem('tg-g',group);
  if(token)w.localStorage.setItem('tg-group-'+group+':tg-token',token);
  w.localStorage.setItem('tg-group-'+group+':tg-last','qa-beta');
  Object.entries(store).forEach(([k,v])=>w.localStorage.setItem(k,v));
  w.fetch=async(url,options)=>{
   const r=JSON.parse(options.body);requests.push(r);
   if(hold&&r.api==='live')await paused;
   let response;
   if(r.api==='live')response=status===401?{s:401,d:{error:'session_expired'}}:live;
   else if(r.api==='names')response={s:200,d:{names:['qa-alpha','qa-beta']}};
   else if(r.api==='portrait')response={s:200,d:{portraits:[]}};
   else response={s:200,d:{}};
   return {json:async()=>response};
  };
 }});
 t.after(()=>dom.window.close());return {w:dom.window,requests,release};
}
async function snapshotFromRealLoad(t,opts){
 const a=page(t,opts);await waitFor(()=>a.w.document.querySelector('.pcard')&&a.w.localStorage.getItem(SK),'first load saves');
 return a.w.localStorage.getItem(SK);
}

test('a successful live answer is saved: shared screen data only, per player and deployment',async t=>{
 const raw=await snapshotFromRealLoad(t,{live:liveBody({feed:[{id:'f1',who:'qa-alpha',at:1,type:'post',text:'hello',gen:1}]})});
 const c=JSON.parse(raw);
 assert.equal(c.v,1);assert.equal(c.name,'qa-beta');
 assert.deepEqual(c.roster,['qa-alpha','qa-beta']);assert.equal(c.feed[0].text,'hello');
 for(const secret of ['PRIVATEQ','wallet','secretField','private','"secret"','chaos','votes','"mine"','env'])assert.equal(raw.includes(secret),false,'must not store '+secret);
 assert.equal(c.tag!==undefined&&c.tag!=='valid',true,'the token itself is never stored');
 assert.equal(raw.includes('valid'),false);
});

test('cached data paints immediately, read-only, then the fresh answer replaces it',async t=>{
 const raw=await snapshotFromRealLoad(t);
 const b=page(t,{store:{[SK]:raw},hold:true,live:liveBody({names:['qa-alpha','qa-beta','qa-gamma'],ticks:[0]})});
 await waitFor(()=>b.w.document.querySelectorAll('.pcard').length===2,'cached cards');
 const d=b.w.document;
 assert.ok(d.querySelector('#updating'));assert.match(d.querySelector('#updating').textContent,/Updating/);
 assert.equal(d.querySelector('#v-hood').hasAttribute('inert'),true);
 assert.equal(d.querySelector('#v-hood').hidden,false);
 assert.equal(d.querySelector('#tabs').hidden,true);
 assert.equal(b.w.eval('ME'),'');assert.equal(b.w.eval('MINE'),null);assert.equal(b.w.eval('outbox.length'),0);assert.equal(b.w.eval('dirty'),false);
 assert.equal(b.w.localStorage.getItem('tg-group-'+group+':tg-mine-qa-beta'),null);
 assert.deepEqual(b.requests.map(r=>r.api),['live']);
 b.release();
 await waitFor(()=>d.querySelectorAll('.pcard').length===3&&!d.querySelector('#updating'),'fresh data');
 assert.equal(d.querySelector('#v-hood').hasAttribute('inert'),false);assert.equal(d.querySelector('#v-hood').classList.contains('preview'),false);
 assert.equal(b.w.eval('ME'),'qa-beta');assert.equal(d.querySelector('#tabs').hidden,false);
 assert.deepEqual(b.requests.filter(r=>['progress','event'].includes(r.api)),[]);
});

test('cached progress is never used as the player\'s saved progress',async t=>{
 const raw=await snapshotFromRealLoad(t,{live:liveBody({ticks:[1,2,3]})});
 assert.match(raw,/"ticks":\[1,2,3\]/);
 const b=page(t,{store:{[SK]:raw},hold:true,live:liveBody({ticks:[]})});
 await waitFor(()=>b.w.document.querySelector('.pcard'));
 assert.equal(b.w.eval('MINE'),null);
 b.release();await waitFor(()=>b.w.eval('ME')==='qa-beta'&&b.w.eval('MINE')!==null,'entered');
 assert.deepEqual(b.w.eval('MINE.gens[1].ticks'),[]);assert.equal(b.w.eval('MINE._revision'),3);assert.equal(b.w.eval('dirty'),false);
 assert.equal(b.requests.some(r=>r.api==='progress'),false);
});

test('a snapshot for another session token or another player is not shown',async t=>{
 const raw=await snapshotFromRealLoad(t);
 const other=page(t,{store:{[SK]:raw},token:'different-token',hold:true});
 await new Promise(r=>setTimeout(r,60));
 assert.equal(other.w.document.querySelectorAll('.pcard').length,0);assert.equal(other.w.document.querySelector('#updating'),null);
 const c=JSON.parse(raw);c.name='qa-alpha';
 const wrongName=page(t,{store:{[SK]:JSON.stringify(c)},hold:true});
 await new Promise(r=>setTimeout(r,60));
 assert.equal(wrongName.w.document.querySelectorAll('.pcard').length,0);
 const old=JSON.parse(raw);old.at=Date.now()-8*864e5;
 const stale=page(t,{store:{[SK]:JSON.stringify(old)},hold:true});
 await new Promise(r=>setTimeout(r,60));
 assert.equal(stale.w.document.querySelectorAll('.pcard').length,0);
});

test('a rejected session removes the preview and the saved copy',async t=>{
 const raw=await snapshotFromRealLoad(t);
 const b=page(t,{store:{[SK]:raw},hold:true,status:401});
 await waitFor(()=>b.w.document.querySelectorAll('.pcard').length===2);
 b.release();
 await waitFor(()=>b.w.document.querySelector('#pickName option[value="qa-beta"]'),'login screen');
 assert.equal(b.w.document.querySelectorAll('.pcard').length,0);assert.equal(b.w.document.querySelector('#updating'),null);
 assert.equal(b.w.localStorage.getItem(SK),null);
});

test('logging out (or switching name) clears the startup copy',async t=>{
 const a=page(t);await waitFor(()=>a.w.localStorage.getItem(SK));
 a.w.eval('loggedOut("bye")');
 assert.equal(a.w.localStorage.getItem(SK),null);
 // and it does not come back from a late answer of the old session
 await new Promise(r=>setTimeout(r,40));assert.equal(a.w.localStorage.getItem(SK),null);
});
