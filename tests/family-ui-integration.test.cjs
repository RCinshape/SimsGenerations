const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {html}=require('./create-debug-fixture.cjs');
const E=require('../family-engine.js');
async function setup(t){
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};Object.defineProperties(w.HTMLElement.prototype,{clientWidth:{configurable:true,get(){return this.classList.contains('fx-stage')?800:0;}},clientHeight:{configurable:true,get(){return this.classList.contains('fx-stage')?500:0;}}});}});
 t.after(()=>dom.window.close());const w=dom.window;for(let i=0;i<100&&!w.document.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));return w;
}
const tick=()=>new Promise(r=>setTimeout(r,10));
const byText=(root,selector,text)=>[...root.querySelectorAll(selector)].find(e=>e.textContent===text);
test('authoritative focused tree fits, navigates an unrelated branch and retains portrait permissions',async t=>{
 const w=await setup(t),d=w.document;
 const graph=E.normalize({owner:'qa-alpha',family:{sims:{'1':{f:'Founder',c:['3','18446744073709551615'],ps:['2']},'18446744073709551615':{f:'Large id'},'2':{f:'Partner',c:['3','4']},'3':{f:'Shared'},'4':{f:'Other child'},'5':{f:'Disconnected'}}}});
 w.fixtureGraph=graph;w.eval(`api=async(path,body)=>path==='family_read'?{graph:window.fixtureGraph,revision:0,scope:'legacy',canEdit:true,captureState:{revision:0,active:'legacy',choices:[],legacyAvailable:true}}:path==='portrait'?{portraits:[]}:{};openFamilyExplorer('qa-alpha')`);await tick();
 const stage=d.querySelector('.fx-stage'),world=d.querySelector('.fx-world');
 const ids=()=>[...d.querySelectorAll('.fx-node')].map(e=>e.dataset.simId);
 assert.ok(ids().includes('1'));assert.ok(ids().includes('18446744073709551615'));assert.ok(ids().includes('3'));assert.ok(ids().includes('2'));assert.ok(!ids().includes('4'));assert.ok(!ids().includes('5'));
 const [,x,y,scale]=world.style.transform.match(/translate\(([-\d.e+]+)px,([-\d.e+]+)px\) scale\(([-\d.e+]+)\)/).map(Number);
 assert.ok(x>=19.99&&y>=19.99);assert.ok(x+parseFloat(world.style.width)*scale<=780.01);assert.ok(y+parseFloat(world.style.height)*scale<=480.01);
 const before=world.style.transform;stage.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.notEqual(world.style.transform,before);
 byText(d,'.fx-list-item','Disconnected').click();assert.ok(ids().includes('5'));
 const input=d.querySelector('.fx-drawer input[type=file]');assert.ok(input);assert.equal(byText(d,'.fx-drawer button','Upload portrait').disabled,false);
 w.eval("openFamilyExplorer('qa-beta')");await tick();assert.equal(byText(d,'.fx-head button','Edit tree').hidden,true);d.querySelector('.fx-node').click();assert.equal(d.querySelector('.fx-drawer input[type=file]'),null);
});
test('late authoritative and portrait reads cannot cross player selection',async t=>{
 const w=await setup(t),d=w.document;
 w.alpha=E.normalize({owner:'qa-alpha',family:{sims:{'1':{f:'Alpha'}}}});
 w.beta=E.normalize({owner:'qa-beta',family:{sims:{'2':{f:'Beta'}}}});
 w.eval(`window.resolveAlpha=null;window.resolvePhoto=null;window.calls=[];api=async(path,body)=>{calls.push({path,body});if(path==='family_read'){if(body.owner==='qa-alpha')return new Promise(r=>resolveAlpha=r);return {graph:beta,revision:0,scope:'legacy',canEdit:true,captureState:{revision:0,active:'legacy',choices:[],legacyAvailable:true}};}if(path==='portrait'){if(body.action==='list')return {portraits:[{simId:'2',at:1}]};return new Promise(r=>resolvePhoto=r);}return {};};openFamilyExplorer('qa-alpha');`);
 const select=d.querySelector('.fx-head select');select.value='qa-beta';select.dispatchEvent(new w.Event('change'));await tick();
 assert.match(d.querySelector('.fx-node').textContent,/Beta/);assert.equal(byText(d,'.fx-head button','Edit tree').hidden,true);
 w.resolveAlpha({graph:w.alpha,revision:0,scope:'legacy',canEdit:true,captureState:{revision:0,active:'legacy',choices:[],legacyAvailable:true}});await tick();assert.match(d.querySelector('.fx-node').textContent,/Beta/);assert.equal(w.calls.filter(x=>x.path==='portrait'&&x.body.owner==='qa-alpha').length,0);
 w.eval("loggedOut()");assert.equal(d.querySelector('#family-explorer'),null);w.resolvePhoto({image:'data:image/jpeg;base64,YWJj',at:1});await tick();assert.equal(d.querySelector('#family-explorer'),null);
});
test('owner can add a sim without randomUUID and sees the saved record',async t=>{
 const w=await setup(t),d=w.document;
 Object.defineProperty(w.crypto,'randomUUID',{value:undefined,configurable:true});
 let randomCalls=0;Object.defineProperty(w.crypto,'getRandomValues',{configurable:true,value:array=>{randomCalls++;for(let i=0;i<array.length;i++)array[i]=i;return array;}});
 const family={sims:{'1':{f:'Founder'}}};let edits={manual:{}};const requests=[];
 w.fixtureBackend=async(path,body)=>{
  if(path==='family_read')return {graph:E.normalize({owner:'qa-alpha',family,edits}),revision:7,scope:'legacy',canEdit:true,captureState:{revision:0,active:'legacy',choices:[],legacyAvailable:true}};
  if(path==='family_edit'){requests.push(body);edits.manual[body.op.id]=body.op.fields;return {graph:E.normalize({owner:'qa-alpha',family,edits}),revision:8};}
  if(path==='portrait')return {portraits:[]};return {};
 };
 w.eval("api=(path,body)=>window.fixtureBackend(path,body);openFamilyExplorer('qa-alpha')");await tick();
 byText(d,'.fx-head button','Edit tree').click();byText(d,'.fx-head button','+ Add sim').click();
 const drawer=d.querySelector('.fx-drawer');
 const field=label=>[...drawer.querySelectorAll('label')].find(x=>x.textContent===label).querySelector('input,textarea');
 field('First name').value='New';field('Last name').value='Sim';field('Notes').value='Created on this device';
 byText(drawer,'button','Save').click();await tick();
 assert.equal(randomCalls,1);assert.equal(requests.length,1);
 const {owner,scope,revision,op}=requests[0];assert.equal(owner,'qa-alpha');assert.equal(scope,'legacy');assert.equal(revision,7);assert.equal(op.type,'add_sim');
 assert.equal(op.id,'manual-000102030405060708090a0b0c0d0e0f');assert.equal(op.fields.first,'New');assert.equal(op.fields.last,'Sim');assert.equal(op.fields.notes,'Created on this device');
 assert.match(d.querySelector('.fx-drawer h2').textContent,/New Sim/);assert.equal(byText(d.querySelector('.fx-drawer'),'button','Save'),undefined);
 assert.equal(d.querySelector('.fx-node.focus-node').dataset.simId,op.id);assert.equal(d.querySelector('[data-sim-id="1"]'),null);
 const back=byText(d,'.fx-head button','← Return to previous tree');assert.ok(back);assert.equal(back.hidden,false);back.click();
 assert.equal(d.querySelector('.fx-node.focus-node').dataset.simId,'1');assert.equal(d.querySelector('[data-sim-id="'+op.id+'"]'),null);
 const entry=byText(d,'.fx-list-item','New Sim');assert.ok(entry);entry.click();assert.equal(d.querySelector('.fx-node.focus-node').dataset.simId,op.id);assert.match(d.querySelector('.fx-drawer h2').textContent,/New Sim/);
});
