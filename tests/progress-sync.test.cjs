const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(process.env.APP_SOURCE || path.join(__dirname, '..', 'index.html'), 'utf8');
const start = page.indexOf('async function webCall(');
const core = page.slice(start, page.indexOf('/* ---------- tabs / routing', start));
const session = page.slice(page.indexOf('/* ---------- session ownership'), start);
const goals = ['max the skills', 'finish the aspiration', 'sell baked goods'];

function setup() {
  const storage = new Map([['tg-token', 'session-a']]);
  const sent = [], listeners = {};
  const elements = new Map();
  let transport = async () => ({ s: 200, d: { ok: true } });
  const context = vm.createContext({
    AbortController,
    console,
    JSON,
    Date,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval() {},
    ls: { get: k => storage.get(k) || null, set: (k, v) => storage.set(k, v), del: k => storage.delete(k) },
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, { hidden: true });
      return elements.get(selector);
    },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    closeSheet() {},
    authScreen() {},
    key: n => String(n || '').toLowerCase().trim(),
    uid: () => 'eventid123',
    G: n => n === 1 ? { n: 1 } : null,
    trackGoals: () => goals.map(t => ({ t })),
    autoEmit() {},
    doneSet: () => new Set(vm.runInContext('MINE?.gens?.[1]?.ticks || []', context)),
    fetch: async (url, options) => {
      const request = JSON.parse(options.body);
      sent.push(request);
      const response = await transport(request);
      return { json: async () => response };
    },
  });
  vm.runInContext('let ME="player-a"; const GAS=true, WEB=true, GID="test-backend";', context);
  if (session.startsWith('/* ---------- session ownership')) vm.runInContext(session, context);
  vm.runInContext(core, context);
  vm.runInContext('MINE={name:ME,current:1,updatedAt:1,gens:{1:{ticks:[]}}}; LIVE.progress[ME]=MINE;', context);
  return {
    context, storage, sent, listeners,
    run: code => vm.runInContext(code, context),
    setTransport: fn => { transport = fn; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('a tab never sends one player’s progress with another tab’s session', async () => {
  const app = setup();
  app.storage.set('tg-token', 'session-b'); // another tab picked a different player
  app.run('MINE.gens[1].ticks=[1]; saveMine();');
  await app.run('flush()');
  assert.equal(app.sent.filter(r => r.api === 'progress' && r.t === 'session-b').length, 0);
});

test('an edit made while a save is pending remains dirty and is saved next', async () => {
  const app = setup(), pending = deferred();
  let first = true;
  app.setTransport(async request => {
    if (request.api === 'progress' && first) { first = false; await pending.promise; }
    return { s: 200, d: { ok: true } };
  });
  app.run('MINE.gens[1].ticks=[1]; saveMine();');
  const saving = app.run('flush()');
  app.run('MINE.gens[1].ticks.push(2); saveMine();');
  pending.resolve();
  await saving;
  await app.run('flush()');
  const saves = app.sent.filter(r => r.api === 'progress');
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1].b.gens[1].ticks, [1, 2]);
});

test('an offline tick that was undone is not published on reconnect', async () => {
  const app = setup();
  app.run('outbox=[{id:"eventid123",who:ME,type:"tick",gen:1,text:"ticked “finish the aspiration”",at:123}]; MINE.gens[1].ticks=[];');
  await app.run('flush()');
  assert.equal(app.sent.filter(r => r.api === 'event').length, 0);
  assert.equal(app.run('outbox.length'), 0);
});

test('a pending tick waits for the latest progress to be saved', async () => {
  const app = setup(), pending = deferred();
  let first = true;
  app.setTransport(async request => {
    if (request.api === 'progress' && first) { first = false; await pending.promise; }
    return { s: 200, d: { ok: true } };
  });
  app.run('MINE.gens[1].ticks=[1]; saveMine(); outbox=[{id:"eventid123",who:ME,type:"tick",gen:1,text:"ticked “finish the aspiration”",at:123}];');
  const saving = app.run('flush()');
  app.run('MINE.gens[1].ticks=[]; saveMine();');
  pending.resolve();
  await saving;
  assert.equal(app.sent.filter(r => r.api === 'event').length, 0);
  await app.run('flush()');
  assert.equal(app.sent.filter(r => r.api === 'progress').length, 2);
});

test('a completed queued goal is sent after its progress, with its original time', async () => {
  const app = setup();
  app.run('MINE.gens[1].ticks=[1]; saveMine(); outbox=[{id:"eventid123",who:ME,type:"tick",gen:1,text:"ticked “finish the aspiration”",at:123,goal:"finish the aspiration",source:"manual"}];');
  await app.run('flush()');
  assert.deepEqual(app.sent.map(r => r.api), ['progress', 'event']);
  const event = app.sent[1].b;
  assert.equal(event.at, 123);
  assert.equal(event.actor, 'player-a');
  assert.equal(event.source, 'manual');
});

test('a late response from the previous account does not consume the new account’s queue', async () => {
  const app = setup(), pending = deferred();
  app.setTransport(async () => { await pending.promise; return { s: 200, d: { ok: true } }; });
  app.run('outbox=[{id:"old-event",who:ME,type:"post",gen:1,text:"old",at:123}];');
  const sending = app.run('flush()');
  app.run('ME="player-b"; MINE={name:ME,current:1,gens:{1:{ticks:[]}}}; outbox=[{id:"new-event",who:ME,type:"post",gen:1,text:"new",at:456}];');
  pending.resolve();
  await sending;
  assert.equal(app.run('outbox.length'), 1);
  assert.equal(app.run('outbox[0].id'), 'new-event');
});

test('failed progress saves keep events queued instead of publishing completion', async () => {
  const app = setup();
  app.setTransport(async () => { throw Error('offline'); });
  app.run('MINE.gens[1].ticks=[1]; saveMine(); outbox=[{id:"eventid123",who:ME,type:"tick",gen:1,text:"ticked “finish the aspiration”",at:123}];');
  await app.run('flush()');
  assert.equal(app.sent.filter(r => r.api === 'event').length, 0);
  assert.equal(app.run('outbox.length'), 1);
  assert.equal(app.run('dirty'), true);
});

test('an unexpected live-response identity cannot overwrite the visible player', async () => {
  const app = setup();
  app.setTransport(async () => ({s:200,d:{me:'player-b',roster:['player-b'],progress:[],feed:[]}}));
  await assert.rejects(app.run('pull()'), /session_changed/);
  assert.equal(app.run('ME'), '');
});

test('a newer remote copy cannot replace edits that are still waiting to save', async () => {
  const app = setup();
  app.run('MINE.gens[1].ticks=[1]; saveMine();');
  app.setTransport(async () => ({s:200,d:{me:'player-a',roster:['player-a'],progress:[{name:'player-a',data:{name:'player-a',current:1,updatedAt:Date.now()+100000,gens:{1:{ticks:[]}}}}],feed:[]}}));
  await app.run('pull()');
  assert.deepEqual(Array.from(app.run('MINE.gens[1].ticks')), [1]);
});

test('a stale completion from an old outbox is not displayed on the next poll', async () => {
  const app = setup();
  app.run('outbox=[{id:"eventid123",who:ME,type:"tick",gen:1,text:"ticked “finish the aspiration”",at:123}];');
  app.setTransport(async () => ({s:200,d:{me:'player-a',roster:['player-a'],progress:[],feed:[]}}));
  await app.run('pull()');
  assert.equal(app.run('LIVE.feed.length'), 0);
});
