const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('index.html','utf8');
const implementation = source.slice(source.indexOf('function familyGraph(model,focus){'), source.indexOf('let familyEpoch='));
const familyGraph = new Function(implementation + ';return familyGraph;')();
const sim = id => ({id,first:id,parents:[],children:[],partners:[]});
test('focus shows only direct descendants and retains exact co-parent identities', () => {
  const sims = Object.fromEntries(['a','b','c','d','x','y','z'].map(x=>[x,sim(x)]));
  const edges = [
    {type:'parent',a:'a',b:'c',role:'biological'},
    {type:'parent',a:'b',b:'c',role:'biological'},
    {type:'parent',a:'a',b:'d',role:'adoptive'},
    {type:'parent',a:'x',b:'d',role:'unknown'},
    {type:'parent',a:'b',b:'y',role:'biological'},
    {type:'parent',a:'a',b:'z',role:'guardian'},
    {type:'partner',a:'a',b:'b',status:'unknown'}
  ];
  const result = familyGraph({sims,edges},'a');
  assert.deepEqual([...result.primary].sort(), ['a','c','d']);
  assert.ok(result.nodes.b && result.nodes.x);
  assert.ok(result.nodes.a.x<result.nodes.b.x);
  assert.equal(result.nodes.b.x,result.nodes.x.x);
  assert.notEqual(result.nodes.b.y,result.nodes.x.y);
  assert.ok(result.nodes.c.y>result.nodes.b.y && result.nodes.c.y>result.nodes.x.y);
  assert.equal(result.nodes.y,undefined);
  assert.equal(result.nodes.z,undefined);
  assert.deepEqual(result.edges.filter(e=>e.type==='parent').map(e=>e.a+'>'+e.b).sort(),['a>c','a>d','b>c','x>d']);
  assert.ok(familyGraph({sims,edges},'b').nodes.y);
});
test('cycle and missing focus stay bounded', () => {
  const sims={a:sim('a'),b:sim('b')};
  const graph=familyGraph({sims,edges:[{type:'parent',a:'a',b:'b'},{type:'parent',a:'b',b:'a'}]},'a');
  assert.equal(Object.keys(graph.nodes).length,2);
  assert.ok(graph.width>0 && graph.height>0);
  assert.equal(familyGraph({sims,edges:[]},'absent').focus,'a');
});
test('tree reads authoritative graph, protects edit access and checks revisions', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');
  const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window;
  for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.calls=[];window.data={owner:'qa-alpha',sims:{'1':{id:'1',first:'A',edited:[]},'2':{id:'2',first:'Child',edited:[]}},edges:[{type:'parent',a:'1',b:'2',role:'unknown'}],partial:true};api=async(path,body)=>{calls.push({path,body});if(path==='family_read')return {graph:data,scope:'legacy',canEdit:true,captureState:{active:'legacy',revision:0,choices:[],legacyAvailable:true},revision:7};if(path==='family_edit')return {graph:data,revision:8};if(path==='portrait')return {portraits:[]};return {};};openFamilyExplorer('qa-alpha');`);
  await new Promise(r=>setTimeout(r,10));const d=w.document;
  assert.equal(d.querySelectorAll('.fx-node').length,2);
  d.querySelector('.fx-node').click();assert.match(d.querySelector('.fx-drawer').textContent,/Child/);
  const find = text=>[...d.querySelectorAll('.fx-head button')].find(b=>b.textContent===text);
  find('Edit tree').click();assert.equal(find('+ Add sim').hidden,false);find('Undo').click();await new Promise(r=>setTimeout(r,5));
  assert.equal(w.calls.find(c=>c.path==='family_edit').body.revision,7);
  w.eval("openFamilyExplorer('qa-beta')");await new Promise(r=>setTimeout(r,10));assert.equal(find('Edit tree').hidden,true);
});
test('portrait crop stays within the image while zoom and position change', () => {
  const fn=source.slice(source.indexOf('function portraitRegion('),source.indexOf('async function preparePortrait('));
  const region=new Function(fn+';return portraitRegion;')();
  assert.deepEqual(region({width:400,height:200},{zoom:1,x:.5,y:.5}),{size:200,x:100,y:0});
  assert.deepEqual(region({width:400,height:200},{zoom:2,x:1,y:0}),{size:100,x:300,y:0});
});
test('source selection is explicit, revisioned and unavailable to other viewers', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');
  const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window;
  for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.calls=[];window.active=null;window.sid='12345678901234567890123456789012';api=async(path,body)=>{calls.push({path,body});if(path==='family_capture_bind'){active=body.streamId;return {}; }if(path==='family_read')return {graph:{sims:{'1':{id:'1',first:'A'}},edges:[],partial:true},scope:active,canEdit:!!active,revision:0,captureState:{revision:3,active,legacyAvailable:true,choices:[{streamId:sid,householdName:'Hills',simCount:4,receivedAt:1700000000000,capturedAt:1700000000,capabilities:{genealogy:true},completeness:'partial'}]}};if(path==='portrait')return {portraits:[]};return {};};openFamilyExplorer('qa-alpha');`);
  await new Promise(r=>setTimeout(r,10));const d=w.document;assert.match(d.querySelector('.fx-note[role=status]').textContent,/Hills/);assert.match(d.querySelector('.fx-note[role=status]').textContent,/not verified/);
  const button=[...d.querySelectorAll('button')].find(b=>b.textContent==='Use this game');button.click();await new Promise(r=>setTimeout(r,10));const call=w.calls.find(x=>x.path==='family_capture_bind');assert.equal(call.body.owner,'qa-alpha');assert.equal(call.body.revision,3);assert.equal(call.body.streamId,w.sid);
  w.eval("openFamilyExplorer('qa-beta')");await new Promise(r=>setTimeout(r,10));assert.equal([...d.querySelectorAll('button')].find(b=>b.textContent==='Use existing tree'),undefined);
});
test('portrait conflict requires an explicit reviewed merge choice', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>true;}});t.after(()=>dom.window.close());const w=dom.window;for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.calls=[];window.data={sims:{'manual-x':{id:'manual-x',first:'Manual',manual:true},'2':{id:'2',first:'Game'}},edges:[]};api=async(path,body)=>{calls.push({path,body});if(path==='family_read')return {graph:data,scope:'legacy',canEdit:true,captureState:{active:'legacy',revision:0,choices:[],legacyAvailable:true},revision:4};if(path==='portrait'){if(body.action==='list')return {portraits:[]};throw new Error('404');}if(path==='family_edit'){if(!body.op.portraitChoice){const e=new Error('409');e.code='merge_conflict';e.data={part:'portrait'};throw e;}return {graph:data,revision:5};}return {};};openFamilyExplorer('qa-alpha');`);
  await new Promise(r=>setTimeout(r,10));const d=w.document;const btn=text=>[...d.querySelectorAll('button')].find(b=>b.textContent===text);btn('Edit tree').click();[...d.querySelectorAll('.fx-list-item')].find(b=>b.textContent==='Manual').click();btn('Link to game sim').click();[...d.querySelectorAll('.fx-drawer button')].find(b=>b.textContent.startsWith('Game ·')).click();await new Promise(r=>setTimeout(r,10));assert.match(d.querySelector('.fx-drawer').textContent,/Choose a portrait/);assert.equal(w.calls.filter(c=>c.path==='family_edit').length,1);btn('Use manual sim portrait').click();await new Promise(r=>setTimeout(r,10));assert.equal(w.calls.filter(c=>c.path==='family_edit')[1].body.op.portraitChoice,'manual');
});
test('portrait alias removal requires clearing the link with the family revision', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window;for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.calls=[];window.data={sims:{'1':{id:'1',first:'A'}},edges:[]};api=async(path,body)=>{calls.push({path,body});if(path==='family_read')return {graph:data,scope:'legacy',canEdit:true,captureState:{active:'legacy',revision:0,choices:[],legacyAvailable:true},revision:4};if(path==='portrait'&&body.action==='list')return {portraits:[]};if(path==='portrait'&&body.action==='remove'){const e=new Error('409');e.code='portrait_alias';throw e;}if(path==='family_edit')return {graph:data,revision:5};return {};};openFamilyExplorer('qa-alpha');`);
  await new Promise(r=>setTimeout(r,10));const d=w.document;d.querySelector('.fx-node').click();[...d.querySelectorAll('button')].find(b=>b.textContent==='Remove portrait').click();await new Promise(r=>setTimeout(r,10));const clear=[...d.querySelectorAll('button')].find(b=>b.textContent==='Clear portrait link');assert.ok(clear);clear.click();await new Promise(r=>setTimeout(r,10));const call=w.calls.find(c=>c.path==='family_edit');assert.equal(call.body.revision,4);assert.equal(call.body.op.type,'clear_portrait_alias');
});
test('portrait requests and caches remain isolated between bound sources', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{configurable:true,get(){return 800;}},clientHeight:{configurable:true,get(){return 500;}}});}});t.after(()=>dom.window.close());const w=dom.window;for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.calls=[];window.active='legacy';window.stream='12345678901234567890123456789012';window.data={sims:{'1':{id:'1',first:'A'}},edges:[]};api=async(path,body)=>{calls.push({path,body});if(path==='family_read')return {graph:data,scope:active,canEdit:true,captureState:{active,revision:0,choices:[],legacyAvailable:true},revision:0};if(path==='portrait'&&body.action==='list')return {portraits:[{simId:'1',at:123}]};if(path==='portrait'&&body.action==='get')return {at:123,image:active==='legacy'?'data:image/jpeg;base64,QUFB':'data:image/jpeg;base64,QkJC'};return {};};openFamilyExplorer('qa-alpha');`);
  await new Promise(r=>setTimeout(r,20));assert.ok(w.calls.some(c=>c.path==='portrait'&&c.body.action==='get'&&c.body.scope==='legacy'));w.eval("active=stream;openFamilyExplorer('qa-alpha')");await new Promise(r=>setTimeout(r,20));assert.ok(w.calls.some(c=>c.path==='portrait'&&c.body.action==='get'&&c.body.scope===w.stream));assert.match(w.document.querySelector('.fx-portrait img').src,/QkJC/);w.document.querySelector('.fx-node').click();assert.ok(w.document.querySelector('input[type=file]'));
});

test('capture timestamps use seconds or milliseconds and reject implausible dates', () => {
  const fn=source.slice(source.indexOf('function familyTime('),source.indexOf('function familyGraph('));
  const time=new Function(fn+';return familyTime;')();
  assert.equal(time(1700000000,'seconds'),time(1700000000000,'seconds'));
  assert.equal(time(1700000000,'seconds'),time(1700000000000,'ms'));
  assert.equal(time(999999999999999,'seconds'),'unknown');
});
test('separate parent sets get distinct labeled connector groups and partner subtree controls', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window;for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.graph={sims:{'1':{id:'1',first:'A'},'2':{id:'2',first:'B'},'3':{id:'3',first:'C'},'4':{id:'4',first:'Child One'},'5':{id:'5',first:'Child Two'}},edges:[{type:'partner',a:'1',b:'2',status:'married'},{type:'partner',a:'1',b:'3',status:'separated'},{type:'parent',a:'1',b:'4'},{type:'parent',a:'2',b:'4'},{type:'parent',a:'1',b:'5'},{type:'parent',a:'3',b:'5'}]};api=async(path)=>path==='family_read'?{graph,scope:'legacy',canEdit:true,captureState:{active:'legacy',revision:0,choices:[],legacyAvailable:true},revision:0}:path==='portrait'?{portraits:[]}:{};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,10));const d=w.document;const groups=[...d.querySelectorAll('svg g[data-parent-set]')].map(x=>JSON.parse(x.getAttribute('data-parent-set')).join(','));assert.deepEqual(groups.sort(),['1,2','1,3']);assert.equal(d.querySelectorAll('.fx-subtree').length,2);const back=[...d.querySelectorAll('.fx-head button')].find(b=>b.textContent==='← Return to previous tree');assert.equal(back.hidden,true);d.querySelector('.fx-subtree').click();assert.equal(back.hidden,false);back.click();assert.equal(back.hidden,true);
});

test('a focused sim parent is placed above the focus rather than among partners',()=>{
 const sims={a:sim('a'),p:sim('p'),b:sim('b'),c:sim('c')};
 const g=familyGraph({sims,edges:[{type:'parent',a:'p',b:'a',role:'adoptive'},{type:'parent',a:'a',b:'c'},{type:'parent',a:'b',b:'c'},{type:'partner',a:'a',b:'b',status:'married'}]},'a');
 assert.ok(g.nodes.p.y<g.nodes.a.y);assert.equal(g.nodes.p.ancestorNode,true);assert.notEqual(g.nodes.p.partnerNode,true);assert.equal(g.nodes.b.focusPartner,true);assert.ok(g.nodes.c.y>g.nodes.a.y);
});
test('narrow canvas starts at readable focus zoom while fit still shows the whole tree', async t => {
  const {JSDOM}=require('jsdom');const {html}=require('./create-debug-fixture.cjs');const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{configurable:true,get(){return this.classList.contains('fx-stage')?375:0;}},clientHeight:{configurable:true,get(){return this.classList.contains('fx-stage')?560:0;}}});}});t.after(()=>dom.window.close());const w=dom.window;for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
  w.eval(`window.graph={sims:{'1':{id:'1',first:'A'},'2':{id:'2',first:'B'},'3':{id:'3',first:'C'}},edges:[{type:'parent',a:'1',b:'2'},{type:'parent',a:'2',b:'3'}]};api=async(path)=>path==='family_read'?{graph,scope:'legacy',canEdit:true,captureState:{active:'legacy',revision:0,choices:[],legacyAvailable:true},revision:0}:path==='portrait'?{portraits:[]}:{};openFamilyExplorer('qa-alpha');`);await new Promise(r=>setTimeout(r,10));const d=w.document,world=d.querySelector('.fx-world'),scale=()=>Number(world.style.transform.match(/scale\(([^)]+)\)/)[1]);assert.ok(scale()>=.72);assert.equal(d.querySelector('.fx-tools').open,false);[...d.querySelectorAll('.fx-head button')].find(b=>b.textContent==='Fit').click();assert.ok(scale()<.72);assert.ok(parseFloat(world.style.width)*scale()<=335.01);
});
