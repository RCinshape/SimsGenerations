const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { build } = require('../scripts/build-health-presence.cjs');

// A portable fixture retains the production routing and health wiring markers.
const fixture = `
function safe_(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function res_(s,d,t) { return {s:s,d:d,t:t}; }
function api(path, body, token) {
  try {
    if (body && body.invalid) return res_(400, {});
    var r, me = sessionUser_(token);
    if (!me) return res_(401, {});
    switch (path) {
      case 'live': return res_(200, live_(me, body && body.have));
    }
    return res_(404, {});
  } catch (e) { return res_(500, {}); }
}
function healthData_() {
  var roster = roster_(), out = [];
  Object.keys(roster).sort().forEach(function (sn) {
    out.push({ name: roster[sn], picks: 0 });
  });
  return { now: Date.now(), players: out, host: [] };
}
`;
const privatePath = process.env.PRESENCE_BACKEND_SOURCE;
const sources = [['portable', fixture]];
if (privatePath) sources.push(['production', fs.readFileSync(privatePath, 'utf8')]);
else test('production backend presence integration', {skip:'set PRESENCE_BACKEND_SOURCE to a private unpatched bundle'}, () => {});

function setup(source) {
  let now = 1700000000000, fail = false, liveFail = false;
  const entries = new Map(), writes = [];
  class Clock extends Date { static now() { return now; } }
  const cache = { put(k,v,ttl) { if (fail) throw Error('cache'); writes.push([k,v,ttl]); entries.set(k,{v, exp:now + ttl * 1000}); },
    get(k) { if (fail) throw Error('cache'); const x = entries.get(k); return x && x.exp > now ? x.v : null; } };
  const ctx = vm.createContext({ Date: Clock, CacheService: { getScriptCache: () => cache } });
  vm.runInContext(build(source), ctx);
  Object.assign(ctx, {
    sessionUser_: tok => ({one:'alice', two:'alice', other:'bob'})[tok] || '',
    bump_: () => 0, plainJson_: body => !body.invalid,
    live_: me => { if (liveFail) throw Error('failed poll'); return {me}; },
    roster_: () => ({alice:'Alice', bob:'Bob'}),
    prop_: () => null, props_: () => ({getProperty: () => ''}),
    readJson_: (_name, fallback) => fallback, isTester_: () => false,
    updateInfo_: () => null, links_: () => ({}), notifyView_: () => ({}), betaInfo_: () => ({}), codesOn_: () => false,
    hostLog_: () => {},
  });
  return {ctx, entries, writes, setNow: n => {now=n;}, setFail: v => {fail=v;}, setLiveFail: v => {liveFail=v;}, now: () => now};
}
for (const [name, source] of sources) test(`${name}: authenticated live polling and host presence`, () => {
  const s = setup(source), {ctx, entries, writes} = s;
  assert.equal(ctx.api('live', {}, '').s, 401);
  assert.equal(ctx.api('live', {invalid:true}, 'one').s, 400);
  assert.equal(writes.length, 0);
  s.setLiveFail(true); assert.equal(ctx.api('live', {}, 'one').s, 500); assert.equal(writes.length, 0); s.setLiveFail(false);
  const first = ctx.api('live', {}, 'one');
  assert.equal(first.s, 200); assert.equal(first.d.me, 'alice'); assert.equal(first.d.appSeenAt, undefined);
  assert.equal(writes[0][2], 300); assert.equal(entries.size, 1);
  s.setNow(s.now() + 20000); ctx.api('live', {}, 'two');
  assert.equal(entries.size, 1); assert.equal(writes.length, 2);
  let h = ctx.healthData_();
  assert.equal(h.appPresenceWindowMs, 90000); assert.equal(h.now, s.now());
  assert.equal(h.players[0].appSeenAt, s.now()); assert.equal(h.players[1].appSeenAt, 0);
  entries.set('app_presence_alice', {v:String(s.now() + 1), exp:s.now()+300000});
  assert.equal(ctx.healthData_().players[0].appSeenAt, 0);
  entries.set('app_presence_alice', {v:'Infinity', exp:s.now()+300000});
  assert.equal(ctx.healthData_().players[0].appSeenAt, 0);
  ctx.api('live', {}, 'one'); s.setNow(s.now() + 300001);
  assert.equal(ctx.healthData_().players[0].appSeenAt, 0);
  s.setFail(true); assert.equal(ctx.api('live', {}, 'other').s, 200); assert.equal(ctx.healthData_().players[0].appSeenAt, 0);
});

test('builder rejects duplicate markers, drift and reapplication', () => {
  assert.throws(() => build(build(fixture)), /already present/);
  assert.throws(() => build(fixture + "\ncase 'live':"), /exactly one live/);
  assert.throws(() => build(fixture.replace('function healthData_()', 'function changed_()')), /healthData/);
  assert.throws(() => build(fixture.replace('picks:', 'changed:')), /health player/);
});

test('builder changes only documented insertion points and appends the module', () => {
  for (const [,source] of sources) {
    const result = build(source);
    const module = fs.readFileSync(require('node:path').join(__dirname,'../gas/HealthPresence.gs'), 'utf8');
    const recovered = result.slice(0, -('\n' + module + '\n').length)
      .replace("case 'live': r = live_(me, body && body.have); recordAppPresence_(me); return res_(200, r);", "case 'live': return res_(200, live_(me, body && body.have));")
      .replace('function healthData_() {\n  var now = Date.now(), roster = roster_(), out = [];', 'function healthData_() {\n  var roster = roster_(), out = [];')
      .replace('out.push({ name: roster[sn], appSeenAt: readAppPresence_(sn, now), picks:', 'out.push({ name: roster[sn], picks:')
      .replace('return { now: now, appPresenceWindowMs: APP_PRESENCE_WINDOW_MS_, players: out, host:', 'return { now: Date.now(), players: out, host:');
    assert.equal(recovered, source);
  }
});
