const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {html}=require('./create-debug-fixture.cjs');
async function load(t){const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{configurable:true,get(){return this.classList.contains('fx-stage')?800:0;}},clientHeight:{configurable:true,get(){return this.classList.contains('fx-stage')?500:0;}}});}});t.after(()=>dom.window.close());for(let i=0;i<100&&!dom.window.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));return dom.window;}
const graph=`({a:{id:'a',first:'Same',last:'Name',children:['c'],partners:['b','d']},b:{id:'b',first:'Same',last:'Name',children:['c']},c:{id:'c',first:'Child',parents:['a','b','missing']},d:{id:'d',first:'Other'},isolated:{id:'isolated',first:'Disconnected'}})`;
test('an unstarted player card opens shared family data without creating progress or writes',async t=>{
 const w=await load(t),d=w.document;
 w.eval(`delete LIVE.progress['qa-beta'];LIVE.fam['qa-beta']={sims:{b:{f:'Other',l:'Founder'}}};window.calls=[];api=async(path,body)=>{window.calls.push({path,body});return path==='portrait'?{portraits:[]}:{ok:true};};renderHood();`);
 const card=[...d.querySelectorAll('.pcard')].find(el=>el.textContent.includes('qa-beta'));
 assert.match(card.textContent,/hasn't started/i);card.click();
 const sheet=d.querySelector('.sheet');assert.equal(sheet.getAttribute('aria-label'),'qa-beta');assert.match(sheet.textContent,/hasn't started the challenge/i);assert.match(sheet.textContent,/Game data contains 1 sim\./);assert.match(sheet.textContent,/Household count unavailable/);assert.ok(sheet.querySelector('a[target=_blank]')); assert.doesNotMatch(sheet.textContent,/Gen 1|Playing/);
 assert.match(sheet.querySelector('a[target=_blank]').getAttribute('href'),/family=qa-beta/);w.eval("openFamilyExplorer('qa-beta')");await new Promise(r=>setTimeout(r,0));
 d.querySelector('.fx-node').click();assert.match(d.querySelector('.fx-drawer').textContent,/Other Founder/);assert.equal(d.querySelector('.fx-drawer input[type=file]'),null);assert.equal(w.eval("prog('qa-beta')"),null);
 assert.ok(w.calls.some(c=>c.path==='portrait'&&c.body.owner==='qa-beta'));
 assert.ok(w.calls.every(c=>c.path==='linkedtree'||(c.path==='portrait'&&['list','get'].includes(c.body.action))),JSON.stringify(w.calls));
});
test('fit contains wide and deep families and keeps the overview while zooming',async t=>{
 const w=await load(t),d=w.document;
 for(const shape of ['wide','deep']){
  w.eval(`LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:${shape==='wide'?60:20}},(_,i)=>['s'+String(i).padStart(3,'0'),{f:'Sim '+i,...(${JSON.stringify(shape)}==='deep'&&i?{p:['s'+String(i-1).padStart(3,'0')]}:{})}]))};openFamilyExplorer('qa-alpha')`);
  const stage=d.querySelector('.fx-stage'),world=d.querySelector('.fx-world');
  Object.defineProperty(stage,'clientWidth',{value:800});Object.defineProperty(stage,'clientHeight',{value:500});
  [...d.querySelectorAll('.fx-head button')].find(b=>b.textContent==='Fit').click();
  const [,x,y,scale]=world.style.transform.match(/translate\(([-\d.e+]+)px,([\-\d.e+]+)px\) scale\(([-\d.e+]+)\)/).map(Number);
  assert.ok(x>=19.99&&y>=19.99);assert.ok(x+parseFloat(world.style.width)*scale<=780.01);assert.ok(y+parseFloat(world.style.height)*scale<=480.01);
  const old=scale;stage.dispatchEvent(new w.KeyboardEvent('keydown',{key:'+',bubbles:true}));
  const after=Number(world.style.transform.match(/scale\(([^)]+)\)/)[1]);assert.ok(after>old&&after<.25,'zoom should not jump from the overview to the old minimum');
  d.querySelector('.fx-head button').click();
 }
});
test('graph keeps shared children, partners, missing and disconnected nodes distinct',async t=>{const w=await load(t),g=w.eval('familyGraph('+graph+')');assert.equal(Object.keys(g.nodes).length,6);assert.equal(g.edges.filter(e=>e.type==='parent'&&e.b==='c').length,3);assert.equal(g.edges.filter(e=>e.type==='partner').length,2);assert.equal(g.nodes.missing.missing,true);assert.notEqual(g.nodes.a.x,g.nodes.b.x);assert.ok(g.nodes.isolated);});
test('cycles and long names produce bounded graph',async t=>{const w=await load(t),g=w.eval("familyGraph({a:{id:'a',first:'x'.repeat(800),parents:['b']},b:{id:'b',parents:['a']}})");assert.equal(g.cyclic,true);assert.ok(g.height<5000);});
test('full view works with empty data, keyboard zoom, selection and owner isolation',async t=>{const w=await load(t),d=w.document;w.eval("openFamilyExplorer('qa-alpha')");assert.match(d.querySelector('.fx-note').textContent,/No family data/);d.querySelector('.fx-button').click();w.eval("LIVE.fam['qa-alpha']={sims:{a:{f:'One',c:['b']},b:{f:'Two',p:['a']}}}; openFamilyExplorer('qa-alpha')");assert.equal(d.querySelectorAll('.fx-node').length,2);const stage=d.querySelector('.fx-stage'),world=d.querySelector('.fx-world');const initial=world.style.transform;stage.dispatchEvent(new w.KeyboardEvent('keydown',{key:'+',bubbles:true}));assert.notEqual(world.style.transform,initial);for(let i=0;i<50;i++)stage.dispatchEvent(new w.KeyboardEvent('keydown',{key:'+',bubbles:true}));assert.match(world.style.transform,/scale\(2.5\)/);d.querySelector('.fx-node').click();assert.ok(d.querySelector('.fx-drawer input[type=file]'));d.querySelector('.fx-drawer .fx-button').click();assert.equal(d.querySelector('.fx-drawer').hidden,true);const sel=d.querySelector('.fx-head select');sel.value='qa-beta';sel.dispatchEvent(new w.Event('change'));assert.match(d.querySelector('.fx-note').textContent,/No family data/);});
test('other player detail offers no photo mutation and unsupported file types rejected',async t=>{const w=await load(t),d=w.document;w.eval("LIVE.fam['qa-beta']={sims:{q:{f:'Other'}}};openFamilyExplorer('qa-beta')");d.querySelector('.fx-node').click();assert.equal(d.querySelector('.fx-drawer input'),null);await assert.rejects(w.eval("preparePortrait(new File(['x'],'x.svg',{type:'image/svg+xml'}))"),/unsupported-image/);});
test('late portrait results cannot cross owner selection and requests use a two-call limit',async t=>{
 const w=await load(t),d=w.document;
 w.eval(`LIVE.fam['qa-alpha']={sims:{a:{f:'One'},b:{f:'Two'},c:{f:'Three'}}}; LIVE.fam['qa-beta']={sims:{x:{f:'Other'}}}; window.photoCalls=[];window.photoResolvers=[];api=async function(path,b){if(path!=='portrait')return {};window.photoCalls.push(b);if(b.action==='list')return {portraits:b.owner==='qa-alpha'?[{simId:'a',at:1},{simId:'b',at:1},{simId:'c',at:1}]:[]};return new Promise(resolve=>window.photoResolvers.push(resolve));};openFamilyExplorer('qa-alpha');`);
 await new Promise(r=>setTimeout(r,0));assert.equal(w.photoCalls.filter(c=>c.action==='get').length,2);
 const sel=d.querySelector('.fx-head select');sel.value='qa-beta';sel.dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,0));w.photoResolvers[0]({image:'data:image/jpeg;base64,YWJj',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('.fx-node img'),null);assert.equal(w.photoCalls.filter(c=>c.action==='get').length,2);
});
test('logout removes the private tree view',async t=>{const w=await load(t),d=w.document;w.eval("openFamilyExplorer('qa-alpha');loggedOut()");assert.equal(d.querySelector('#family-explorer'),null);});
test('manual portrait is converted and uploaded once for the current owner',async t=>{
 const w=await load(t),d=w.document;
 w.eval(`window.photoWrites=[];URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};Image=class {constructor(){this.width=800;this.height=400;} set src(v){queueMicrotask(()=>this.onload());}};HTMLCanvasElement.prototype.getContext=function(){return {drawImage(){}}};HTMLCanvasElement.prototype.toDataURL=function(){window.canvasSize=[this.width,this.height];return 'data:image/jpeg;base64,YWJj';};api=async function(path,b){if(b.action==='list')return {portraits:[]};window.photoWrites.push(b);return {ok:true,at:2};};LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};openFamilyExplorer('qa-alpha');`);
 await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();const file=new w.File(['png'],'fixture.png',{type:'image/png'}),input=d.querySelector('.fx-drawer input');Object.defineProperty(input,'files',{value:[file]});[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Upload portrait').click();await new Promise(r=>setTimeout(r,5));assert.equal(w.photoWrites.length,1);assert.equal(w.photoWrites[0].owner,'qa-alpha');assert.equal(w.photoWrites[0].action,'put');assert.match(w.photoWrites[0].image,/^data:image\/jpeg;base64,/);assert.equal(w.canvasSize[0],256);assert.equal(w.canvasSize[1],128);
});
test('visible photo queue is bounded, mutations take priority, and old reads cannot undo a remove',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.calls=[];window.resolvers={};LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:80},(_,i)=>['s'+String(i).padStart(3,'0'),{f:'Sim '+i}]))};api=async function(path,b){window.calls.push(b);if(b.action==='list')return {portraits:Array.from({length:80},(_,i)=>({simId:'s'+String(i).padStart(3,'0'),at:1}))};return new Promise(resolve=>{window.resolvers[b.action+':'+b.simId]=resolve;});};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,0));assert.equal(w.calls.filter(x=>x.action==='get').length,2);
 d.querySelector('[data-sim-id="s000"]').click();let remove=[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait');remove.click();remove.click();await new Promise(r=>setTimeout(r,0));assert.equal(remove.disabled,true);w.resolvers['get:s001']({image:'data:image/jpeg;base64,YWJj',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(w.calls[3].action,'remove');assert.equal(w.calls.filter(x=>x.action==='remove').length,1);w.resolvers['remove:s000']({ok:true});await new Promise(r=>setTimeout(r,0));w.resolvers['get:s000']({image:'data:image/jpeg;base64,b2xk',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('[data-sim-id="s000"] img'),null);assert.ok(w.calls.filter(x=>x.action==='get').length<=12);
});
test('focus is contained and restored, and detail relationships reflect inverse reports',async t=>{
 const w=await load(t),d=w.document;const opener=d.querySelector('.tab');opener.focus();w.eval("LIVE.fam['qa-alpha']={sims:{a:{f:'Parent',c:['b'],ps:['c']},b:{f:'Child'},c:{f:'Partner'}}};openFamilyExplorer('qa-alpha')");
 assert.equal(d.querySelectorAll('.fx-node[tabindex="-1"]').length,3);d.querySelector('[data-sim-id="b"]').click();assert.match(d.querySelector('.fx-drawer').textContent,/Parents: Parent/);d.querySelector('.fx-drawer').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('.fx-drawer').hidden,true);
 const first=d.querySelector('.fx-head button');first.focus();first.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(d.activeElement.tagName,'SUMMARY');d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.activeElement,opener);
});
test('known omitted references differ from unknown references and self cycles are reported',async t=>{
 const w=await load(t);const g=w.eval(`(()=>{const s=Object.fromEntries(Array.from({length:501},(_,i)=>['s'+String(i).padStart(3,'0'),{id:'s'+i,first:'Known'}]));s.s000.parents=['s000','s500','missing'];return familyGraph(s)})()`);assert.equal(g.nodes.s500.omitted,true);assert.notEqual(g.nodes.s500.missing,true);assert.equal(g.nodes.missing.missing,true);assert.equal(g.cyclic,true);assert.equal(g.truncated,true);
});
test('photo errors distinguish old backend from rate limit',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};api=async()=>{throw new Error('429')};openFamilyExplorer('qa-alpha')`);await new Promise(r=>setTimeout(r,0));assert.match(d.querySelector('[role=status]').textContent,/rate limited/);w.eval("api=async()=>{throw new Error('404')};openFamilyExplorer('qa-alpha')");await new Promise(r=>setTimeout(r,0));assert.match(d.querySelector('[role=status]').textContent,/support pending/);
});
test('a late portrait read cannot replace a newer upload',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.readDone=null;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};Image=class {constructor(){this.width=2;this.height=2}set src(v){queueMicrotask(()=>this.onload())}};HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,bmV3';LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};api=async function(path,b){if(b.action==='list')return {portraits:[{simId:'a',at:1}]};if(b.action==='get')return new Promise(resolve=>window.readDone=resolve);return {ok:true,at:2};};openFamilyExplorer('qa-alpha')`);await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();const input=d.querySelector('.fx-drawer input');Object.defineProperty(input,'files',{value:[new w.File(['x'],'x.png',{type:'image/png'})]});[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Upload portrait').click();await new Promise(r=>setTimeout(r,0));w.readDone({image:'data:image/jpeg;base64,b2xk',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('.fx-node img').getAttribute('src'),'data:image/jpeg;base64,bmV3');
});
test('verified absence supplies ifAt zero and edits stay disabled until list returns',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};window.resolveList=null;window.changes=[];api=async (path,b)=>{if(b.action==='list')return new Promise(r=>window.resolveList=r);window.changes.push(b);return {ok:true,at:10};};openFamilyExplorer('qa-alpha');`);d.querySelector('.fx-node').click();const remove=[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait');assert.equal(remove.disabled,true);w.resolveList({portraits:[]});await new Promise(r=>setTimeout(r,0));assert.equal(remove.disabled,false);remove.click();await new Promise(r=>setTimeout(r,0));assert.equal(w.changes.length,1);assert.equal(w.changes[0].ifAt,0);
});
test('conflict refreshes current portrait without retrying a write',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};window.events=[];api=async (path,b)=>{window.events.push(b);if(b.action==='list')return {portraits:[{simId:'a',at:10}]};if(b.action==='remove'){let e=new Error('409');e.code='portrait_conflict';throw e;}return {image:'data:image/jpeg;base64,bmV3',at:window.events.filter(x=>x.action==='get').length===1?10:20};};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,0));assert.equal(w.events.filter(x=>x.action==='remove').length,1);assert.equal(w.events.find(x=>x.action==='remove').ifAt,10);assert.ok(w.events.filter(x=>x.action==='get').length>=2);assert.match(d.querySelector('.fx-drawer').textContent,/changed on another device/i);assert.equal(d.querySelector('.fx-node img').getAttribute('src'),'data:image/jpeg;base64,bmV3');
});
test('older get cannot roll back the version seen in list',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};window.writes=[];api=async (path,b)=>{if(b.action==='list')return {portraits:[{simId:'a',at:20}]};if(b.action==='get')return {image:'data:image/jpeg;base64,b2xk',at:10};window.writes.push(b);return {ok:true};};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('.fx-node img'),null);d.querySelector('.fx-node').click();[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,0));assert.equal(w.writes[0].ifAt,20);
});
test('upload captures the expected version before image preparation',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.latestRead=null;window.imageReady=null;window.writes=[];URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};Image=class{constructor(){this.width=1;this.height=1}set src(v){window.imageReady=()=>this.onload()}};HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,bmV3';LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};api=async(path,b)=>{if(b.action==='list')return {portraits:[{simId:'a',at:10}]};if(b.action==='get')return new Promise(r=>window.latestRead=r);window.writes.push(b);return {ok:true,at:30};};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();const input=d.querySelector('.fx-drawer input');Object.defineProperty(input,'files',{value:[new w.File(['x'],'x.png',{type:'image/png'})]});[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Upload portrait').click();w.latestRead({image:'data:image/jpeg;base64,bmV3',at:20});await new Promise(r=>setTimeout(r,0));w.imageReady();await new Promise(r=>setTimeout(r,0));assert.equal(w.writes[0].ifAt,10);
});
test('rolling read budget survives repeated pan and reopening and caches matching portraits',async t=>{
 const w=await load(t),d=w.document;w.eval(`Date.now=()=>1700000000000;LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:80},(_,i)=>['s'+String(i).padStart(3,'0'),{f:'Sim '+i}]))};window.reads=[];api=async (path,b)=>{window.reads.push(b);if(b.action==='list')return {portraits:Array.from({length:80},(_,i)=>({simId:'s'+String(i).padStart(3,'0'),at:1}))};return {image:'data:image/jpeg;base64,YWJj',at:1};};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,0));for(let i=0;i<75;i++){d.querySelector('[data-sim-id="s'+String(i).padStart(3,'0')+'"]').click();await new Promise(r=>setTimeout(r,0));}assert.equal(w.reads.filter(x=>x.action==='list'||x.action==='get').length,60);assert.match(d.querySelector('[role=status]').textContent,/limit reached/);[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.filter(x=>x.action==='remove').length,1);d.querySelector('.fx-head button').click();w.eval("openFamilyExplorer('qa-alpha')");await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.filter(x=>x.action==='list'||x.action==='get').length,60);d.querySelector('.fx-head button').click();
});
test('matching cached portrait is reused across explorer reopening',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};window.reads=[];api=async(path,b)=>{window.reads.push(b);return b.action==='list'?{portraits:[{simId:'a',at:7}]}:{image:'data:image/jpeg;base64,YWJj',at:7};};openFamilyExplorer('qa-alpha')`);await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-head button').click();w.eval("openFamilyExplorer('qa-alpha')");await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.filter(x=>x.action==='get').length,1);assert.ok(d.querySelector('.fx-node img'));
});
test('pagination reaches the 41st identical name with focus retained',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:41},(_,i)=>['s'+String(i).padStart(3,'0'),{f:'Same',l:'Name'}]))};openFamilyExplorer('qa-alpha');`);const details=d.querySelector('.fx-access');details.open=true;assert.equal(d.querySelectorAll('.fx-list-item').length,40);d.querySelector('[data-page=next]').click();const last=d.querySelector('.fx-list-item');assert.match(last.textContent,/s040/);assert.equal(d.activeElement,last);last.click();assert.match(d.querySelector('.fx-drawer h2').textContent,/Same Name/);
});
test('photo reads resume at expiry and closing cancels the scheduled wakeup',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.clock=1700000000000;Date.now=()=>window.clock;window.wake=null;window.cleared=[];setTimeout=(f,ms)=>{window.wake=f;return 999};clearTimeout=id=>window.cleared.push(id);LIVE.fam['qa-alpha']={sims:{a:{f:'One'}}};familyReadHistory.set(GID+':'+key(ME),Array(60).fill(window.clock));window.reads=[];api=async(path,b)=>{window.reads.push(b);return {portraits:[]}};openFamilyExplorer('qa-alpha');`);assert.equal(w.reads.length,0);assert.match(d.querySelector('[role=status]').textContent,/limit reached/);w.clock+=300001;w.wake();await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.length,1);w.eval("familyReadHistory.set(GID+':'+key(ME),Array(60).fill(window.clock));openFamilyExplorer('qa-alpha')");d.querySelector('.fx-head button').click();assert.ok(w.cleared.includes(999));
});

async function householdSetup(t){
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});
 t.after(()=>dom.window.close());const w=dom.window;
 for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.eval(`Date.now=()=>1700000000000; LIVE.progress['qa-alpha']={name:'qa-alpha',current:1,gens:{1:{heir:'Founder Sample',heirSimId:'1'}}};
 LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:12},(_,i)=>[String(i+1),{f:i===0?'Founder':i===5?'Former':i===6?'Child':'Sim'+i,l:'Sample',...(i===0?{ps:['6'],c:['7']}:{}),...(i===6?{p:['1','6']}: {})}]))};`);
 return w;
}
const header=w=>w.eval("familyPanel('qa-alpha').querySelector('.ph').textContent");
test('last matching household count excludes historical and unflagged sims while relationships remain',async t=>{
 const w=await householdSetup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'unrelated',data:{sims:[{id:'2',first:'Sim1',last:'Sample',inHousehold:true}]}},{at:1699827200000,hh:'legacy',data:{sims:Array.from({length:12},(_,i)=>({id:String(i+1),first:i===0?'Founder':i===5?'Former':i===6?'Child':'Sim'+i,last:'Sample',...(i<5?{inHousehold:true}:i===5?{inHousehold:false}:{})}))}}]`);
 assert.match(header(w),/5 sims in household · last recorded 2d ago/);
 const panel=w.eval("familyPanel('qa-alpha').textContent");assert.match(panel,/Former Sample/);assert.match(panel,/Child/);assert.equal(w.eval("Object.keys(famOf('qa-alpha')).length"),12);
});
test('no matching snapshot is unavailable, including a newer unrelated household',async t=>{
 const w=await householdSetup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'unrelated',data:{sims:[{id:'99',first:'Other',inHousehold:true}]}}]`);
 assert.match(header(w),/Household count unavailable/);assert.doesNotMatch(header(w),/0 sims in household/);
 w.eval("LIVE.sync['qa-alpha']=[]");assert.match(header(w),/Household count unavailable/);
});
test('existing id preference beats newer name fallback; missing recorded time is explicit',async t=>{
 const w=await householdSetup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'name',data:{sims:[{id:'99',first:'Founder',last:'Sample',inHousehold:true}]}},{at:0,hh:'id',data:{sims:[{id:'1',first:'Founder',last:'Sample',inHousehold:true},{id:'2',inHousehold:true},{id:'3',inHousehold:false},{id:'4'}]}}]`);
 assert.match(header(w),/2 sims in household · recorded time unknown/);
 w.eval("LIVE.sync['qa-alpha'][1].data.sims[1].inHousehold=false");assert.match(header(w),/1 sim in household · recorded time unknown/);
});
test('family panel retains its controls and relationships in each content state',async t=>{
 const w=await load(t);
 for(const state of ["LIVE.fam['qa-alpha']={sims:{}};LIVE.sync['qa-alpha']=[]", "LIVE.fam['qa-alpha']={sims:{a:{f:'Founder',c:['b'],ps:['c']},b:{f:'Child'},c:{f:'Partner'}}};LIVE.progress['qa-alpha']={name:'qa-alpha',current:1,gens:{1:{heirSimId:'a'}}}"]){
  w.eval(state);const panel=w.eval("familyPanel('qa-alpha')");assert.ok(panel.classList.contains('compact-family'));assert.match(panel.textContent,/Open family tree/);assert.match(panel.textContent,/original tree/i);
 }
 const panel=w.eval("familyPanel('qa-alpha')");assert.match(panel.textContent,/Founder/);assert.match(panel.textContent,/Child/);assert.match(panel.textContent,/Partner/);assert.equal(panel.querySelector('.ft .badge').tagName,'BUTTON');
});
test('vote form communicates the six-hour duration',async t=>{
 const w=await load(t);w.eval('renderVotes()');assert.ok([...w.document.querySelectorAll('#votes button')].some(b=>b.textContent==='Start the vote (6 hours)'));
});
