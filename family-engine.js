/* Shared legacy family adapter. No names, household membership, or partner links imply parenthood. */
var FamilyEngine = (function () {
  'use strict';
  function validId(x) { return typeof x === 'string' && /^(?:[0-9]{1,24}|manual-[A-Za-z0-9_-]{1,33})$/.test(x); }
  function key(t,a,b) { if (t !== 'parent' && a > b) { var x=a; a=b; b=x; } return t+'|'+a+'|'+b; }
  function normalize(input) {
    input=input||{}; var sims=Object.create(null), links=Object.create(null), parentClaims=[], reportedRelationships=[], authoritativeParents=Object.create(null), issues=[], capture=null, captureReceivedAt=0, edits=input.edits||{}, fields=edits.fields||{}, manual=edits.manual||{}, linkEdits=edits.links||{};
    function node(id,missing) { if (!validId(id)) return null; if (!sims[id]) sims[id]={id:id,first:'',last:'',age:'',gender:'',dead:null,occ:[],parents:[],children:[],partners:[],missing:!!missing,edited:[]}; return sims[id]; }
    function claim(t,a,b,extra) { if (!validId(a)||!validId(b)) return; if(a===b){issues.push({type:'self_link',a:a});return;} node(a,true); node(b,true); var k=key(t,a,b); if(!links[k]) links[k]={a:a,b:b,type:t,role:t==='parent'?'unknown':undefined,status:t==='partner'?'unknown':undefined,source:'game'}; if(extra) Object.keys(extra).forEach(function(f){links[k][f]=extra[f];}); }
    function rememberParent(a,b,kind) { if(validId(a)&&validId(b))parentClaims.push({a:a,b:b,kind:kind}); }
    function parentSet(values) { var result=Object.create(null); (Array.isArray(values)?values:[]).forEach(function(id){if(validId(id))result[id]=true;});return result; }
    var family=input.family||{}, raw=family.sims||{};
    (Array.isArray(family.relationships)?family.relationships:[]).forEach(function(e){reportedRelationships.push(e);});
    Object.keys(raw).forEach(function(id){var r=raw[id]||{};if(validId(id)&&r.po==='observed')authoritativeParents[id]=parentSet(r.p);});
    Object.keys(raw).sort().forEach(function(id){var r=raw[id]||{}, n=node(id,false); if(!n)return; n.first=r.f||'';n.last=r.l||'';n.age=r.a||'';n.gender=r.g||'';n.dead=r.d?true:null;n.occ=Array.isArray(r.o)?r.o.slice():[]; n.household=r.h||null; n.missing=false;
      (r.p||[]).forEach(function(p){rememberParent(String(p),id,'child_parents');}); (r.c||[]).forEach(function(c){rememberParent(id,String(c),'parent_children');}); (r.ps||[]).forEach(function(p){claim('partner',id,String(p));}); if(r.s){n.spouse=String(r.s); claim('partner',id,String(r.s),{status:'married'});}
    });
    (input.sync||[]).slice().sort(function(a,b){return ((a.at||0)-(b.at||0)) || (String(a.hh||'')<String(b.hh||'')?-1:String(a.hh||'')>String(b.hh||'')?1:0);}).forEach(function(rec){var data=rec.data||rec; capture=data.familyCapture||null;captureReceivedAt=rec.at||0; (Array.isArray(data.familyRelationships)?data.familyRelationships:[]).forEach(function(e){reportedRelationships.push(e);}); (data.sims||[]).forEach(function(x){if(!x||!validId(x.id))return;var n=node(x.id,false);n.missing=false; ['first','last','age','gender','dead','traits','skills','life'].forEach(function(f){if(x[f]!==undefined && !(f==='dead' && x.deadKnown===false))n[f]=x[f];}); if(x.occults)n.occ=x.occults.slice(); if(x.asp)n.aspiration=x.asp; if(x.careers)n.career=x.careers; if(x.inHousehold)n.household=rec.hh||null;
      var observation=x.familyObservation||{};if(observation.parents==='observed')authoritativeParents[x.id]=parentSet(x.parents);else if(observation.parents==='partial'&&authoritativeParents[x.id])Object.keys(parentSet(x.parents)).forEach(function(p){authoritativeParents[x.id][p]=true;});
      (x.parents||[]).forEach(function(p){rememberParent(String(p),x.id,'child_parents');}); (x.children||[]).forEach(function(c){rememberParent(x.id,String(c),'parent_children');}); if(x.spouse){n.spouse=String(x.spouse);claim('partner',x.id,String(x.spouse),{status:'married'});}
    });});
    reportedRelationships.forEach(function(e){if(!e||!validId(e.a)||!validId(e.b)||e.a===e.b||!Array.isArray(e.flags))return;var flags=e.flags.filter(function(f){return ['spouse','fiance','steady'].indexOf(f)>=0;});if(!flags.length)return;claim('partner',e.a,e.b);var edge=links[key('partner',e.a,e.b)], merged=edge.reportedFlags||[];flags.forEach(function(f){if(merged.indexOf(f)<0)merged.push(f);});edge.reportedFlags=merged.sort();});
    parentClaims.forEach(function(e){var known=authoritativeParents[e.b];if(known&&!known[e.a]){issues.push({type:'parent_conflict',a:e.a,b:e.b,claim:e.kind,reason:'child_complete_parent_observation'});return;}claim('parent',e.a,e.b);});
    Object.keys(manual).sort().forEach(function(id){var n=node(id,false);if(!n)return;n.missing=false;n.manual=true;Object.keys(manual[id]||{}).forEach(function(f){n[f]=manual[id][f];});});
    Object.keys(fields).sort().forEach(function(id){var n=node(id,true);if(!n)return;Object.keys(fields[id]||{}).sort().forEach(function(f){n[f]=fields[id][f];n.edited.push(f);});});
    Object.keys(linkEdits).sort().forEach(function(k){var e=linkEdits[k];if(!e||!validId(e.a)||!validId(e.b)||['parent','partner','friend'].indexOf(e.type)<0||key(e.type,e.a,e.b)!==k)return;if(e.excluded)delete links[k];else claim(e.type,e.a,e.b,{role:e.role,status:e.status,source:'owner'});});
    // Isolate cycles in imported evidence; keep other edges deterministic. Raw records remain untouched.
    var edges=[], children=Object.create(null);
    function reaches(from,target,seen){if(from===target)return true;if(seen[from])return false;seen[from]=true;return (children[from]||[]).some(function(n){return reaches(n,target,seen);});}
    Object.keys(links).sort().forEach(function(k){var e=links[k];if(e.type==='parent'){if(reaches(e.b,e.a,Object.create(null))){issues.push({type:'cycle',edge:e});return;} (children[e.a]||(children[e.a]=[])).push(e.b);} edges.push(e);});
    edges.forEach(function(e){var a=sims[e.a],b=sims[e.b];if(e.type==='parent'){a.children.push(e.b);b.parents.push(e.a);}else if(e.type==='partner'){a.partners.push(e.b);b.partners.push(e.a);}});
    Object.keys(sims).forEach(function(id){var n=sims[id];if(n.spouse && !edges.some(function(e){return e.type==='partner'&&e.status==='married'&&((e.a===id&&e.b===n.spouse)||(e.b===id&&e.a===n.spouse));})) delete n.spouse;n.parents.sort();n.children.sort();n.partners.sort();n.childCount=edges.filter(function(e){return e.type==='parent'&&e.a===id&&e.role!=='guardian'&&sims[e.b].kind!=='pet';}).length;});
    return {owner:input.owner||'',scope:input.scope||'legacy-owner-unverified-save',truncated:family.truncated===true,sims:sims,edges:edges,issues:issues,partial:true,capturedAt:family.at||0,capture:capture,captureReceivedAt:captureReceivedAt};
  }
  return {normalize:normalize,validId:validId,linkKey:key};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=FamilyEngine;
