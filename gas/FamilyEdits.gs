/* Owner edits are a separate overlay. Existing family, sync and portrait files are not rewritten. */
var FAMILY_FIELDS_ = ['first','last','age','gender','dead','occ','kind','traits','aspiration','skills','career','notes','hidden'];
function familyScope_(sn) {
  if(typeof familyCaptureState_!=='function')return {revision:0,active:'legacy',choices:[],legacyAvailable:true};
  return familyCaptureState_(sn);
}
function familyState_(sn,scope) {
  scope=scope===undefined?familyScope_(sn).active:scope;
  var suffix=scope&&scope!=='legacy'?'__'+scope:'';
  var v=readJson_('family-edits__'+sn+suffix+'.json',null);
  v=v || {revision:0,fields:{},manual:{},links:{},history:[]}; if(!v.portraitAliases)v.portraitAliases={}; return v;
}
function familyGraph_(owner,sn,state) {
  var capture=typeof familyCaptureRead_==='function'?familyCaptureRead_(sn):null;
  if(capture)return FamilyEngine.normalize({owner:owner,scope:capture.scope==='legacy'?'legacy-owner-unverified-save':'collector-stream-unverified-save',family:capture.family||{},sync:capture.sync||[],edits:state});
  var idx=prop_('sx_'+sn)||{}, sync=[];
  Object.keys(idx).sort().forEach(function(hh){var r=readJson_('sync__'+sn+'__'+hh+'.json',null);if(!r)return;try{var d=JSON.parse(r.s);if(!d.familyCapture||!d.familyCapture.streamId)sync.push({at:r.at,hh:hh,data:d});}catch(e){}});
  return FamilyEngine.normalize({owner:owner,family:readJson_('fam__'+sn+'.json',null)||{},sync:sync,edits:state});
}
function familyOwner_(me,body) {
  var roster=roster_(), owner=body && body.owner, sn=typeof owner==='string'?safe_(owner):'';
  if(!sn||!Object.prototype.hasOwnProperty.call(roster,sn)||!sameActor_(roster[sn],owner)||(!isTester_(me)&&isTester_(sn)))return null;
  return {owner:roster[sn],sn:sn};
}
function familyRead_(me,body) {
  var o=familyOwner_(me,body);if(!o)return res_(404,{error:'not_found'});
  return withLock_(function(){var scope=familyScope_(o.sn),state=familyState_(o.sn,scope.active);return res_(200,{graph:familyGraph_(o.owner,o.sn,state),scope:scope.active,captureState:scope,canEdit:!!scope.active,revision:state.revision,edits:{fields:state.fields,manual:state.manual,links:state.links,portraitAliases:state.portraitAliases}});});
}
function familyCleanFields_(fields) {
  if(!fields||typeof fields!=='object'||Array.isArray(fields))return null;
  var out={}, keys=Object.keys(fields); if(!keys.length||keys.length>FAMILY_FIELDS_.length)return null;
  for(var i=0;i<keys.length;i++){var k=keys[i],v=fields[k];if(FAMILY_FIELDS_.indexOf(k)<0)return null;
    if(k==='dead'||k==='hidden'){if(typeof v!=='boolean')return null;}
    else if(k==='occ'||k==='traits'){if(!Array.isArray(v)||v.length>40||v.some(function(x){return typeof x!=='string'||x.length>80;}))return null;}
    else if(k==='skills'||k==='career'||k==='aspiration'){if(!plainJson_(v,5000,false))return null;}
    else if(typeof v!=='string'||v.length>(k==='notes'?2000:100))return null;
    out[k]=v;
  }return out;
}
function familyEdit_(me,body) {
  var o=familyOwner_(me,body);if(!o)return res_(404,{error:'not_found'});if(!sameActor_(me,o.owner))return res_(403,{error:'forbidden'});
  if(!body||!Number.isSafeInteger(body.revision)||body.revision<0||!body.op||typeof body.op!=='object'||Array.isArray(body.op))return res_(400,{error:'bad_edit'});
  return withLock_(function(){
    var currentScope=familyScope_(o.sn).active;if(!currentScope)return res_(409,{error:'scope_unbound'});if(typeof familyCaptureState_==='function'&&body.scope!==currentScope)return res_(409,{error:'scope_conflict',scope:currentScope});var s=familyState_(o.sn,currentScope);if(s.revision!==body.revision)return res_(409,{error:'family_conflict',revision:s.revision});
    var before=JSON.stringify({fields:s.fields,manual:s.manual,links:s.links,portraitAliases:s.portraitAliases}), op=body.op, graph=familyGraph_(o.owner,o.sn,s), id=op.id, f,k,e;
    if(op.type==='undo') {if(!s.history.length)return res_(400,{error:'bad_edit'});var prior=s.history.pop();s.fields=prior.fields;s.manual=prior.manual;s.links=prior.links;s.portraitAliases=prior.portraitAliases||{};}
    else if(op.type==='add_sim') {f=familyCleanFields_(op.fields);if(!FamilyEngine.validId(id)||id.indexOf('manual-')!==0||graph.sims[id]||Object.keys(s.portraitAliases).some(function(x){return s.portraitAliases[x].source===id;})||!f)return res_(400,{error:'bad_edit'});s.manual[id]=f;}
    else if(op.type==='set_fields') {f=familyCleanFields_(op.fields);if(!FamilyEngine.validId(id)||!graph.sims[id]||!f)return res_(400,{error:'bad_edit'});s.fields[id]=s.fields[id]||{};Object.keys(f).forEach(function(x){s.fields[id][x]=f[x];});}
    else if(op.type==='reset_fields') {if(!FamilyEngine.validId(id)||!graph.sims[id]||!Array.isArray(op.fields)||!op.fields.length||op.fields.some(function(x){return FAMILY_FIELDS_.indexOf(x)<0;}))return res_(400,{error:'bad_edit'});op.fields.forEach(function(x){if(s.fields[id])delete s.fields[id][x];});}
    else if(op.type==='link_manual') {
      var target=op.targetId;if(!s.manual[id]||!FamilyEngine.validId(target)||target.indexOf('manual-')===0||!graph.sims[target]||graph.sims[target].missing)return res_(400,{error:'bad_edit'});
      var combined={}, m=s.manual[id], mf=s.fields[id]||{}, tf=s.fields[target]||{};
      Object.keys(m).forEach(function(x){combined[x]=m[x];});Object.keys(mf).forEach(function(x){combined[x]=mf[x];});
      if(Object.keys(combined).some(function(x){return Object.prototype.hasOwnProperty.call(tf,x)&&JSON.stringify(tf[x])!==JSON.stringify(combined[x]);}))return res_(409,{error:'merge_conflict',part:'fields'});
      Object.keys(combined).forEach(function(x){tf[x]=combined[x];});s.fields[target]=tf;delete s.fields[id];delete s.manual[id];
      var newLinks={}, conflict=false;
      Object.keys(s.links).sort().forEach(function(x){var link=s.links[x], copy={};Object.keys(link).forEach(function(y){copy[y]=link[y];});if(copy.a===id)copy.a=target;if(copy.b===id)copy.b=target;if(copy.a===copy.b){conflict=true;return;}var nk=FamilyEngine.linkKey(copy.type,copy.a,copy.b);if(newLinks[nk]&&JSON.stringify(newLinks[nk])!==JSON.stringify(copy))conflict=true;newLinks[nk]=copy;});
      if(conflict)return res_(409,{error:'merge_conflict',part:'links'});s.links=newLinks;
      var oldIssues={};graph.issues.forEach(function(x){if(x.type==='cycle')oldIssues[FamilyEngine.linkKey('parent',x.edge.a,x.edge.b)]=true;});
      if(familyGraph_(o.owner,o.sn,s).issues.some(function(x){return x.type==='cycle'&&!oldIssues[FamilyEngine.linkKey('parent',x.edge.a,x.edge.b)];}))return res_(409,{error:'merge_conflict',part:'links'});
      var photoKey=typeof familyPortraitStoreKey_==='function'?familyPortraitStoreKey_(o.sn,currentScope):o.sn,mp=readJson_('portrait__'+photoKey+'__'+id+'.json',null),rawTp=readJson_('portrait__'+photoKey+'__'+target+'.json',null),tp=typeof familyPortraitResolved_==='function'?familyPortraitResolved_(photoKey,target,rawTp):rawTp;
      if(mp&&tp&&mp.image!==tp.image&&['manual','game'].indexOf(op.portraitChoice)<0)return res_(409,{error:'merge_conflict',part:'portrait'});
      if(mp&&(!tp||op.portraitChoice==='manual'))s.portraitAliases[target]={source:id,targetAt:rawTp?rawTp.at:0};
    }
    else if(op.type==='clear_portrait_alias') {if(!FamilyEngine.validId(id)||!Object.prototype.hasOwnProperty.call(s.portraitAliases,id))return res_(400,{error:'bad_edit'});delete s.portraitAliases[id];}
    else if(op.type==='remove_sim') {if(!s.manual[id])return res_(400,{error:'bad_edit'});delete s.manual[id];delete s.fields[id];Object.keys(s.links).forEach(function(x){if(s.links[x].a===id||s.links[x].b===id)delete s.links[x];});}
    else if(['add_link','remove_link','reset_link'].indexOf(op.type)>=0) {
      if(['parent','partner','friend'].indexOf(op.linkType)<0||!FamilyEngine.validId(op.a)||!FamilyEngine.validId(op.b)||op.a===op.b||!graph.sims[op.a]||!graph.sims[op.b])return res_(400,{error:'bad_edit'});
      if(op.type==='add_link'&&op.linkType==='parent'&&['biological','adoptive','guardian','unknown'].indexOf(op.role)<0)return res_(400,{error:'bad_edit'});
      if(op.type==='add_link'&&op.linkType==='partner'&&['married','dating','separated','widowed','unknown'].indexOf(op.status)<0)return res_(400,{error:'bad_edit'});
      k=FamilyEngine.linkKey(op.linkType,op.a,op.b);if(op.type==='reset_link')delete s.links[k];else {e={type:op.linkType,a:op.a,b:op.b};if(op.type==='remove_link')e.excluded=true;else {if(op.linkType==='parent')e.role=op.role;if(op.linkType==='partner')e.status=op.status;}s.links[k]=e;}
      if(op.type==='add_link'&&op.linkType==='parent'){var adj={}, seen={};graph.edges.forEach(function(x){if(x.type==='parent'&&FamilyEngine.linkKey('parent',x.a,x.b)!==k)(adj[x.a]||(adj[x.a]=[])).push(x.b);});function reaches(x){if(x===op.a)return true;if(seen[x])return false;seen[x]=true;return (adj[x]||[]).some(reaches);}if(reaches(op.b))return res_(400,{error:'cycle'});}
    } else return res_(400,{error:'bad_edit'});
    if(Object.keys(s.manual).length>500||Object.keys(s.links).length>3000||JSON.stringify(s).length>350000)return res_(400,{error:'limit'});
    if(op.type!=='undo'){s.history.push(JSON.parse(before));if(s.history.length>10)s.history.shift();}
    if(JSON.stringify(s).length>350000)return res_(400,{error:'limit'});
    s.revision++;writeJson_('family-edits__'+o.sn+(currentScope==='legacy'?'':'__'+currentScope)+'.json',s);
    return res_(200,{graph:familyGraph_(o.owner,o.sn,s),scope:currentScope,revision:s.revision,edits:{fields:s.fields,manual:s.manual,links:s.links,portraitAliases:s.portraitAliases}});
  });
}

// A read-only aggregate of existing records; no backfill or migration.
function familyAudit_(me) {
  var roster=roster_(), out=[];Object.keys(roster).sort().forEach(function(sn){if(!isTester_(me)&&isTester_(sn))return;var state=familyState_(sn),g=familyGraph_(roster[sn],sn,state);out.push({owner:roster[sn],simCount:Object.keys(g.sims).length,edgeCount:g.edges.length,issueCount:g.issues.length,partial:g.partial,truncated:g.truncated,scope:g.scope,capture:g.capture,captureReceivedAt:g.captureReceivedAt,revision:state.revision});});
  return res_(200,{trees:out});
}
