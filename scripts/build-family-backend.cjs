// Builds a private candidate from an owner-supplied backend; never modifies its input.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), crypto=require('node:crypto');
const marker="      case 'portrait': return portraitAction_(me, body);";
function build(source){
 if (/\bfamilyRead_\b|case\s+['"]family_read['"]/.test(source)) throw Error('family patch already present or conflicting');
 const at=source.indexOf(marker); if(at<0||source.indexOf(marker,at+marker.length)>=0)throw Error('family route marker must occur exactly once');
 const root=path.join(__dirname,'..'); const engine=fs.readFileSync(path.join(root,'family-engine.js'),'utf8'), edits=fs.readFileSync(path.join(root,'gas','FamilyEdits.gs'),'utf8');
 const known="function portraitKnownSim_(sn, owner, id) {"; if(source.indexOf(known)<0||source.indexOf(known)!==source.lastIndexOf(known))throw Error('portrait marker must occur exactly once');
 // Match line endings in each affected source region, including mixed-EOL inputs.
 // Only replace the matched spans; never normalize the surrounding private backend.
 function lineEndingAt(text,index){const next=text.indexOf('\n',index);return next>=0&&next>0&&text[next-1]==='\r'?'\r\n':'\n';}
 source=source.replace(known,known+lineEndingAt(source,source.indexOf(known))+"  var pc = familyPortraitContext_(sn), graph = familyGraph_(owner, pc.owner, familyState_(pc.owner, pc.scope)); return !!graph.sims[id] && !graph.sims[id].missing;");
 function once(oldValue,newValue){
  const pattern=oldValue.split('\n').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\r?\n');
  const re=new RegExp(pattern,'g'), matches=[...source.matchAll(re)];
  if(matches.length!==1)throw Error('portrait alias marker must occur exactly once');
  const match=matches[0], eol=(match[0].match(/\r?\n/)||[])[0]||lineEndingAt(source,match.index);
  source=source.slice(0,match.index)+newValue.replace(/\n/g,eol)+source.slice(match.index+match[0].length);
 }
 once("  owner = roster[sn];\n  if (action === 'list')", "  owner = roster[sn];\n  var portraitOwnerSn = sn, portraitScope = familyScope_(sn).active; if (!portraitScope) return res_(409, { error: 'scope_unbound' }); if (typeof familyCaptureState_ === 'function' && body.scope !== portraitScope) return res_(409, { error: 'scope_conflict', scope: portraitScope }); sn = familyPortraitStoreKey_(sn, portraitScope);\n  if (action === 'list')");
 once("if (action === 'list') return res_(200, { portraits: portraitIndex_(sn) });", "if (action === 'list') return withLock_(function () { if (familyScope_(portraitOwnerSn).active !== portraitScope) return res_(409, { error: 'scope_conflict' }); return res_(200, { portraits: familyPortraitIndex_(sn) }); });");
 once("  return withLock_(function () {\n    var index = portraitIndex_(sn), pos = index.findIndex", "  return withLock_(function () {\n    if (familyScope_(portraitOwnerSn).active !== portraitScope) return res_(409, { error: 'scope_conflict' });\n    var index = portraitIndex_(sn), pos = index.findIndex");
 once("  if (action === 'get') {\n    var found = readJson_(imageName, null);\n    return found && portraitImageValid_(found.image) && Number.isSafeInteger(found.at) && found.at > 0 ? res_(200, { image: found.image, at: found.at }) : res_(404, { error: 'not_found' });\n  }", "  if (action === 'get') return withLock_(function () { if (familyScope_(portraitOwnerSn).active !== portraitScope) return res_(409, { error: 'scope_conflict' }); var found = familyPortraitResolved_(sn, id, readJson_(imageName, null)); return found && portraitImageValid_(found.image) && Number.isSafeInteger(found.at) && found.at > 0 ? res_(200, { image: found.image, at: found.at }) : res_(404, { error: 'not_found' }); });");
 once("    var oldAt = old ? old.at : 0;", "    var targetRecord = old, targetAt = old ? old.at : 0, alias = familyPortraitAlias_(sn, id); if (action === 'remove' && alias) return res_(409, { error: 'portrait_alias' }); old = familyPortraitResolved_(sn, id, old); var oldAt = old ? old.at : 0;");
 once("    if (!duplicate && body.ifAt !== oldAt) return res_(409, { error: 'portrait_conflict', at: oldAt });", "    if (duplicate && old !== targetRecord) return res_(200, { ok: true, at: oldAt, dup: true });\n    if (!duplicate && body.ifAt !== oldAt) return res_(409, { error: 'portrait_conflict', at: oldAt });");
 once("at = Math.max(Date.now(), oldAt + 1, clock + 1);", "at = Math.max(Date.now(), oldAt + 1, targetAt + 1, clock + 1);");
 const alias=fs.readFileSync(path.join(root,'gas','FamilyPortraitAliases.gs'),'utf8');
 const route=source.indexOf(marker);
 const eol=lineEndingAt(source,route);
 const out=source.slice(0,route)+marker+eol+"      case 'family_read': return familyRead_(me, body);"+eol+"      case 'family_audit': return familyAudit_(me);"+eol+"      case 'family_edit': return familyEdit_(me, body);"+source.slice(route+marker.length)+'\n'+engine+'\n'+edits+'\n'+alias+'\n'; new vm.Script(out); return out;
}
module.exports={build,marker};
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('usage: node scripts/build-family-backend.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');const src=fs.readFileSync(input,'utf8'),out=build(src),hash=x=>crypto.createHash('sha256').update(x).digest('hex');fs.writeFileSync(output,out,{mode:0o600});console.log(JSON.stringify({inputSha256:hash(src),outputSha256:hash(out)}));}
