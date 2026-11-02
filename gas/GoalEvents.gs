/** Completion events are accepted only after the corresponding progress exists.
 * The build supplies GOAL_CATALOG_, trackGoals_ and gameGoalSet_ from index.html.
 * No deployment identifiers, credentials or player data belong in this module.
 */
function sameActor_(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}
function saveProgress_(me, b) {
  if (!plainJson_(b, MAX_PROGRESS, true)) return res_(400, { error: 'bad_json' });
  if (!plainObj_(b.gens) || !(Number(b.current) >= 1 && Number(b.current) <= 20)) return res_(400, { error: 'bad_progress' });
  var baseRevision = b._revision === undefined ? 0 : b._revision;
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) return res_(400, { error: 'bad_progress' });
  if (!sameActor_(b.name, me)) return res_(409, { error: 'actor_mismatch' });
  return withLock_(function () {
    var name = 'prog__' + safe_(me) + '.json', previous = readJson_(name, null);
    var previousRevision = previous && Number.isSafeInteger(previous._revision) && previous._revision >= 0 ? previous._revision : 0;
    if (baseRevision !== previousRevision) {
      var canonical = previous ? cleanProgress_(previous) : null;
      if (canonical) { canonical.name = me; canonical._revision = previousRevision; }
      return res_(409, { error: 'progress_conflict', progress: canonical });
    }
    var progress = cleanProgress_(b);
    progress.name = me;
    progress._revision = previousRevision + 1;
    writeJson_(name, progress);
    return res_(200, { ok: true, revision: progress._revision });
  });
}
function addEvent_(me, b) {
  b = b || {};
  var type = String(b.type || ''), gen = Math.floor(Number(b.gen)), id = clean_(b.id, 40);
  if (EVENT_TYPES.indexOf(type) < 0 || !(gen >= 1 && gen <= 20) || !/^[a-z0-9]{6,40}$/.test(id)) return res_(400, { error: 'bad_event' });
  if (b.actor !== undefined && !sameActor_(b.actor, me)) return res_(409, { error: 'actor_mismatch' });
  if (type === 'tick' && (b.v !== 2 || !sameActor_(b.actor, me))) return res_(409, { error: 'update_required' });
  return withLock_(function () {
    var feed = readJson_('feed.json', []);
    var duplicate = feed.filter(function (f) { return f.id === id; })[0];
    if (duplicate) return sameActor_(duplicate.who, me) ? res_(200, { ok: true, dup: true }) : res_(409, { error: 'event_id_conflict' });
    var text = clean_(b.text, 400), goalIndex = -1, progress = null;
    var source = b.source === 'game' ? 'game' : 'manual';
    if (type === 'tick') {
      var generation = GOAL_CATALOG_.filter(function (g) { return g.n === gen; })[0];
      var goals = generation ? trackGoals_(generation) : [];
      goalIndex = goals.findIndex(function (g) { return g.t === b.goal; });
      if (goalIndex < 0 || ['manual', 'game'].indexOf(b.source) < 0) return res_(400, { error: 'bad_goal' });
      progress = cleanProgress_(readJson_('prog__' + safe_(me) + '.json', null));
      var state = progress && progress.gens && progress.gens[gen], complete = false;
      if (source === 'manual') complete = !!state && (state.ticks || []).indexOf(goalIndex) >= 0;
      else if (state) {
        var roster = {}; roster[safe_(me)] = me;
        var records = syncFor_(roster, {}).recs.map(function (r) { return r.rec; }).sort(function (a, b) { return b.at - a.at; });
        complete = gameGoalSet_(progress, records, gen).has(goalIndex);
      }
      if (!complete) return res_(409, { error: 'stale_tick' });
      text = 'ticked “' + goals[goalIndex].t + '”' + (source === 'game' ? ' 🎮 from the game' : '');
    }
    var receivedAt = Date.now(), occurredAt = Number(b.at);
    var validTime = Number.isSafeInteger(occurredAt) && occurredAt >= 946684800000 && occurredAt <= receivedAt + 300000;
    var event = { id: id, at: validTime ? occurredAt : receivedAt, receivedAt: receivedAt,
      timeBasis: validTime ? 'client' : 'received', who: me, type: type, gen: gen, text: text,
      source: source, schemaVersion: 2 };
    if (type === 'tick') {
      event.goal = b.goal; event.goalIndex = goalIndex;
      event.progressRevision = Number(progress._revision) || 0;
      event.goalRules = GOAL_RULES_VERSION_;
    }
    feed.push(event);
    writeJson_('feed.json', feed.slice(-300));
    feedAs_(me, voiceEvent_(me, type, text, gen));
    if (['post', 'heir', 'finish', 'start'].indexOf(type) >= 0) inboxOthers_(me, me + ': ' + text.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim());
    return res_(200, { ok: true });
  });
}
