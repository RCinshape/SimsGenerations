/* Isolated observed streams. Caller holds withLock_ during acceptance and binding. */
var FAMILY_STREAM_LIMIT_ = 16, FAMILY_CAPTURE_HISTORY_ = 8;
function familyCaptureStateRaw_(sn) {
  var s=readJson_('family-capture-state__'+sn+'.json',null);
  return s && typeof s==='object' && Array.isArray(s.streams) ? s : {revision:0,active:null,streams:[]};
}
function familyCaptureFile_(sn,id){return 'family-capture__'+sn+'__'+id+'.json';}
function familyCaptureCurrent_(sn,id){return 'family-capture-current__'+sn+'__'+id+'.json';}
function familyCaptureWriteCurrent_(sn,id,rec) {
  var x=rec.latest;
  writeJson_(familyCaptureCurrent_(sn,id),{family:rec.family,latest:{sequence:x.sequence,captureId:x.captureId,receivedAt:x.receivedAt,hh:x.hh,snap:x.snap,meta:x.meta||{}}});
}
function familyCaptureChoice_(id,r) {
  if(!r||!r.latest)return null;
  var snap=r.latest.snap||{}, c=snap.familyCapture||{};
  return {streamId:id,label:'collector stream, save identity unverified',receivedAt:r.latest.receivedAt,
    capturedAt:Number(snap.at)||0,householdName:(snap.household||{}).name||'',simCount:(snap.sims||[]).length,
    sequence:r.latest.sequence,completeness:'partial',capabilities:c.capabilities||{}};
}
function familyCaptureState_(sn) {
  var s=familyCaptureStateRaw_(sn), choices=[];
  s.streams.forEach(function(id){
    var summary=(s.summaries||{})[id]||familyCaptureChoice_(id,readJson_(familyCaptureFile_(sn,id),null));
    if(summary)choices.push(summary);
  });
  choices.sort(function(a,b){return b.receivedAt-a.receivedAt;});
  var legacy=!!readJson_('fam__'+sn+'.json',null)||Object.keys(prop_('sx_'+sn)||{}).length>0;
  return {revision:s.revision,active:s.active,choices:choices,legacyAvailable:legacy};
}
function familyCaptureMerge_(fam,snap,hh,now) {
  fam=fam||{sims:{}}; if(!fam.sims||typeof fam.sims!=='object')fam.sims={};
  var count=Object.keys(fam.sims).length;
  function ids(a,n){return Array.isArray(a)?a.filter(function(x){return typeof x==='string'&&/^\d{1,24}$/.test(x);}).slice(0,n):[];}
  function union(a,b){var out=Array.isArray(a)?a.slice():[];b.forEach(function(x){if(out.indexOf(x)<0)out.push(x);});return out.slice(0,40);}
  (snap.sims||[]).forEach(function(x){
    var id=x.id;if(typeof id!=='string'||!/^\d{1,24}$/.test(id))return;
    if(!Object.prototype.hasOwnProperty.call(fam.sims,id)){if(count>=900){fam.truncated=true;return;}count++;}
    var r=fam.sims[id]||{};r.f=x.first;r.l=x.last;r.a=x.age;r.g=x.gender;
    if(x.deadKnown)r.d=x.dead?1:0;
    if(Array.isArray(x.occults)&&x.occults.length)r.o=x.occults.slice(0,10);
    var obs=x.familyObservation||{};
    if(obs.parents==='observed'){r.p=ids(x.parents,10);r.po='observed';}
    else if(obs.parents==='partial'){r.p=union(r.p,ids(x.parents,10));if(r.po!=='observed')r.po='partial';}
    if(obs.children==='observed'){r.c=ids(x.children,30);r.co='observed';}
    else if(obs.children==='partial'){r.c=union(r.c,ids(x.children,30));if(r.co!=='observed')r.co='partial';}
    if(x.spouseKnown){if(x.spouse){r.s=x.spouse;r.ps=union(r.ps,[x.spouse]);}else delete r.s;}
    if(x.inHousehold)r.h=hh;r.t=now;fam.sims[id]=r;
  });
  fam.relationships=Array.isArray(fam.relationships)?fam.relationships:[];
  (snap.familyRelationships||[]).forEach(function(x){
    var a=x.a,b=x.b;if(a>b){var t=a;a=b;b=t;}
    var old=fam.relationships.filter(function(r){return r.a===a&&r.b===b;})[0];
    if(!old){if(fam.relationships.length>=512){fam.truncated=true;return;}old={a:a,b:b};fam.relationships.push(old);}
    old.flags=x.flags.slice();old.source='game';old.at=now;
  });
  fam.at=now;return fam;
}
function familyCaptureAccept_(sn,snap,hh,now,raw,meta) {
  var st=familyCaptureStateRaw_(sn), c=snap.familyCapture;
  if(!c) return {handled:st.active!==null&&st.active!=='legacy',status:'legacy_not_active'};
  if(!c.streamId||!c.captureId||!c.sequence){
    writeJson_('family-unsequenced__'+sn+'.json',{at:now,snap:snap,raw:typeof raw==='string'?raw:null});
    return {handled:true,status:'unsequenced'};
  }
  var id=c.streamId, found=st.streams.indexOf(id)>=0, name=familyCaptureFile_(sn,id);
  if(!found&&st.streams.length>=FAMILY_STREAM_LIMIT_){
    writeJson_('family-overflow__'+sn+'.json',{at:now,snap:snap,raw:typeof raw==='string'?raw:null});
    return {handled:true,status:'stream_limit'};
  }
  var rec=readJson_(name,null)||{history:[],family:{sims:{}}}, old=rec.latest;
  // A prior write may have succeeded before the state index write failed.
  if(!found&&old){st.streams.push(id);st.revision++;st.summaries=st.summaries||{};st.summaries[id]=familyCaptureChoice_(id,rec);writeJson_('family-capture-state__'+sn+'.json',st);found=true;}
  if((rec.history||[]).some(function(x){return x.captureId===c.captureId;})){
    var current=readJson_(familyCaptureCurrent_(sn,id),null);
    if(!current||!current.latest||current.latest.sequence!==rec.latest.sequence)familyCaptureWriteCurrent_(sn,id,rec);
    var summary=familyCaptureChoice_(id,rec);st.summaries=st.summaries||{};
    if(JSON.stringify(st.summaries[id])!==JSON.stringify(summary)){st.summaries[id]=summary;writeJson_('family-capture-state__'+sn+'.json',st);}
    return {handled:true,status:'duplicate'};
  }
  if(old && c.sequence<=old.sequence){
    return {handled:true,status:'stale'};
  }
  var receivedAt=Math.max(now,old?old.receivedAt+1:0,Number(st.boundAt||0)+1);
  var capture={sequence:c.sequence,captureId:c.captureId,receivedAt:receivedAt,hh:hh,snap:snap,raw:typeof raw==='string'?raw:null,meta:meta||{}};
  rec.family=familyCaptureMerge_(rec.family,snap,hh,receivedAt);
  rec.history=Array.isArray(rec.history)?rec.history:[];
  rec.history.push(capture);if(rec.history.length>FAMILY_CAPTURE_HISTORY_)rec.history=rec.history.slice(-FAMILY_CAPTURE_HISTORY_);
  rec.latest=capture;writeJson_(name,rec);familyCaptureWriteCurrent_(sn,id,rec);
  if(!found){st.streams.push(id);st.revision++;}
  st.summaries=st.summaries||{};st.summaries[id]=familyCaptureChoice_(id,rec);writeJson_('family-capture-state__'+sn+'.json',st);
  return {handled:true,status:st.active===id?'accepted':'pending_review',previous:old&&old.snap};
}
function familyCaptureRead_(sn) {
  var st=familyCaptureStateRaw_(sn), scope=st.active;if(!scope)return null;
  if(scope==='legacy'){
    var idx=prop_('sx_'+sn)||{}, sync=[];
    Object.keys(idx).sort().forEach(function(hh){var r=readJson_('sync__'+sn+'__'+hh+'.json',null);if(r)try{sync.push({at:r.at,hh:hh,data:JSON.parse(r.s)});}catch(e){}});
    return {scope:'legacy',family:readJson_('fam__'+sn+'.json',null)||{},sync:sync};
  }
  var rec=readJson_(familyCaptureCurrent_(sn,scope),null)||readJson_(familyCaptureFile_(sn,scope),null);if(!rec||!rec.latest)return null;
  return {scope:scope,family:rec.family||{},sync:[{at:rec.latest.receivedAt,hh:rec.latest.hh,data:rec.latest.snap,meta:rec.latest.meta||{}}]};
}
function familyCaptureStateAction_(me,body) {
  var o=familyOwner_(me,body);if(!o)return res_(404,{error:'not_found'});
  return res_(200,familyCaptureState_(o.sn));
}
function familyCaptureBind_(me,body) {
  var o=familyOwner_(me,body);if(!o)return res_(404,{error:'not_found'});
  if(!sameActor_(me,o.owner))return res_(403,{error:'forbidden'});
  if(!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.streamId!=='string')return res_(400,{error:'bad_source'});
  return withLock_(function(){
    var s=familyCaptureStateRaw_(o.sn), current=familyCaptureState_(o.sn);
    if(s.revision!==body.revision)return res_(409,{error:'source_conflict',state:current});
    if(body.streamId==='legacy'?!current.legacyAvailable:s.streams.indexOf(body.streamId)<0||!readJson_(familyCaptureFile_(o.sn,body.streamId),null))return res_(400,{error:'bad_source'});
    if(s.active!==body.streamId){
      var watermark=Math.max(Date.now(),Number(s.boundAt||0)+1);
      current.choices.forEach(function(x){watermark=Math.max(watermark,Number(x.receivedAt||0)+1);});
      var idx=prop_('sx_'+o.sn)||{};Object.keys(idx).forEach(function(k){watermark=Math.max(watermark,Number(idx[k]||0)+1);});
      s.bindingHistory=Array.isArray(s.bindingHistory)?s.bindingHistory:[];
      s.bindingHistory.push({from:s.active,to:body.streamId,at:Date.now(),actor:o.owner});
      s.bindingHistory=s.bindingHistory.slice(-20);
      s.active=body.streamId;s.boundAt=watermark;s.revision++;writeJson_('family-capture-state__'+o.sn+'.json',s);
    }
    return res_(200,familyCaptureState_(o.sn));
  });
}
