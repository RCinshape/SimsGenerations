// Alias records are created only by reviewed same-owner merges under the family edit lock.
function familyPortraitAlias_(sn,id) {
  var c=familyPortraitContext_(sn),a=familyState_(c.owner,c.scope).portraitAliases[id];
  if(!a||!FamilyEngine.validId(id)||id.indexOf('manual-')===0||!FamilyEngine.validId(a.source)||a.source.indexOf('manual-')!==0||!Number.isSafeInteger(a.targetAt)||a.targetAt<0)return null;
  return a;
}
function familyPortraitResolved_(sn,id,target) {
  var a=familyPortraitAlias_(sn,id);
  if(!a || (target && target.at!==a.targetAt))return target;
  var source=readJson_('portrait__'+sn+'__'+a.source+'.json',null);
  return source&&portraitImageValid_(source.image)&&Number.isSafeInteger(source.at)&&source.at>0?source:target;
}
function familyPortraitIndex_(sn) {
  var index=portraitIndex_(sn), byId=Object.create(null);index.forEach(function(x){byId[x.simId]=x;});
  var c=familyPortraitContext_(sn), aliases=familyState_(c.owner,c.scope).portraitAliases;
  Object.keys(aliases).sort().forEach(function(id){var a=familyPortraitAlias_(sn,id), own=byId[id];if(!a)return;var found=familyPortraitResolved_(sn,id,own?readJson_('portrait__'+sn+'__'+id+'.json',null):null);if(!found||!Number.isSafeInteger(found.at)||found.at<=0)return;if(own)own.at=found.at;else index.push({simId:id,at:found.at});});
  return index;
}
// Legacy storage names are unchanged. New streams use a disjoint owner + stream namespace.
function familyPortraitStoreKey_(sn,scope) {
  if(typeof sn!=='string'||!/^[a-z0-9-]{1,30}$/.test(sn))throw Error('invalid portrait owner');
  if(scope==='legacy')return sn;
  if(typeof scope!=='string'||!/^[0-9a-f]{32}$/.test(scope))throw Error('invalid portrait scope');
  return sn+'__scope__'+scope;
}
function familyPortraitContext_(key) {
  var m=/^([a-z0-9-]{1,30})__scope__([0-9a-f]{32})$/.exec(key);
  if(m)return {owner:m[1],scope:m[2]};
  if(/^[a-z0-9-]{1,30}$/.test(key))return {owner:key,scope:'legacy'};
  throw Error('invalid portrait storage key');
}
