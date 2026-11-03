/** Life/legacy news. No private configuration or game/save data belongs here. */
var AGE_WORD = { NEWBORN: 'newborn', BABY: 'baby', INFANT: 'infant', TODDLER: 'toddler', CHILD: 'child', TEEN: 'teen', YOUNGADULT: 'young adult', ADULT: 'adult', ELDER: 'elder' };
var AGE_ORDER = Object.keys(AGE_WORD);
var POLICE_MIN = 20000;
var LIFE_NEWS_KINDS_ = ['baby', 'death', 'revive', 'rescue', 'marry', 'divorce', 'ageup', 'pregnancy', 'abduct', 'preterm'];
function simName_(x) { return ((x.first || '') + ' ' + (x.last || '')).trim() || 'Someone'; }
function money_(n) { return '§' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function cleanLife_(life) {
  var out = {};
  if (!plainObj_(life)) return out;
  ['pregnant', 'abducted', 'preterm'].forEach(function (key) {
    if (typeof life[key] === 'boolean') out[key] = life[key];
  });
  return out;
}
function cleanLifeEvents_(events) {
  if (!Array.isArray(events)) return [];
  return events.slice(-256).filter(plainObj_).map(function (e) {
    var id = clean_(e.id, 80), kind = clean_(e.kind, 16), simId = String(e.simId || '');
    if (!/^[a-z0-9_-]{8,80}$/i.test(id) || LIFE_NEWS_KINDS_.indexOf(kind) < 0 || !/^\d{1,24}$/.test(simId)) return null;
    var at = Number(e.at);
    if (!Number.isSafeInteger(at) || at < 946684800000 || at > Date.now() + 300000) return null;
    return { id: id, kind: kind, simId: simId, at: at, hh: clean_(e.hh, 30), slot: clean_(e.slot, 40),
      partnerId: /^\d{1,24}$/.test(String(e.partnerId || '')) ? String(e.partnerId) : '', age: AGE_WORD[e.age] ? e.age : '' };
  }).filter(Boolean);
}
function lifeNewsText_(who, kind, sim, partner, age) {
  var W = b_(who), name = b_(simName_(sim));
  if (kind === 'revive') return '✨ ' + name + ' is alive again in ' + W + "'s legacy. Back from the Grim Reaper!";
  if (kind === 'rescue') return '🙏 ' + name + ' has escaped death in ' + W + "'s legacy. The Grim Reaper will have to wait!";
  if (kind === 'divorce') return '💔 ' + name + ' and ' + b_(simName_(partner)) + ' have divorced in ' + W + "'s legacy.";
  if (kind === 'abduct') return '🛸 ' + name + ' has been abducted by aliens in ' + W + "'s legacy.";
  if (kind === 'preterm') return '🏥 ' + name + ' has gone into pre-term labour in ' + W + "'s legacy.";
  if (kind === 'pregnancy') return '🤰 ' + name + ' is expecting a baby in ' + W + "'s legacy.";
  if (kind === 'marry') return voice_('marry', { who: W, a: name, b: b_(simName_(partner)) });
  if (kind === 'ageup') return voice_('ageup', { who: W, name: name, age: AGE_WORD[age] });
  if (kind === 'baby') return voice_('baby', { who: W, parent: partner ? b_(simName_(partner)) : 'the family', name: name });
  return voice_('death', { who: W, name: name });
}
function gameNews_(who, oldS, newS) {
  if (!newS || !Array.isArray(newS.sims)) return [];
  var O = {}, N = {}, out = [], covered = {}, oldIds = {};
  ((oldS && oldS.sims) || []).forEach(function (x) { O[x.id] = x; });
  newS.sims.forEach(function (x) { N[x.id] = x; });
  ((oldS && oldS.lifeEvents) || []).forEach(function (e) { oldIds[e.id] = true; });
  var hh = String((newS.household || {}).id || ''), slot = String((newS.legacy || {}).slot || '');
  function add(kind, x, partner, age, event) {
    if (!x || (['marry', 'divorce'].indexOf(kind) >= 0 && !partner) || (kind === 'ageup' && !AGE_WORD[age])) return;
    var pair = partner && ['marry', 'divorce'].indexOf(kind) >= 0 ? [String(x.id), String(partner.id)].sort().join('_') : String(x.id);
    var identity = kind + '_' + pair;
    if (!event && covered[identity]) return;
    covered[identity] = true;
    var at = event ? event.at : Number(newS.at) * 1000;
    if (!Number.isSafeInteger(at) || at < 946684800000 || at > Date.now() + 300000) at = Date.now();
    var key = event ? 'event_' + event.id : 'state_' + sha256hex_([hh, slot, oldS && oldS.at, newS.at, identity, age || ''].join('|')).slice(0, 40);
    out.push({ k: key, kind: kind, at: at, t: lifeNewsText_(who, kind, x, partner, age) });
  }
  // Journal entries preserve incidents that begin and end between uploads.
  cleanLifeEvents_(newS.lifeEvents).forEach(function (e) {
    if (oldIds[e.id] || e.hh !== hh || e.slot !== slot) return;
    var x = N[e.simId] || O[e.simId], partner = N[e.partnerId] || O[e.partnerId];
    if (!x) return;
    add(e.kind, x, partner, e.age, e);
    if (partner && ['marry', 'divorce'].indexOf(e.kind) >= 0) covered[e.kind + '_' + [String(x.id), String(partner.id)].sort().join('_')] = true;
  });
  if (!oldS || !Array.isArray(oldS.sims) || !oldS.sims.length) return out.sort(function (a, b) { return a.at - b.at; });
  // A different save is a baseline, never evidence of a transition.
  if (String((oldS.household || {}).id || '') !== hh || String((oldS.legacy || {}).slot || '') !== slot) return [];
  newS.sims.forEach(function (x) {
    var o = O[x.id];
    if (!o) {
      if (['NEWBORN', 'BABY', 'INFANT'].indexOf(x.age) >= 0) {
        var parent = (x.parents || []).map(function (id) { return O[id]; }).filter(function (p) { return p && p.inHousehold; })[0];
        if (parent) add('baby', x, parent);
      }
      return;
    }
    if (x.deadKnown !== false && o.deadKnown !== false) {
      if (x.dead && !o.dead) add('death', x);
      if (!x.dead && o.dead) add('revive', x);
    }
    if (x.dead) return;
    var former = o.spouse && (N[o.spouse] || O[o.spouse]);
    // Require explicit relationship state on both living, present Sims.
    if (o.spouse && x.spouse !== o.spouse && x.spouseKnown !== false && former && N[o.spouse] &&
        !N[o.spouse].dead && N[o.spouse].spouseKnown !== false && N[o.spouse].spouse !== x.id &&
        (x.inHousehold || former.inHousehold)) add('divorce', x, former);
    if (x.spouse && x.spouse !== o.spouse && N[x.spouse] && !N[x.spouse].dead &&
        (x.inHousehold || N[x.spouse].inHousehold)) add('marry', x, N[x.spouse]);
    if (o.age && AGE_ORDER.indexOf(o.age) >= 0 && AGE_ORDER.indexOf(x.age) > AGE_ORDER.indexOf(o.age)) add('ageup', x, null, x.age);
    if (!x.inHousehold) return;
    var life = x.life || {}, oldLife = o.life || {};
    [['pregnant', 'pregnancy'], ['abducted', 'abduct'], ['preterm', 'preterm']].forEach(function (entry) {
      if (life[entry[0]] === true && oldLife[entry[0]] === false) add(entry[1], x);
    });
  });
  // Existing legacy money checks remain independent of skill/career news.
  var f0 = oldS.household && oldS.household.funds, f1 = newS.household && newS.household.funds;
  if (typeof f0 === 'number' && typeof f1 === 'number' && f1 - f0 >= POLICE_MIN) {
    out.push({ k: 'police_' + hh + '_' + Math.floor(f1 / 1000), kind: 'police', at: Date.now(),
      t: voice_('police', { who: b_(who), money: b_(money_(f1 - f0)) }) });
  }
  return out.sort(function (a, b) { return a.at - b.at; });
}

/** Called under the relay's lock. Retain every fresh event; never truncate a sync to eight. */
function newNews_(sn, who, events) {
  if (!events.length) return [];
  var file = 'news-seen__' + sn + '.json', seen = readJson_(file, null);
  if (!Array.isArray(seen)) seen = prop_('nk_' + sn) || [];
  var fresh = [];
  events.forEach(function (e) {
    if (LIFE_NEWS_KINDS_.indexOf(e.kind) < 0 && e.kind !== 'police') return;
    if (!e.k || seen.indexOf(e.k) >= 0) return;
    seen.push(e.k); fresh.push(e);
  });
  if (!fresh.length) return [];
  var log = readJson_('news.json', []), receivedAt = Date.now();
  fresh.forEach(function (e) { log.push({ id: e.k, at: e.at || receivedAt, receivedAt: receivedAt, who: who, kind: e.kind, t: e.t }); });
  writeJson_('news.json', log.slice(-400));
  writeJson_(file, seen.slice(-5000));
  return fresh;
}
