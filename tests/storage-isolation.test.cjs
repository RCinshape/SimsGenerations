const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const storageCode = page.slice(page.indexOf('const rawStorage='), page.indexOf('const INVITE='));
const live = 'live-backend-000000000000', stage = 'stage-backend-00000000000';

function open(storage, group) {
  const context = vm.createContext({
    URLSearchParams, localStorage: {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    window: {TG_WEB:1,addEventListener(){}},
    location:{hash:'#g='+group,search:'',pathname:'/',reload(){}},
  });
  vm.runInContext(storageCode, context);
  return code=>vm.runInContext(code,context);
}

test('a staging link cannot adopt the live session or unsent progress', () => {
  const store = new Map([['tg-g',live],['tg-token','live-session'],['tg-outbox-dani','private-live-queue'],['tg-mine-dani','private-live-progress']]);
  const staging = open(store, stage);
  for(const k of ['tg-token','tg-outbox-dani','tg-mine-dani']) assert.equal(staging(`ls.get(${JSON.stringify(k)})`),null);
  staging('ls.set("tg-token","stage-session");ls.set("tg-outbox-dani","stage-queue");');
  const production = open(store, live);
  assert.equal(production('ls.get("tg-token")'),'live-session');
  assert.equal(production('ls.get("tg-outbox-dani")'),'private-live-queue');
  assert.equal(production('ls.get("tg-mine-dani")'),'private-live-progress');
  assert.equal(open(store,stage)('ls.get("tg-token")'),'stage-session');
});

test('logging out after migration cannot resurrect an old unscoped token', () => {
  const store = new Map([['tg-g',live],['tg-token','old-session']]);
  const run = open(store, live);
  assert.equal(run('ls.get("tg-token")'),'old-session');
  run('ls.del("tg-token")');
  assert.equal(open(store,live)('ls.get("tg-token")'),null);
  assert.equal(store.get('tg-token'),'old-session'); // legacy recovery copy stays intact
});

test('unattributed legacy data is preserved without assigning it to a new group', () => {
  const store = new Map([['tg-token','unknown-session']]);
  assert.equal(open(store,stage)('ls.get("tg-token")'),null);
  assert.equal(store.get('tg-token'),'unknown-session');
});
