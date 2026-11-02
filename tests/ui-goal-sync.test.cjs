const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { html } = require('./create-debug-fixture.cjs');

async function waitFor(predicate) {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('fixture did not reach the expected state');
}

async function load(t, preload={}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: 'https://fixture.invalid/#g=fixture-backend-000000000000',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window) { window.scrollTo = () => {}; for(const [k,v] of Object.entries(preload))window.localStorage.setItem(k,v); },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const trace = () => JSON.parse(dom.window.localStorage.getItem('qa-trace') || '[]');
  const server = () => JSON.parse(dom.window.localStorage.getItem('qa-server'));
  await waitFor(() => document.querySelectorAll('.pcard').length === 2);
  document.querySelector('.tab[data-tab="me"]').click();
  await waitFor(() => document.querySelector('#t1_1'));
  assert.deepEqual(errors, []);
  return { dom, document, trace, server, click: selector => document.querySelector(selector).click() };
}

test('loading the page and polling do not tick an incomplete aspiration', async t => {
  const app = await load(t);
  assert.equal(app.document.querySelector('#t1_1').checked, false);
  app.click('#qa-online');
  await waitFor(() => app.trace().some(e => e.control === 'reconnected'));
  assert.equal(app.server().feed.filter(e => e.type === 'tick').length, 0);
});

test('the actual checkbox handler saves completion before publishing its event', async t => {
  const app = await load(t);
  app.click('#t1_1');
  await waitFor(() => app.server().feed.some(e => e.type === 'tick'));
  const writes = app.trace().filter(e => e.route === 'progress' || e.route === 'event');
  if (process.env.TRACE_DIR) fs.writeFileSync(process.env.TRACE_DIR + '/checkbox-write-order.json', JSON.stringify(app.trace(), null, 2));
  assert.equal(writes[0].route, 'progress');
  assert.equal(app.server().progress['qa-alpha'].gens[1].ticks.includes(1), true);
});

test('the actual offline tick-then-untick flow does not create a completion on reconnect', async t => {
  const app = await load(t);
  app.click('#qa-offline');
  app.click('#t1_1');
  await waitFor(() => app.trace().some(e => e.offline));
  app.click('#t1_1');
  await new Promise(resolve => setTimeout(resolve, 20));
  app.click('#qa-online');
  await waitFor(() => app.trace().some(e => e.control === 'reconnected'));
  if (process.env.TRACE_DIR) fs.writeFileSync(process.env.TRACE_DIR + '/offline-tick-untick.json', JSON.stringify(app.trace(), null, 2));
  assert.equal(app.server().feed.filter(e => e.type === 'tick').length, 0);
  assert.equal(app.server().progress['qa-alpha'].gens[1].ticks.includes(1), false);
});

test('the visible player cannot write as a session selected elsewhere', async t => {
  const app = await load(t);
  app.click('#qa-account');
  app.click('#t1_1');
  await waitFor(() => app.trace().some(e => e.route === 'event'));
  if (process.env.TRACE_DIR) fs.writeFileSync(process.env.TRACE_DIR + '/shared-session.json', JSON.stringify(app.trace(), null, 2));
  const events = app.server().feed.filter(e => e.type === 'tick');
  assert.equal(events.length, 1);
  assert.equal(events[0].who, 'qa-alpha');
  assert.equal(app.server().progress['qa-beta'].gens[1].ticks.includes(1), false);
});

test('a historical tick is clearly distinguished from current saved completion', async t => {
  const app = await load(t);
  const state=app.server();
  state.feed=[{id:'historical-event',at:1,who:'qa-alpha',type:'tick',gen:1,text:'ticked “Finish the aspiration: Romantic Explorer”'}];
  app.dom.window.localStorage.setItem('qa-server',JSON.stringify(state));
  app.click('#qa-online');
  await waitFor(() => app.trace().some(e => e.control === 'reconnected'));
  app.click('.tab[data-tab="hood"]');
  assert.match(app.document.querySelector('.tick-status')?.textContent || '', /not marked complete now/);
});

test('a newer cache without unsaved edits cannot resurrect a completion on login', async t => {
  const cached={name:'qa-alpha',current:1,updatedAt:Date.now()+100000,gens:{1:{ticks:[1,2],heir:'Sample Heir'}}};
  const app=await load(t,{'tg-mine-qa-alpha':JSON.stringify(cached)});
  assert.equal(app.document.querySelector('#t1_1').checked,false);
  assert.equal(app.trace().filter(e=>e.route==='progress'||e.route==='event').length,0);
});

test('an explicitly unsaved offline edit is restored and its pending flag clears after saving', async t => {
  const cached={name:'qa-alpha',current:1,updatedAt:Date.now()+100000,gens:{1:{ticks:[1,2],heir:'Sample Heir'}}};
  const app=await load(t,{'tg-mine-qa-alpha':JSON.stringify(cached),'tg-pending-qa-alpha':'1'});
  await waitFor(()=>app.trace().some(e=>e.route==='progress'));
  assert.equal(app.server().progress['qa-alpha'].gens[1].ticks.includes(1),true);
  assert.equal(app.dom.window.localStorage.getItem('tg-group-fixture-backend-000000000000:tg-pending-qa-alpha'),null);
});
