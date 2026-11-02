// Apply to an owner-provided private bundle locally; never commit the bundle.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const hash = text => createHash('sha256').update(text).digest('hex');

function replaceOnce(source, marker, replacement, label) {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) throw Error(label + ' marker must occur exactly once');
  return source.slice(0, first) + replacement + source.slice(first + marker.length);
}
function build(source) {
  const module = fs.readFileSync(path.join(__dirname, '..', 'gas', 'HealthPresence.gs'), 'utf8');
  if (/\b(?:APP_PRESENCE_WINDOW_MS_|recordAppPresence_|readAppPresence_)\b/.test(source)) throw Error('presence patch already present or conflicting');
  if ((source.match(/case\s+['"]live['"]\s*:/g) || []).length !== 1) throw Error('expected exactly one live route');
  if ((source.match(/function\s+healthData_\s*\(/g) || []).length !== 1) throw Error('expected exactly one healthData function');
  let result = replaceOnce(source,
    "case 'live': return res_(200, live_(me, body && body.have));",
    "case 'live': r = live_(me, body && body.have); recordAppPresence_(me); return res_(200, r);", 'live route');
  result = replaceOnce(result,
    'function healthData_() {\n  var roster = roster_(), out = [];',
    'function healthData_() {\n  var now = Date.now(), roster = roster_(), out = [];', 'health config');
  result = replaceOnce(result,
    'out.push({ name: roster[sn], picks:',
    'out.push({ name: roster[sn], appSeenAt: readAppPresence_(sn, now), picks:', 'health player');
  result = replaceOnce(result,
    'return { now: Date.now(), players: out, host:',
    'return { now: now, appPresenceWindowMs: APP_PRESENCE_WINDOW_MS_, players: out, host:', 'health response');
  result += '\n' + module + '\n';
  new vm.Script(result, { filename: 'health-presence-candidate.gs' });
  return result;
}
module.exports = { build };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('usage: node scripts/build-health-presence.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');
  const source = fs.readFileSync(input, 'utf8'), result = build(source);
  fs.writeFileSync(output, result, { mode: 0o600 });
  console.log(JSON.stringify({ inputSha256: hash(source), outputSha256: hash(result) }));
}
