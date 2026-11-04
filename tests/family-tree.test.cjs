const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {html}=require('./create-debug-fixture.cjs');
const FamilyEngine=require('../family-engine.js');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function load(t){const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{configurable:true,get(){return this.classList.contains('fx-stage')?800:0;}},clientHeight:{configurable:true,get(){return this.classList.contains('fx-stage')?500:0;}}});}});t.after(()=>dom.window.close());for(let i=0;i<100&&!dom.window.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));const w=dom.window;w.fixtureNormalize=(owner,family,sync)=>FamilyEngine.normalize({owner,family,sync});w.eval(`window.fixtureApi=api;api=async(path,body)=>path==='family_read'?{graph:window.fixtureNormalize(body.owner,LIVE.fam[key(body.owner)]||{},syncList(body.owner)),revision:0,scope:'legacy',canEdit:true,captureState:{revision:0,active:'legacy',choices:[],legacyAvailable:true}}:window.fixtureApi(path,body)`);await tick();return w;}
test('an unstarted player card opens shared family data without creating progress or writes',async t=>{
 const w=await load(t),d=w.document;
 w.eval(`delete LIVE.progress['qa-beta'];LIVE.fam['qa-beta']={sims:{2:{f:'Other',l:'Founder'}}};window.calls=[];fixtureApi=async(path,body)=>{window.calls.push({path,body});return path==='portrait'?{portraits:[]}:{ok:true};};renderHood();`);await tick();
 const card=[...d.querySelectorAll('.pcard')].find(el=>el.textContent.includes('qa-beta'));
 assert.match(card.textContent,/hasn't started/i);card.click();
 const sheet=d.querySelector('.sheet');assert.equal(sheet.getAttribute('aria-label'),'qa-beta');assert.match(sheet.textContent,/hasn't started the challenge/i);// The approved compact panel no longer renders inferred family counts; the explorer reads the authoritative graph.
 assert.match(sheet.textContent,/Open the family tree/);assert.match(sheet.textContent,/Household count unavailable/);assert.ok(sheet.querySelector('a[target=_blank]')); assert.doesNotMatch(sheet.textContent,/Gen 1|Playing/);
 assert.match(sheet.querySelector('a[target=_blank]').getAttribute('href'),/family=qa-beta/);w.eval("openFamilyExplorer('qa-beta')");await tick();await new Promise(r=>setTimeout(r,0));
 d.querySelector('.fx-node').click();assert.match(d.querySelector('.fx-drawer').textContent,/Other Founder/);assert.equal(d.querySelector('.fx-drawer input[type=file]'),null);assert.equal(w.eval("prog('qa-beta')"),null);
 assert.ok(w.calls.some(c=>c.path==='portrait'&&c.body.owner==='qa-beta'));
 assert.ok(w.calls.every(c=>c.path==='linkedtree'||(c.path==='portrait'&&['list','get'].includes(c.body.action))),JSON.stringify(w.calls));
});
test('fit contains wide and deep families and keeps the overview while zooming',async t=>{
 const w=await load(t),d=w.document;
 for(const shape of ['wide','deep']){
  w.eval(`LIVE.progress['qa-alpha'].gens[1].heirSimId='1000';LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:${shape==='wide'?60:20}},(_,i)=>['1'+String(i).padStart(3,'0'),{f:'Sim '+i,...(${JSON.stringify(shape)}==='deep'&&i?{p:['1'+String(i-1).padStart(3,'0')]}:{}),...(${JSON.stringify(shape)}==='wide'&&i===0?{c:Array.from({length:59},(_,j)=>'1'+String(j+1).padStart(3,'0'))}:{})}]))};openFamilyExplorer('qa-alpha')`);await tick();
  // The explorer opens on the recorded founder; these fixtures exercise the full branch.
  assert.equal(d.querySelectorAll('.fx-node').length,shape==='wide'?60:20);
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
test('graph keeps shared children, partners, missing and disconnected nodes distinct',async t=>{
 const w=await load(t);const model=FamilyEngine.normalize({family:{sims:{'1':{f:'Same',c:['3'],ps:['2','4']},'2':{f:'Same',c:['3']},'3':{f:'Child',p:['1','2','999']},'4':{f:'Other'},'888':{f:'Disconnected'}}}});w.fixtureModel=model;
 const g=w.eval("familyGraph(window.fixtureModel,'1')");assert.equal(Object.keys(model.sims).length,6);assert.equal(g.edges.filter(e=>e.type==='parent'&&e.b==='3').length,3);assert.equal(g.edges.filter(e=>e.type==='partner').length,2);assert.equal(g.nodes['999'].missing,true);assert.notEqual(g.nodes['1'].x,g.nodes['2'].x);
 // The approved focused view puts disconnected people in the searchable list instead of the initial canvas.
 assert.equal(g.nodes['888'],undefined);assert.ok(g.all['888']);const other=w.eval("familyGraph(window.fixtureModel,'888')");assert.ok(other.nodes['888']);
});
test('cycles and long names produce bounded graph',async t=>{
 const w=await load(t), model=FamilyEngine.normalize({family:{sims:{'1':{f:'x'.repeat(800),p:['2']},'2':{p:['1']}}}});w.fixtureModel=model;
 assert.ok(model.issues.some(x=>x.type==='cycle'));const g=w.eval('familyGraph(window.fixtureModel)');assert.ok(g.height<5000);
});
test('full view works with empty data, keyboard zoom, selection and owner isolation',async t=>{const w=await load(t),d=w.document;w.eval("openFamilyExplorer('qa-alpha')");await tick();assert.match(d.querySelector('.fx-note').textContent,/No family data/);d.querySelector('.fx-button').click();w.eval("LIVE.fam['qa-alpha']={sims:{1:{f:'One',c:['2']},2:{f:'Two',p:['1']}}}; openFamilyExplorer('qa-alpha')");await tick();assert.equal(d.querySelectorAll('.fx-node').length,2);const stage=d.querySelector('.fx-stage'),world=d.querySelector('.fx-world');const initial=world.style.transform;stage.dispatchEvent(new w.KeyboardEvent('keydown',{key:'+',bubbles:true}));assert.notEqual(world.style.transform,initial);for(let i=0;i<50;i++)stage.dispatchEvent(new w.KeyboardEvent('keydown',{key:'+',bubbles:true}));assert.match(world.style.transform,/scale\(2.5\)/);d.querySelector('.fx-node').click();assert.ok(d.querySelector('.fx-drawer input[type=file]'));d.querySelector('.fx-drawer .fx-button').click();assert.equal(d.querySelector('.fx-drawer').hidden,true);const sel=d.querySelector('.fx-head select');sel.value='qa-beta';sel.dispatchEvent(new w.Event('change'));await tick();assert.match(d.querySelector('.fx-note').textContent,/No family data/);});
test('other player detail offers no photo mutation and unsupported file types rejected',async t=>{const w=await load(t),d=w.document;w.eval("LIVE.fam['qa-beta']={sims:{5:{f:'Other'}}};openFamilyExplorer('qa-beta')");await tick();d.querySelector('.fx-node').click();assert.equal(d.querySelector('.fx-drawer input'),null);await assert.rejects(w.eval("preparePortrait(new File(['x'],'x.svg',{type:'image/svg+xml'}))"),/unsupported-image/);});
test('late portrait results cannot cross owner selection and requests use a two-call limit',async t=>{
 const w=await load(t),d=w.document;
 w.eval(`LIVE.fam['qa-alpha']={sims:{1:{f:'One',c:['2','3']},2:{f:'Two'},3:{f:'Three'}}}; LIVE.fam['qa-beta']={sims:{6:{f:'Other'}}}; window.photoCalls=[];window.photoResolvers=[];fixtureApi=async function(path,b){if(path!=='portrait')return {};window.photoCalls.push(b);if(b.action==='list')return {portraits:b.owner==='qa-alpha'?[{simId:'1',at:1},{simId:'2',at:1},{simId:'3',at:1}]:[]};return new Promise(resolve=>window.photoResolvers.push(resolve));};openFamilyExplorer('qa-alpha');`);await tick();
 await new Promise(r=>setTimeout(r,0));assert.equal(w.photoCalls.filter(c=>c.action==='get').length,2);
 const sel=d.querySelector('.fx-head select');sel.value='qa-beta';sel.dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,0));w.photoResolvers[0]({image:'data:image/jpeg;base64,YWJj',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('.fx-node img'),null);assert.equal(w.photoCalls.filter(c=>c.action==='get').length,2);
});
test('logout removes the private tree view',async t=>{const w=await load(t),d=w.document;w.eval("openFamilyExplorer('qa-alpha');loggedOut()");await tick();assert.equal(d.querySelector('#family-explorer'),null);});
test('manual portrait is converted and uploaded once for the current owner',async t=>{
 const w=await load(t),d=w.document;
 w.eval(`window.photoWrites=[];URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};Image=class {constructor(){this.width=800;this.height=400;} set src(v){queueMicrotask(()=>this.onload());}};HTMLCanvasElement.prototype.getContext=function(){return {drawImage(){}}};HTMLCanvasElement.prototype.toDataURL=function(){window.canvasSize=[this.width,this.height];return 'data:image/jpeg;base64,YWJj';};fixtureApi=async function(path,b){if(b.action==='list')return {portraits:[]};window.photoWrites.push(b);return {ok:true,at:2};};LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};openFamilyExplorer('qa-alpha');`);await tick();
 await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();const file=new w.File(['png'],'fixture.png',{type:'image/png'}),input=d.querySelector('.fx-drawer input');Object.defineProperty(input,'files',{value:[file]});[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Upload portrait').click();await new Promise(r=>setTimeout(r,5));assert.equal(w.photoWrites.length,1);assert.equal(w.photoWrites[0].owner,'qa-alpha');assert.equal(w.photoWrites[0].action,'put');assert.match(w.photoWrites[0].image,/^data:image\/jpeg;base64,/);assert.equal(w.canvasSize[0],256);assert.equal(w.canvasSize[1],128);
});
test('visible photo queue is bounded, mutations take priority, and old reads cannot undo a remove',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.calls=[];window.resolvers={};LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:80},(_,i)=>['1'+String(i).padStart(3,'0'),{f:'Sim '+i,...(i===0?{c:Array.from({length:79},(_,j)=>'1'+String(j+1).padStart(3,'0'))}:{})}]))};fixtureApi=async function(path,b){window.calls.push(b);if(b.action==='list')return {portraits:Array.from({length:80},(_,i)=>({simId:'1'+String(i).padStart(3,'0'),at:1}))};return new Promise(resolve=>{window.resolvers[b.action+':'+b.simId]=resolve;});};openFamilyExplorer('qa-alpha');`);await tick();await new Promise(r=>setTimeout(r,0));assert.equal(w.calls.filter(x=>x.action==='get').length,2);
 d.querySelector('[data-sim-id="1000"]').click();let remove=[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait');remove.click();remove.click();await new Promise(r=>setTimeout(r,0));assert.equal(remove.disabled,true);w.resolvers['get:1001']({image:'data:image/jpeg;base64,YWJj',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(w.calls[3].action,'remove');assert.equal(w.calls.filter(x=>x.action==='remove').length,1);w.resolvers['remove:1000']({ok:true});await new Promise(r=>setTimeout(r,0));w.resolvers['get:1000']({image:'data:image/jpeg;base64,b2xk',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('[data-sim-id="1000"] img'),null);assert.ok(w.calls.filter(x=>x.action==='get').length<=12);
});
test('focus is contained and restored, and detail relationships reflect inverse reports',async t=>{
 const w=await load(t),d=w.document;const opener=d.querySelector('.tab');opener.focus();w.eval("LIVE.fam['qa-alpha']={sims:{1:{f:'Parent',c:['2'],ps:['3']},2:{f:'Child'},3:{f:'Partner'}}};openFamilyExplorer('qa-alpha')");await tick();
 assert.equal(d.querySelectorAll('.fx-node').length,3);d.querySelector('[data-sim-id="2"]').click();assert.match(d.querySelector('.fx-drawer').textContent,/Parents: Parent/);d.querySelector('.fx-drawer').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('.fx-drawer').hidden,true);
 const first=d.querySelector('.fx-head button');first.focus();first.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(d.activeElement.tagName,'SUMMARY');d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.activeElement,opener);
});
test('known and unknown references stay distinct and self cycles are reported',async t=>{
 const w=await load(t);const sims=Object.fromEntries(Array.from({length:501},(_,i)=>[String(1000+i),{f:'Known'}]));sims['1000'].p=['1000','1500','999'];const model=FamilyEngine.normalize({family:{sims}});w.fixtureModel=model;
 // The focused graph no longer truncates known records; all records remain searchable.
 const g=w.eval("familyGraph(window.fixtureModel,'1500')");assert.equal(g.all['1500'].missing,false);assert.equal(g.all['999'].missing,true);assert.ok(model.issues.some(x=>x.type==='self_link'));assert.equal(Object.keys(g.all).length,502);
});
test('photo errors distinguish old backend from rate limit',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};fixtureApi=async()=>{throw new Error('429')};openFamilyExplorer('qa-alpha')`);await tick();await new Promise(r=>setTimeout(r,0));assert.match(d.querySelector('p.fx-note[role=status]').textContent,/rate limited/);w.eval("fixtureApi=async()=>{throw new Error('404')};openFamilyExplorer('qa-alpha')");await tick();await new Promise(r=>setTimeout(r,0));assert.match(d.querySelector('p.fx-note[role=status]').textContent,/support pending/);
});
test('a late portrait read cannot replace a newer upload',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.readDone=null;URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};Image=class {constructor(){this.width=2;this.height=2}set src(v){queueMicrotask(()=>this.onload())}};HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,bmV3';LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};fixtureApi=async function(path,b){if(b.action==='list')return {portraits:[{simId:'1',at:1}]};if(b.action==='get')return new Promise(resolve=>window.readDone=resolve);return {ok:true,at:2};};openFamilyExplorer('qa-alpha')`);await tick();await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();const input=d.querySelector('.fx-drawer input');Object.defineProperty(input,'files',{value:[new w.File(['x'],'x.png',{type:'image/png'})]});[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Upload portrait').click();await new Promise(r=>setTimeout(r,0));w.readDone({image:'data:image/jpeg;base64,b2xk',at:1});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('.fx-node img').getAttribute('src'),'data:image/jpeg;base64,bmV3');
});
test('verified absence supplies ifAt zero and edits stay disabled until list returns',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};window.resolveList=null;window.changes=[];fixtureApi=async (path,b)=>{if(b.action==='list')return new Promise(r=>window.resolveList=r);window.changes.push(b);return {ok:true,at:10};};openFamilyExplorer('qa-alpha');`);await tick();d.querySelector('.fx-node').click();const remove=[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait');assert.equal(remove.disabled,true);w.resolveList({portraits:[]});await new Promise(r=>setTimeout(r,0));assert.equal(remove.disabled,false);remove.click();await new Promise(r=>setTimeout(r,0));assert.equal(w.changes.length,1);assert.equal(w.changes[0].ifAt,0);
});
test('conflict refreshes current portrait without retrying a write',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};window.events=[];fixtureApi=async (path,b)=>{window.events.push(b);if(b.action==='list')return {portraits:[{simId:'1',at:10}]};if(b.action==='remove'){let e=new Error('409');e.code='portrait_conflict';throw e;}return {image:'data:image/jpeg;base64,bmV3',at:window.events.filter(x=>x.action==='get').length===1?10:20};};openFamilyExplorer('qa-alpha');`);await tick();await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,0));assert.equal(w.events.filter(x=>x.action==='remove').length,1);assert.equal(w.events.find(x=>x.action==='remove').ifAt,10);assert.ok(w.events.filter(x=>x.action==='get').length>=2);assert.match(d.querySelector('.fx-drawer').textContent,/changed on another device/i);assert.equal(d.querySelector('.fx-node img').getAttribute('src'),'data:image/jpeg;base64,bmV3');
});
test('older get cannot roll back the version seen in list',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};window.writes=[];fixtureApi=async (path,b)=>{if(b.action==='list')return {portraits:[{simId:'1',at:20}]};if(b.action==='get')return {image:'data:image/jpeg;base64,b2xk',at:10};window.writes.push(b);return {ok:true};};openFamilyExplorer('qa-alpha');`);await tick();await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('.fx-node img'),null);d.querySelector('.fx-node').click();[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,0));assert.equal(w.writes[0].ifAt,20);
});
test('upload captures the expected version before image preparation',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.latestRead=null;window.imageReady=null;window.writes=[];URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>{};Image=class{constructor(){this.width=1;this.height=1}set src(v){window.imageReady=()=>this.onload()}};HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,bmV3';LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};fixtureApi=async(path,b)=>{if(b.action==='list')return {portraits:[{simId:'1',at:10}]};if(b.action==='get')return new Promise(r=>window.latestRead=r);window.writes.push(b);return {ok:true,at:30};};openFamilyExplorer('qa-alpha');`);await tick();await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-node').click();const input=d.querySelector('.fx-drawer input');Object.defineProperty(input,'files',{value:[new w.File(['x'],'x.png',{type:'image/png'})]});[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Upload portrait').click();w.latestRead({image:'data:image/jpeg;base64,bmV3',at:20});await new Promise(r=>setTimeout(r,0));w.imageReady();await new Promise(r=>setTimeout(r,0));assert.equal(w.writes[0].ifAt,10);
});
test('rolling read budget survives repeated pan and reopening and caches matching portraits',async t=>{
 const w=await load(t),d=w.document;w.eval(`Date.now=()=>1700000000000;LIVE.progress['qa-alpha'].gens[1].heirSimId='1000';LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:80},(_,i)=>['1'+String(i).padStart(3,'0'),{f:'Sim '+i,...(i===0?{c:Array.from({length:79},(_,j)=>'1'+String(j+1).padStart(3,'0'))}:{})}]))};window.reads=[];fixtureApi=async (path,b)=>{window.reads.push(b);if(b.action==='list')return {portraits:Array.from({length:80},(_,i)=>({simId:'1'+String(i).padStart(3,'0'),at:1}))};return {image:'data:image/jpeg;base64,YWJj',at:1};};openFamilyExplorer('qa-alpha');`);await tick();await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelectorAll('.fx-node').length,80);for(let i=0;i<75;i++){d.querySelector('[data-sim-id="1'+String(i).padStart(3,'0')+'"]').click();await new Promise(r=>setTimeout(r,0));}assert.equal(w.reads.filter(x=>x.action==='list'||x.action==='get').length,60);assert.match(d.querySelector('p.fx-note[role=status]').textContent,/limit reached/);[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.filter(x=>x.action==='remove').length,1);d.querySelector('.fx-head button').click();w.eval("openFamilyExplorer('qa-alpha')");await tick();await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.filter(x=>x.action==='list'||x.action==='get').length,60);d.querySelector('.fx-head button').click();
});
test('matching cached portrait is reused across explorer reopening',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};window.reads=[];fixtureApi=async(path,b)=>{window.reads.push(b);return b.action==='list'?{portraits:[{simId:'1',at:7}]}:{image:'data:image/jpeg;base64,YWJj',at:7};};openFamilyExplorer('qa-alpha')`);await tick();await new Promise(r=>setTimeout(r,0));d.querySelector('.fx-head button').click();w.eval("openFamilyExplorer('qa-alpha')");await tick();await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.filter(x=>x.action==='get').length,1);assert.ok(d.querySelector('.fx-node img'));
});
test('pagination reaches the 41st identical name with focus retained',async t=>{
 const w=await load(t),d=w.document;w.eval(`LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:41},(_,i)=>['1'+String(i).padStart(3,'0'),{f:'Same',l:'Name'}]))};openFamilyExplorer('qa-alpha');`);await tick();const details=d.querySelector('.fx-access');details.open=true;assert.equal(d.querySelectorAll('.fx-list-item').length,40);d.querySelector('[data-page=next]').click();const last=d.querySelector('.fx-list-item');assert.match(last.textContent,/1040/);assert.equal(d.activeElement,last);last.click();assert.match(d.querySelector('.fx-drawer h2').textContent,/Same Name/);
});
test('photo reads resume at expiry and closing cancels the scheduled wakeup',async t=>{
 const w=await load(t),d=w.document;w.eval(`window.clock=1700000000000;Date.now=()=>window.clock;window.wake=null;window.cleared=[];setTimeout=(f,ms)=>{window.wake=f;return 999};clearTimeout=id=>window.cleared.push(id);LIVE.fam['qa-alpha']={sims:{1:{f:'One'}}};familyReadHistory.set(GID+':'+key(ME),Array(60).fill(window.clock));window.reads=[];fixtureApi=async(path,b)=>{window.reads.push(b);return {portraits:[]}};openFamilyExplorer('qa-alpha');`);await tick();assert.equal(w.reads.length,0);assert.match(d.querySelector('p.fx-note[role=status]').textContent,/limit reached/);w.clock+=300001;w.wake();await new Promise(r=>setTimeout(r,0));assert.equal(w.reads.length,1);w.eval("familyReadHistory.set(GID+':'+key(ME),Array(60).fill(window.clock));openFamilyExplorer('qa-alpha')");await tick();d.querySelector('.fx-head button').click();assert.ok(w.cleared.includes(999));
});

async function householdSetup(t){
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});
 t.after(()=>dom.window.close());const w=dom.window;
 for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.eval(`Date.now=()=>1700000000000; LIVE.progress['qa-alpha']={name:'qa-alpha',current:1,gens:{1:{heir:'Founder Sample',heirSimId:'1'}}};
 LIVE.fam['qa-alpha']={sims:Object.fromEntries(Array.from({length:12},(_,i)=>[String(i+1),{f:i===0?'Founder':i===5?'Former':i===6?'Child':'Sim'+i,l:'Sample',...(i===0?{ps:['6'],c:['7']}:{}),...(i===6?{p:['1','6']}: {})}]))};`);await tick();
 return w;
}
const header=w=>w.eval("familyPanel('qa-alpha').querySelector('.ph').textContent");
test('last matching household count excludes historical and unflagged sims while relationships remain',async t=>{
 const w=await householdSetup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'unrelated',data:{sims:[{id:'2',first:'Sim1',last:'Sample',inHousehold:true}]}},{at:1699827200000,hh:'legacy',data:{sims:Array.from({length:12},(_,i)=>({id:String(i+1),first:i===0?'Founder':i===5?'Former':i===6?'Child':'Sim'+i,last:'Sample',...(i<5?{inHousehold:true}:i===5?{inHousehold:false}:{})}))}}]`);await tick();
 assert.match(header(w),/5 sims in household · last recorded 2d ago/);
 const graph=FamilyEngine.normalize({owner:'qa-alpha',family:w.eval("LIVE.fam['qa-alpha']"),sync:w.eval("LIVE.sync['qa-alpha']")});
 assert.equal(graph.sims['6'].first,'Former');assert.equal(graph.sims['7'].first,'Child');assert.equal(Object.keys(graph.sims).length,12);
 assert.ok(graph.edges.some(e=>e.type==='parent'&&e.a==='1'&&e.b==='7'));assert.ok(graph.edges.some(e=>e.type==='partner'&&e.a==='1'&&e.b==='6'));
});
test('no matching snapshot is unavailable, including a newer unrelated household',async t=>{
 const w=await householdSetup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'unrelated',data:{sims:[{id:'99',first:'Other',inHousehold:true}]}}]`);await tick();
 assert.match(header(w),/Household count unavailable/);assert.doesNotMatch(header(w),/0 sims in household/);
 w.eval("LIVE.sync['qa-alpha']=[]");await tick();assert.match(header(w),/Household count unavailable/);
});
test('existing id preference beats newer name fallback; missing recorded time is explicit',async t=>{
 const w=await householdSetup(t);
 w.eval(`LIVE.sync['qa-alpha']=[{at:1699999999000,hh:'name',data:{sims:[{id:'99',first:'Founder',last:'Sample',inHousehold:true}]}},{at:0,hh:'id',data:{sims:[{id:'1',first:'Founder',last:'Sample',inHousehold:true},{id:'2',inHousehold:true},{id:'3',inHousehold:false},{id:'4'}]}}]`);await tick();
 assert.match(header(w),/2 sims in household · recorded time unknown/);
 w.eval("LIVE.sync['qa-alpha'][1].data.sims[1].inHousehold=false");await tick();assert.match(header(w),/1 sim in household · recorded time unknown/);
});
test('family panel retains its controls and relationships in each content state',async t=>{
 const w=await load(t);
 for(const state of ["LIVE.fam['qa-alpha']={sims:{}};LIVE.sync['qa-alpha']=[]", "LIVE.fam['qa-alpha']={sims:{1:{f:'Founder',c:['2'],ps:['3']},2:{f:'Child'},3:{f:'Partner'}}};LIVE.progress['qa-alpha']={name:'qa-alpha',current:1,gens:{1:{heirSimId:'1'}}}"]){
  w.eval(state);const panel=w.eval("familyPanel('qa-alpha')");await tick();assert.ok(panel.classList.contains('compact-family'));assert.match(panel.textContent,/Open family tree/);assert.match(panel.textContent,/original tree/i);
 }
 // The approved compact panel links to the tree; relationships are now shown in the authoritative explorer.
 w.eval("openFamilyExplorer('qa-alpha')");await tick();const d=w.document;
 for(const name of ['Founder','Child','Partner'])assert.match(d.querySelector('.fx-world').textContent,new RegExp(name));
 d.querySelector('[data-sim-id="1"]').click();assert.match(d.querySelector('.fx-drawer').textContent,/Children: Child/);assert.match(d.querySelector('.fx-drawer').textContent,/Known partners: Partner/);
});
test('tree distinguishes spouse, other reported partners and children',async t=>{
 const w=await load(t);w.eval("LIVE.fam['qa-alpha']={sims:{1:{f:'Founder',s:'2',ps:['2','3'],c:['4']},2:{f:'Spouse'},3:{f:'Other'},4:{f:'Child',p:['1','3']}}};LIVE.progress['qa-alpha']={name:'qa-alpha',current:1,gens:{1:{heirSimId:'1'}}};openFamilyExplorer('qa-alpha')");await tick();
 const model=FamilyEngine.normalize({owner:'qa-alpha',family:w.eval("LIVE.fam['qa-alpha']")});
 const spouse=model.edges.find(e=>e.type==='partner'&&e.a==='1'&&e.b==='2'),other=model.edges.find(e=>e.type==='partner'&&e.a==='1'&&e.b==='3');
 assert.equal(spouse.status,'married');assert.equal(other.status,'unknown');assert.equal(model.sims['1'].childCount,1);assert.ok(model.edges.some(e=>e.type==='parent'&&e.a==='3'&&e.b==='4'));
 const d=w.document;assert.match(d.querySelector('.fx-world').textContent,/married/i);assert.match(d.querySelector('.fx-world').textContent,/unknown/);d.querySelector('[data-sim-id="1"]').click();assert.match(d.querySelector('.fx-drawer').textContent,/Children: Child/);assert.match(d.querySelector('.fx-drawer').textContent,/Known partners: Spouse, Other/);
});
test('vote form communicates the six-hour duration',async t=>{
 const w=await load(t);w.eval('renderVotes()');await tick();assert.ok([...w.document.querySelectorAll('#votes button')].some(b=>b.textContent==='Start the vote (6 hours)'));
});
