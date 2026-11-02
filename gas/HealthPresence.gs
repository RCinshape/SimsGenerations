// Ephemeral app-poll evidence. Cache entries may disappear before their TTL.
var APP_PRESENCE_WINDOW_MS_ = 90000;
var APP_PRESENCE_TTL_SECONDS_ = 300;
function appPresenceKey_(actor) {
  var key = safe_(actor);
  return key ? 'app_presence_' + key : '';
}
function recordAppPresence_(actor) {
  try {
    var key = appPresenceKey_(actor);
    if (key) CacheService.getScriptCache().put(key, String(Date.now()), APP_PRESENCE_TTL_SECONDS_);
  } catch (e) {} // A cache outage must not affect app polling.
}
function readAppPresence_(actor, now) {
  try {
    var key = appPresenceKey_(actor);
    if (!key) return 0;
    var raw = CacheService.getScriptCache().get(key);
    if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return 0;
    var at = Number(raw);
    return isFinite(at) && at > 0 && Math.floor(at) === at && at <= now ? at : 0;
  } catch (e) { return 0; }
}
