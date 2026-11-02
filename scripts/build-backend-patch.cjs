// Patch an owner-provided private bundle locally. Never commit the input/output.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const digest = text => createHash('sha256').update(text).digest('hex');

function rulesSource(page) {
  function section(start, end) {
    const a = page.indexOf(start), b = page.indexOf(end, a);
    if (a < 0 || b < 0) throw Error('missing goal rules section: ' + start);
    return page.slice(a, b);
  }
  const catalog = vm.runInNewContext(section('const GENS=', 'const PCOLORS=') + '\nGENS.map(({n,skills,asp,goals})=>({n,skills,asp,goals}));');
  const track = section('function trackGoals(', '/* ---------- game sync:').trim();
  const normalise = section('const norm=', 'const AGE=');
  const selection = section('function matchName(', '// Sims to tap:');
  const auto = section('function autoGoals(', 'function doneSet(');
  const state = section('function genState(', 'function ticksDone(');
  const shared = [normalise, selection, auto, state].join('\n');
  const version = digest(JSON.stringify(catalog) + track + shared).slice(0, 16);
  return 'var GOAL_CATALOG_ = ' + JSON.stringify(catalog) + ';\n' +
    'var GOAL_RULES_VERSION_ = ' + JSON.stringify(version) + ';\n' +
    track.replace('function trackGoals(', 'function trackGoals_(') + '\n' +
    'function gameGoalSet_(p, records, n) {\n' +
    'const GENS=GOAL_CATALOG_, G=n=>GENS.find(g=>g.n===n);\n' +
    'const prog=()=>p, syncList=()=>records;\n' + shared +
    '\nreturn autoGoals(p.name,n);\n}\n';
}

function build(source, page = fs.readFileSync(path.join(root, 'index.html'), 'utf8')) {
  const module = fs.readFileSync(path.join(root, 'gas', 'GoalEvents.gs'), 'utf8');
  const rules = rulesSource(page);
  const start = source.includes('var GOAL_CATALOG_ = ') ? source.indexOf('var GOAL_CATALOG_ = ') : source.indexOf('function saveProgress_(me, b) {');
  const end = source.indexOf('function addReact_(', start);
  if (start < 0 || end < 0) throw Error('private bundle does not match the expected progress/event section');
  let output = source.slice(0, start) + rules + module + '\n' + source.slice(end);
  const whoami = "case 'whoami': return res_(200, { name: me });";
  const versioned = "case 'whoami': return res_(200, { name: me, syncVersion: 2, goalRules: GOAL_RULES_VERSION_ });";
  if (!output.includes(whoami) && !output.includes(versioned)) throw Error('private bundle is missing the expected whoami route');
  output = output.replace(whoami, versioned);
  new vm.Script(output, { filename: 'candidate.gs' });
  return output;
}

module.exports = { build, rulesSource };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('usage: node scripts/build-backend-patch.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');
  const source = fs.readFileSync(input, 'utf8'), result = build(source);
  fs.writeFileSync(output, result, { mode: 0o600 });
  console.log(JSON.stringify({ inputSha256: digest(source), outputSha256: digest(result), output }));
}
