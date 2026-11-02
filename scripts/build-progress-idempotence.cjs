// Incremental private-bundle patch: require the exact previously deployed save function.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const deployed = "function saveProgress_(me, b) {\n  if (!plainJson_(b, MAX_PROGRESS, true)) return res_(400, { error: 'bad_json' });\n  if (!plainObj_(b.gens) || !(Number(b.current) >= 1 && Number(b.current) <= 20)) return res_(400, { error: 'bad_progress' });\n  var baseRevision = b._revision === undefined ? 0 : b._revision;\n  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) return res_(400, { error: 'bad_progress' });\n  if (!sameActor_(b.name, me)) return res_(409, { error: 'actor_mismatch' });\n  return withLock_(function () {\n    var name = 'prog__' + safe_(me) + '.json', previous = readJson_(name, null);\n    var previousRevision = previous && Number.isSafeInteger(previous._revision) && previous._revision >= 0 ? previous._revision : 0;\n    if (baseRevision !== previousRevision) {\n      var canonical = previous ? cleanProgress_(previous) : null;\n      if (canonical) { canonical.name = me; canonical._revision = previousRevision; }\n      return res_(409, { error: 'progress_conflict', progress: canonical });\n    }\n    var progress = cleanProgress_(b);\n    progress.name = me;\n    progress._revision = previousRevision + 1;\n    writeJson_(name, progress);\n    return res_(200, { ok: true, revision: progress._revision });\n  });\n}\n";
function build(source) {
  if (/\b(?:progressStableJson_|progressEquivalent_)\b/.test(source)) throw Error('idempotence patch already present or conflicting');
  if ((source.match(/function\s+saveProgress_\s*\(/g) || []).length !== 1) throw Error('expected exactly one saveProgress function');
  const first = source.indexOf(deployed);
  if (first < 0 || source.indexOf(deployed, first + deployed.length) >= 0) throw Error('deployed saveProgress marker missing or duplicated');
  const module = fs.readFileSync(path.join(__dirname, '..', 'gas', 'GoalEvents.gs'), 'utf8');
  const start = module.indexOf('// Compare JSON values without treating object key order as a change.');
  const end = module.indexOf('function addEvent_(', start);
  if (start < 0 || end < 0) throw Error('idempotence module markers missing');
  const output = source.slice(0, first) + module.slice(start, end) + source.slice(first + deployed.length);
  new vm.Script(output, {filename:'progress-idempotence-candidate.gs'});
  return output;
}
module.exports = { build, deployed };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('usage: node scripts/build-progress-idempotence.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');
  const source = fs.readFileSync(input, 'utf8'), result = build(source);
  fs.writeFileSync(output, result, {mode:0o600});
  const hash = value => createHash('sha256').update(value).digest('hex');
  console.log(JSON.stringify({inputSha256:hash(source), outputSha256:hash(result)}));
}
