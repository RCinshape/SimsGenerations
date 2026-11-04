const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('index.html','utf8');
const group='fixture-backend-000000000000';
async function waitFor(check){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('expected page state did not arrive');}
function page(t,{token='valid',actor='qa-beta',reject=false,missingActor=false,hold=false,route=''}={}){
 const requests=[];let release;
 const paused=new Promise(r=>release=r);
 const dom=new JSDOM(source,{url:'https://fixture.invalid/#g='+group+route,runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  w.scrollTo=()=>{};
  w.localStorage.setItem('tg-g',group);
  if(token)w.localStorage.setItem('tg-group-'+group+':tg-token',token);
  w.localStorage.setItem('tg-group-'+group+':tg-last','qa-alpha');
  w.fetch=async(url,options)=>{
   const r=JSON.parse(options.body);requests.push(r);
   if(hold&&r.api==='live')await paused;
   let response;
   if(r.api==='live')response=reject?{s:401,d:{error:'session_expired'}}:{s:200,d:{...(missingActor?{}:{me:actor}),roster:['qa-alpha','qa-beta'],progress:['qa-alpha','qa-beta'].map(name=>({name,data:{name,current:1,updatedAt:1,gens:{1:{ticks:[],heir:name+' founder',autoSeen:[]}}}})),feed:[],reactions:[],sync:[],syncKeys:[],fams:[],famKeys:[],syncOn:false}};
   else if(r.api==='whoami')response={s:200,d:{name:actor}};
   else if(r.api==='names')response={s:200,d:{names:['qa-alpha','qa-beta']}};
   else if(r.api==='portrait')response={s:200,d:{portraits:[]}};
   else response={s:200,d:{tree:null}};
   return {json:async()=>response};
  };
 }});
 t.after(()=>dom.window.close());return {w:dom.window,requests,release};
}
test('returning google session uses one authenticated live request and its server actor',async t=>{
 const {w,requests}=page(t);await waitFor(()=>w.document.querySelector('.pcard'));
 assert.equal(w.eval('ME'),'qa-beta');
 assert.equal(w.eval('MINE.name'),'qa-beta');
 assert.deepEqual(requests.filter(r=>['live','whoami'].includes(r.api)).map(r=>r.api),['live']);
 assert.deepEqual(requests[0].b,{have:{}});
 assert.equal(requests[0].t,'valid');
 assert.equal(requests.some(r=>['progress','event'].includes(r.api)),false);
});
test('signed-out google session requests names directly without a doomed identity round trip',async t=>{
 const {w,requests}=page(t,{token:''});await waitFor(()=>w.document.querySelector('#pickName option[value="qa-beta"]'));
 assert.equal(w.eval('ME'),'');
 assert.deepEqual(requests.map(r=>r.api),['names']);
});
test('rejected and malformed authenticated snapshots do not reveal cached player data',async t=>{
 for(const options of [{reject:true},{missingActor:true}]){
  const {w,requests}=page(t,options);await waitFor(()=>w.document.querySelector('#pickName option[value="qa-beta"]'));
  assert.equal(w.eval('ME'),'');assert.equal(w.document.querySelectorAll('.pcard').length,0);
  assert.deepEqual(requests.map(r=>r.api),['live','names']);
 }
});
test('pending startup authenticates before showing a player and reuses its result for a tree route',async t=>{
 const {w,requests,release}=page(t,{hold:true,route:'&family=qa-alpha'});
 assert.equal(w.eval('ME'),'');assert.equal(w.document.querySelectorAll('.pcard').length,0);
 release();await waitFor(()=>w.document.querySelector('#family-explorer'));
 assert.equal(w.eval('ME'),'qa-beta');
 assert.match(w.document.querySelector('#v-family h1').textContent,/qa-alpha/);
 assert.equal(requests.filter(r=>r.api==='live').length,1);assert.equal(requests.some(r=>r.api==='whoami'),false);
});
