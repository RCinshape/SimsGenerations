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
