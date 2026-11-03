// Private, owner-scoped manual portraits; never alter game or progress records.
var PORTRAIT_MAX_BASE64_ = 48000;
var PORTRAIT_MAX_COUNT_ = 900;
function portraitId_(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id); }
function portraitIndex_(sn) {
  var index = readJson_('portraits__' + sn + '.json', []);
  if (!Array.isArray(index) || index.length > PORTRAIT_MAX_COUNT_) throw Error('invalid portrait index');
  var seen = Object.create(null);
  return index.map(function (entry) {
    if (!entry || !portraitId_(entry.simId) || seen[entry.simId] || !Number.isSafeInteger(entry.at) || entry.at <= 0) throw Error('invalid portrait index entry');
    seen[entry.simId] = true;
    return { simId: entry.simId, at: entry.at };
  });
}
function portraitImageValid_(image) {
  if (typeof image !== 'string' || image.indexOf('data:image/jpeg;base64,') !== 0) return false;
  var payload = image.slice(23);
  if (!payload || payload.length > PORTRAIT_MAX_BASE64_ || payload.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) return false;
  try {
    var bytes = Utilities.base64Decode(payload);
    return bytes.length >= 4 && bytes.length <= 36000 && Utilities.base64Encode(bytes) === payload &&
      (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216 && (bytes[bytes.length-2] & 255) === 255 && (bytes[bytes.length-1] & 255) === 217;
  } catch (e) { return false; }
}
function portraitKnownSim_(sn, owner, id) {
  var fam = readJson_('fam__' + sn + '.json', null);
  if (fam && fam.sims && Object.prototype.hasOwnProperty.call(fam.sims, id)) return true;
  var roster = {}; roster[sn] = owner;
  return syncFor_(roster, {}).recs.some(function (item) {
    var sims = item && item.rec && item.rec.data && item.rec.data.sims;
    return Array.isArray(sims) && sims.some(function (sim) { return sim && String(sim.id) === id; });
  });
}
function portraitAction_(me, body) {
  body = body && typeof body === 'object' ? body : {};
  var action = body.action, owner = body.owner, sn = safe_(owner), roster = roster_();
  if (typeof owner !== 'string' || !sn || !Object.prototype.hasOwnProperty.call(roster, sn) || !sameActor_(roster[sn], owner) || (!isTester_(me) && isTester_(sn))) return res_(404, { error: 'not_found' });
  owner = roster[sn];
  if (action === 'list') return res_(200, { portraits: portraitIndex_(sn) });
  if (['get', 'put', 'remove'].indexOf(action) < 0 || !portraitId_(body.simId)) return res_(400, { error: 'bad_portrait' });
  var id = body.simId, imageName = 'portrait__' + sn + '__' + id + '.json', indexName = 'portraits__' + sn + '.json';
  if (action === 'get') {
    var found = readJson_(imageName, null);
    return found && portraitImageValid_(found.image) && Number.isSafeInteger(found.at) && found.at > 0 ? res_(200, { image: found.image, at: found.at }) : res_(404, { error: 'not_found' });
  }
  if (!sameActor_(me, owner)) return res_(403, { error: 'forbidden' });
  if (!Number.isSafeInteger(body.ifAt) || body.ifAt < 0) return res_(400, { error: 'bad_portrait' });
  if (action === 'put' && !portraitImageValid_(body.image)) return res_(400, { error: 'bad_portrait' });
  return withLock_(function () {
    var index = portraitIndex_(sn), pos = index.findIndex(function (x) { return x.simId === id; });
    var raw = readText_(imageName), old = null;
    if (raw !== null) {
      try { old = JSON.parse(raw); } catch (e) { throw Error('invalid portrait record'); }
      if (!old || !portraitImageValid_(old.image) || !Number.isSafeInteger(old.at) || old.at <= 0) throw Error('invalid portrait record');
    }
    var oldAt = old ? old.at : 0;
    if (action === 'remove') {
      if (old && body.ifAt !== oldAt) return res_(409, { error: 'portrait_conflict', at: oldAt });
      if (old) trash_(imageName);
      if (pos >= 0) { index.splice(pos, 1); writeJson_(indexName, index); }
      return res_(200, { ok: true });
    }
    var duplicate = old && old.image === body.image, at;
    if (!duplicate && body.ifAt !== oldAt) return res_(409, { error: 'portrait_conflict', at: oldAt });
    if (!duplicate && !portraitKnownSim_(sn, owner, id)) return res_(404, { error: 'sim_not_found' });
    if (pos < 0 && index.length >= PORTRAIT_MAX_COUNT_) {
      if (duplicate) return res_(200, { ok: true, at: oldAt, dup: true });
      return res_(409, { error: 'portrait_limit' });
    }
    if (duplicate) at = oldAt;
    else {
      var clockKey = 'portrait_clock_' + sn, clockRaw = props_().getProperty(clockKey), clock = 0;
      if (clockRaw !== null) {
        if (typeof clockRaw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(clockRaw)) throw Error('invalid portrait clock');
        clock = Number(clockRaw);
        if (!Number.isSafeInteger(clock)) throw Error('invalid portrait clock');
      }
      at = Math.max(Date.now(), oldAt + 1, clock + 1);
      if (!Number.isSafeInteger(at)) throw Error('invalid portrait timestamp');
      props_().setProperty(clockKey, String(at));
      writeJson_(imageName, { image: body.image, at: at });
    }
    if (pos < 0) { index.push({ simId: id, at: at }); writeJson_(indexName, index); }
    else if (index[pos].at !== at) { index[pos].at = at; writeJson_(indexName, index); }
    return res_(200, duplicate ? { ok: true, at: at, dup: true } : { ok: true, at: at });
  });
}
