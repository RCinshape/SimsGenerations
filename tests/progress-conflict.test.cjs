const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const { html: fixture } = require('./create-debug-fixture.cjs');

const GROUP = 'fixture-backend-000000000000';
const GOAL = 'Sell baked goods from a table or the Home Chef Hustle stand (optional)';
const LOCAL = {name:'qa-alpha',current:1,updatedAt:2,_revision:3,gens:{1:{ticks:[1,2],heir:'Sample Heir',autoSeen:[]}}};
const SAVED = {name:'qa-alpha',current:1,updatedAt:1,_revision:4,gens:{1:{ticks:[2],heir:'Sample Heir',autoSeen:[]}}};
const TICK = {id:'pendingtick123',at:123,who:'qa-alpha',type:'tick',gen:1,text:`ticked “${GOAL}”`,goal:GOAL,source:'manual'};

function serverState() {
  return {progress:{'qa-alpha':structuredClone(SAVED),'qa-beta':{name:'qa-beta',current:1,_revision:2,gens:{1:{ticks:[2]}}}},feed:[]};
}

function conflictFixture() {
  const old = "else if(r.api==='progress') {d.progress[actor]=r.b;localStorage.setItem(KEY,JSON.stringify(d));}";
  const replacement = `else if(r.api==='progress') {
      const current=d.progress[actor]||{};
      if(Number(r.b._revision||0)!==Number(current._revision||0)) return {json:async()=>({s:409,d:{error:'progress_conflict',progress:current}})};
      d.progress[actor]=Object.assign({},r.b,{_revision:Number(current._revision||0)+1});
      localStorage.setItem(KEY,JSON.stringify(d));
      value={ok:true,revision:d.progress[actor]._revision};
    }`;
  assert.ok(fixture.includes(old), 'fake backend progress handler should match');
  return fixture.replace(old, replacement);
}

async function waitFor(predicate, label='fixture state') {
  for (let i=0;i<250;i++) {
    if (predicate()) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error(`timed out waiting for ${label}`);
}

async function load(t, extra={}) {
  const errors=[];
  const console=new VirtualConsole();
  console.on('jsdomError',e=>errors.push(e.message));
  const preload={
    'qa-server':JSON.stringify(serverState()),
    'tg-mine-qa-alpha':JSON.stringify(LOCAL),
    'tg-pending-qa-alpha':'1',
    'tg-outbox-qa-alpha':JSON.stringify([TICK]),
    ...extra,
  };
  const dom=new JSDOM(conflictFixture(),{
    url:`https://fixture.invalid/#g=${GROUP}`,
    runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,
    beforeParse(window){window.scrollTo=()=>{};for(const [k,v] of Object.entries(preload))window.localStorage.setItem(k,v);},
  });
  t.after(()=>dom.window.close());
  const document=dom.window.document;
  await waitFor(()=>document.querySelector('#conflictSaved'), 'progress conflict review');
  const read=key=>JSON.parse(dom.window.localStorage.getItem(key));
  const trace=()=>JSON.parse(dom.window.localStorage.getItem('qa-trace')||'[]');
  return {dom,document,errors,trace,server:()=>read('qa-server'),storage:dom.window.localStorage};
}

function sharedStorage(seed={}) {
  const map=new Map(Object.entries(seed).map(([k,v])=>[k,String(v)]));
  return {map,storage:{
    get length(){return map.size;},
    key:i=>Array.from(map.keys())[i]??null,
    getItem:k=>map.has(String(k))?map.get(String(k)):null,
    setItem:(k,v)=>map.set(String(k),String(v)),
    removeItem:k=>map.delete(String(k)),
    clear:()=>map.clear(),
  }};
}

async function loadShared(t,shared,sessionSnapshot=null) {
  const errors=[],console=new VirtualConsole();
  console.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(conflictFixture(),{
    url:`https://fixture.invalid/#g=${GROUP}`,
    runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,
    beforeParse(window){
      window.scrollTo=()=>{};
      Object.defineProperty(window,'localStorage',{configurable:true,value:shared.storage});
      if(sessionSnapshot)for(const [k,v] of Object.entries(sessionSnapshot))window.sessionStorage.setItem(k,v);
    },
  });
  t.after(()=>dom.window.close());
  const document=dom.window.document;
  await waitFor(()=>document.querySelector('#t1_3')||document.querySelector('.pcard'),'player page');
  if(!document.querySelector('#t1_3'))document.querySelector('.tab[data-tab="me"]').click();
  await waitFor(()=>document.querySelector('#t1_3'),'generation goals');
  const trace=()=>JSON.parse(shared.storage.getItem('qa-trace')||'[]');
  const sessionCopy=()=>{const result={};for(let i=0;i<dom.window.sessionStorage.length;i++){const k=dom.window.sessionStorage.key(i);result[k]=dom.window.sessionStorage.getItem(k);}return result;};
  return {dom,document,errors,trace,server:()=>JSON.parse(shared.storage.getItem('qa-server')),storage:shared.storage,sessionCopy};
}

test('a revision conflict pauses goal events and preserves the pending local snapshot', async t=>{
  const app=await load(t);
  const writes=app.trace().filter(e=>e.route==='progress'||e.route==='event');
  assert.deepEqual(writes.map(e=>e.route),['progress']);
  assert.equal(writes.some(e=>e.route==='event'),false);
  assert.equal(app.storage.getItem(`tg-group-${GROUP}:tg-pending-qa-alpha`),'1');
  assert.deepEqual(JSON.parse(app.storage.getItem(`tg-group-${GROUP}:tg-mine-qa-alpha`)),LOCAL);
  assert.equal(app.storage.getItem(`tg-group-${GROUP}:tg-outbox-qa-alpha`)!==null,true);
  assert.match(app.document.querySelector('.sheet').textContent,/This device/);
  assert.match(app.document.querySelector('.sheet').textContent,/Saved progress/);
  assert.deepEqual(app.errors,[]);
});

test('using saved progress discards rejected tick events and leaves the server copy authoritative', async t=>{
  const app=await load(t);
  app.document.querySelector('#conflictSaved').click();
  await waitFor(()=>app.document.querySelector('#scrim').hidden,'saved-progress resolution');
  await new Promise(resolve=>setTimeout(resolve,20));
  const writes=app.trace().filter(e=>e.route==='progress'||e.route==='event');
  assert.deepEqual(writes.map(e=>e.route),['progress']);
  assert.deepEqual(app.server().progress['qa-alpha'],SAVED);
  assert.equal(app.server().feed.some(e=>e.type==='tick'),false);
  assert.deepEqual(JSON.parse(app.storage.getItem(`tg-group-${GROUP}:tg-mine-qa-alpha`)),SAVED);
  assert.equal(app.storage.getItem(`tg-group-${GROUP}:tg-pending-qa-alpha`),null);
  assert.deepEqual(JSON.parse(app.storage.getItem(`tg-group-${GROUP}:tg-outbox-qa-alpha`)),[]);
});

test('keeping local changes retries from the server revision before publishing its goal event', async t=>{
  const app=await load(t);
  app.document.querySelector('#conflictLocal').click();
  await waitFor(()=>app.server().feed.some(e=>e.type==='tick'),'goal event after conflict resolution');
  const writes=app.trace().filter(e=>e.route==='progress'||e.route==='event');
  assert.deepEqual(writes.map(e=>e.route),['progress','progress','event']);
  assert.equal(writes[0].ticks.includes(1),true);
  assert.equal(writes[1].ticks.includes(1),true);
  assert.equal(app.server().progress['qa-alpha']._revision,5);
  assert.equal(app.server().progress['qa-alpha'].gens[1].ticks.includes(1),true);
  assert.equal(app.server().feed.filter(e=>e.type==='tick').length,1);
  assert.equal(app.storage.getItem(`tg-group-${GROUP}:tg-pending-qa-alpha`),null);
  assert.deepEqual(app.errors,[]);
});

test('the conflict choice and pending snapshot return after reload', async t=>{
  const first=await load(t);
  const copied={};
  for(let i=0;i<first.storage.length;i++){
    const key=first.storage.key(i);
    copied[key]=first.storage.getItem(key);
  }
  assert.equal(copied[`tg-group-${GROUP}:tg-pending-qa-alpha`],'1');
  copied['qa-trace']='[]';
  const second=await load(t,copied);
  assert.ok(second.document.querySelector('#conflictSaved'));
  assert.ok(second.document.querySelector('#conflictLocal'));
  assert.equal(second.storage.getItem(`tg-group-${GROUP}:tg-pending-qa-alpha`),'1');
  assert.deepEqual(JSON.parse(second.storage.getItem(`tg-group-${GROUP}:tg-mine-qa-alpha`)),LOCAL);
  assert.deepEqual(second.trace().filter(e=>e.route==='progress'||e.route==='event').map(e=>e.route),['progress']);
});

test('same-actor tabs keep separate pending snapshots across a conflicting save and reload', async t=>{
  const shared=sharedStorage({
    'qa-server':JSON.stringify(serverState()),
    'tg-token':'qa-alpha',
    'tg-g':GROUP,
  });
  const tabA=await loadShared(t,shared);
  const tabB=await loadShared(t,shared);

  // tab a makes an unsaved edit while offline; tab b still has the original in-memory copy.
  tabA.document.querySelector('#qa-offline').click();
  tabA.document.querySelector('#t1_3').click();
  await waitFor(()=>tabA.trace().some(e=>e.route==='progress'&&e.offline),'offline progress attempt');
  tabB.document.querySelector('#t1_4').click();
  await waitFor(()=>tabB.server().feed.some(e=>e.type==='tick'&&e.text.includes('Three serious relationships')),'tab b event save');

  const saved=tabB.server().progress['qa-alpha'];
  assert.equal(saved.gens[1].ticks.includes(3),false);
  assert.equal(saved.gens[1].ticks.includes(4),true);
  const aRecovery=Object.values(tabA.sessionCopy()).map(x=>JSON.parse(x)).find(x=>x&&x.version===1);
  const bRecovery=Object.values(tabB.sessionCopy()).map(x=>JSON.parse(x)).find(x=>x&&x.version===1);
  assert.ok(aRecovery,'tab a keeps a private recovery copy');
  assert.deepEqual(aRecovery.mine.gens[1].ticks.sort((a,b)=>a-b),[2,3]);
  assert.equal(aRecovery.outbox.some(e=>e.goal==='Open a bakery: Get to Work retail or a Businesses & Hobbies small business'),true);
  assert.equal(bRecovery,undefined,'tab b clears recovery after its progress and event are accepted');

  // Reconnect tab a. Its stale full snapshot must conflict before its tick event is sent.
  tabA.document.querySelector('#qa-online').click();
  await waitFor(()=>tabA.document.querySelector('#conflictSaved'),'tab a conflict review');
  assert.equal(tabA.server().progress['qa-alpha'].gens[1].ticks.includes(4),true);
  assert.equal(tabA.server().feed.some(e=>e.text.includes('Three serious relationships')),true);
  assert.equal(tabA.server().feed.some(e=>e.text.includes('Open a bakery')),false);

  const recovery=tabA.sessionCopy();
  shared.storage.setItem('qa-trace','[]');
  tabA.dom.window.close();
  const reloaded=await loadShared(t,shared,recovery);
  await waitFor(()=>reloaded.document.querySelector('#conflictSaved'),'reloaded tab conflict review');
  const visible=reloaded.document.querySelector('.sheet').textContent;
  assert.match(visible,/Open a bakery/);
  assert.match(visible,/Three serious relationships/);
  assert.equal(reloaded.server().progress['qa-alpha'].gens[1].ticks.includes(4),true);
  const writes=reloaded.trace().filter(e=>e.route==='progress'||e.route==='event');
  assert.deepEqual(writes.map(e=>e.route),['progress']);
  assert.equal(writes[0].offline,false);
  assert.equal(reloaded.server().feed.some(e=>e.text.includes('Open a bakery')),false);
  assert.deepEqual(reloaded.errors,[]);
});
