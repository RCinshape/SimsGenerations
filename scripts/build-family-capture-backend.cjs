// Add conservative collector capability metadata to a private backend candidate.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const marker='    lifeEvents: cleanLifeEvents_(d.lifeEvents),\n    sims: Array.isArray(d.sims)';
const replacement="    lifeEvents: cleanLifeEvents_(d.lifeEvents),\n    familyCapture: cleanFamilyCapture_(d.familyCapture),\n    familyRelationships: cleanFamilyRelationships_(d.familyRelationships),\n    sims: Array.isArray(d.sims)";
const helper=`\n// Sequence orders transport within one local journal, never saves or other devices.\nfunction cleanFamilyCapture_(x) {\n  if (!plainObj_(x) || x.schema !== 1 || x.source !== 'game-genealogy') return null;\n  var o = { schema: 1, source: 'game-genealogy', completeness: 'partial',\n    saveIdentity: 'unverified', captureOrder: 'unverified',\n    capabilities: { parentLinks: 'reported', household: 'reported', romantic: 'spouse-only', parentRoles: 'unknown' } };\n  if (/^[0-9a-f]{32}$/.test(x.streamId || '') && /^[0-9a-f]{32}$/.test(x.captureId || '') && Number.isSafeInteger(x.sequence) && x.sequence > 0) {\n    o.streamId=x.streamId; o.captureId=x.captureId; o.sequence=x.sequence;\n  }\n  return o;\n}\nfunction cleanFamilyObservation_(x) {\n  if (!plainObj_(x)) return null;\n  var states=['unknown','partial','observed'];\n  return {parents:states.indexOf(x.parents)>=0?x.parents:'unknown', children:states.indexOf(x.children)>=0?x.children:'unknown'};\n}\nfunction cleanFamilyRelationships_(a) {\n  if(!Array.isArray(a))return [];\n  var out=[];a.slice(0,128).forEach(function(x){\n    if(!plainObj_(x)||typeof x.a!=='string'||typeof x.b!=='string'||!/^\\d{1,24}$/.test(x.a)||!/^\\d{1,24}$/.test(x.b)||x.a===x.b||!Array.isArray(x.flags))return;\n    var flags=['spouse','fiance','steady'].filter(function(f){return x.flags.indexOf(f)>=0;});\n    if(flags.length)out.push({a:x.a,b:x.b,flags:flags});\n  });return out;\n}\n`;
function build(source) {
  if (/\bcleanFamilyCapture_\b/.test(source)) throw Error('family capture patch already present');
  const at=source.indexOf(marker);
  if(at<0 || source.indexOf(marker,at+marker.length)>=0) throw Error('snapshot cleaner marker must occur exactly once');
  let result=source.slice(0,at)+replacement+source.slice(at+marker.length);
  const simMarker="  if (x.life !== undefined) s.life = cleanLife_(x.life);";
  const simAt=result.indexOf(simMarker);
  if (simAt<0 || result.indexOf(simMarker,simAt+simMarker.length)>=0) throw Error('sim cleaner marker must occur exactly once');
  result=result.slice(0,simAt)+"  if (x.familyObservation !== undefined) s.familyObservation = cleanFamilyObservation_(x.familyObservation);\n"+result.slice(simAt);
  function once(before,after){const i=result.indexOf(before);if(i<0||result.indexOf(before,i+before.length)>=0)throw Error('family capture integration marker must occur exactly once: '+before);result=result.slice(0,i)+after+result.slice(i+before.length);}
  const route="      case 'portrait': return portraitAction_(me, body);";
  once(route,route+"\n      case 'family_capture_state': return familyCaptureStateAction_(me, body);\n      case 'family_capture_bind': return familyCaptureBind_(me, body);");
  once('  var now = Date.now(), same = false, wasSeen = false, lastErr = null, news = [];',
       '  var now = Date.now(), same = false, wasSeen = false, lastErr = null, news = [], familyResult = null;');
  const snapIf="    if (snap !== null && !(hh === 'none' && parsed.v === 0)) {";
  once(snapIf,snapIf+"\n      familyResult = familyCaptureAccept_(sn, parsed, hh, now, b.s, meta);\n      if (familyResult.handled) {\n        if (familyResult.status === 'accepted') {\n          try { news = newNews_(sn, real, gameNews_(real, familyResult.previous || null, parsed)); } catch (x) { hostLog_('news: ' + x); }\n        }\n        if (familyResult.status === 'accepted' || familyResult.status === 'pending_review') seen.snapAt = now;\n        if (familyResult.status === 'duplicate') same = true;\n      } else {");
  once("    } else if (snap !== null) {\n      seen.meta = meta;", "      }\n    } else if (snap !== null) {\n      seen.meta = meta;");
  once("  var ans = same ? { ok: true, same: true } : { ok: true };", "  var ans = same ? { ok: true, same: true } : { ok: true };\n  if (familyResult && familyResult.handled) ans.familyCapture = familyResult.status;");
  const syncHead="  Object.keys(roster).forEach(function (sn) {\n    var idx = prop_('sx_' + sn) || {}, name = roster[sn];";
  once(syncHead,"  Object.keys(roster).forEach(function (sn) {\n    var sourceState=familyCaptureStateRaw_(sn), selected=familyCaptureRead_(sn), name=roster[sn];\n    if (selected && selected.scope !== 'legacy') {\n      selected.sync.forEach(function(item) { var k=String(name).toLowerCase().trim()+'|'+item.hh, at=Math.max(item.at||0,sourceState.boundAt||0); keys.push(k); if(have[k]!==at) recs.push({name:name,rec:{at:at,hh:item.hh,m:item.meta||{},data:item.data}}); });\n      return;\n    }\n    var idx = prop_('sx_' + sn) || {};\n    if (selected && selected.scope === 'legacy') Object.keys(idx).forEach(function(hh){idx[hh]=Math.max(idx[hh]||0,sourceState.boundAt||0);});");
  const famStart="    var at = Number(props_().getProperty('fx_' + sn) || 0);";
  once(famStart,"    var sourceState=familyCaptureStateRaw_(sn), selected=familyCaptureRead_(sn);\n    if (selected && selected.scope !== 'legacy') {\n      var key='fam|'+String(roster[sn]).toLowerCase().trim(), at=Math.max(Number(selected.family.at)||0,Number(sourceState.boundAt)||0);\n      if(at){famKeys.push(key);if(!have||have[key]!==at)fams.push({name:roster[sn],at:at,sims:selected.family.sims||{}});}return;\n    }\n    var at = Number(props_().getProperty('fx_' + sn) || 0);\n    if(selected&&selected.scope==='legacy')at=Math.max(at,Number(sourceState.boundAt)||0);");
  const exportOld="    var idx = prop_('sx_' + sn) || {};\n    Object.keys(idx).forEach(function (hh) { var r = readJson_('sync__' + sn + '__' + hh + '.json', null); if (r) game.push({ name: roster[sn], hh: hh, at: r.at, data: JSON.parse(r.s) }); });";
  once(exportOld,"    syncFor_((function(){var r={};r[sn]=roster[sn];return r;})(),{}).recs.forEach(function(x){game.push({name:x.name,hh:x.rec.hh,at:x.rec.at,data:x.rec.data});});");
  const health="    var seen = prop_('seen_' + sn) || {}, idx = prop_('sx_' + sn) || {}, log = readJson_('log__' + sn + '.json', { lines: [] });";
  once(health,health+"\n    var selected=familyCaptureRead_(sn);if(selected&&selected.scope!=='legacy'){idx={};selected.sync.forEach(function(x){idx[x.hh]=x.at;});}");
  result += helper + '\n' + fs.readFileSync(path.join(__dirname,'..','gas','FamilyCapture.gs'),'utf8');
  new vm.Script(result,{filename:'family-capture-candidate.gs'});return result;
}
module.exports={build};
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('usage: node scripts/build-family-capture-backend.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');fs.writeFileSync(output,build(fs.readFileSync(input,'utf8')),{mode:0o600});}
