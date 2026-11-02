// Apply locally to an owner-provided private backend bundle.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const marker = "      case 'installer': return res_(200, installerFile_(me));\n      case 'helper': return res_(200, helperFile_(me));";
function build(source) {
  if (/\bportraitAction_\b|case\s+['"]portrait['"]\s*:/.test(source)) throw Error('portrait patch already present or conflicting');
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) throw Error('portrait route marker must occur exactly once');
  const module = fs.readFileSync(path.join(__dirname,'..','gas','Portraits.gs'),'utf8');
  const output = source.slice(0, first) + marker + "\n      case 'portrait': return portraitAction_(me, body);" + source.slice(first + marker.length) + '\n' + module + '\n';
  new vm.Script(output, {filename:'portrait-candidate.gs'});
  return output;
}
module.exports = { build, marker };
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('usage: node scripts/build-portrait-backend.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');
  const source=fs.readFileSync(input,'utf8'), result=build(source), hash=s=>createHash('sha256').update(s).digest('hex');
  fs.writeFileSync(output,result,{mode:0o600});
  console.log(JSON.stringify({inputSha256:hash(source),outputSha256:hash(result)}));
}
