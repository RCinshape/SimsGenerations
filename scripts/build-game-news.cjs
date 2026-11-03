// Apply only the news module, sanitizer extensions, and removal of the daily game recap.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
function build(source) {
  if (source.includes('var LIFE_NEWS_KINDS_')) throw Error('game news patch already applied');
  function replaceOnce(before, after) {
    if (source.split(before).length !== 2) throw Error('missing or ambiguous news insertion point: ' + before.slice(0, 70));
    source = source.replace(before, after);
  }
  const start = source.indexOf('/* ===================== News.gs ===================== */');
  const end = source.indexOf('/* ===================== Social.gs ===================== */', start);
  if (start < 0 || end < 0) throw Error('missing news module boundaries');
  source = source.slice(0, start) + '/* ===================== News.gs ===================== */\n' +
    fs.readFileSync(path.join(root, 'gas/GameNews.gs'), 'utf8') + '\n' + source.slice(end);
  replaceOnce("  try { feed_(dailyRecap_()); } catch (e) { hostLog_('recap: ' + e); }", '  // Life news is delivered per event by the relay; only patch notes are aggregated.');
  replaceOnce("  if (plainObj_(x.asp)) s.asp = { n: clean_(x.asp.n, 80), done: x.asp.done === true };",
    "  if (plainObj_(x.asp)) s.asp = { n: clean_(x.asp.n, 80), done: x.asp.done === true };\n" +
    "  s.deadKnown = x.deadKnown !== false && typeof x.dead === 'boolean';\n" +
    "  s.spouseKnown = x.spouseKnown !== false && Object.prototype.hasOwnProperty.call(x, 'spouse') && (x.spouse === null || typeof x.spouse === 'string');\n" +
    "  if (x.life !== undefined) s.life = cleanLife_(x.life);");
  replaceOnce('    sims: Array.isArray(d.sims) ? d.sims.slice(0, 200).map(cleanSim_).filter(Boolean) : [] };',
    '    lifeEvents: cleanLifeEvents_(d.lifeEvents),\n    sims: Array.isArray(d.sims) ? d.sims.slice(0, 200).map(cleanSim_).filter(Boolean) : [] };');
  // Existing relay already sends news.forEach(feedAs_), immediately and individually.
  if (!source.includes('news.forEach(function (e) { feedAs_(real, e.t); });')) throw Error('relay individual delivery path has drifted');
  new vm.Script(source);
  return source;
}
module.exports = { build };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('usage: node scripts/build-game-news.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');
  const source = fs.readFileSync(input, 'utf8'), result = build(source);
  fs.writeFileSync(output, result);
  const sha = s => createHash('sha256').update(s).digest('hex');
  console.log(JSON.stringify({ inputSha256: sha(source), outputSha256: sha(result), output }));
}
