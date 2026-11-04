const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {build}=require('../scripts/build-family-capture-backend.cjs');
const source=`function plainObj_(x){return !!x && typeof x==='object' && !Array.isArray(x)}
function cleanLifeEvents_(x){return x}
function cleanLife_(x){return x}
function cleanSim_(x){var s={};
  if (x.life !== undefined) s.life = cleanLife_(x.life);
return s;}
function cleanSnap_(d){return {
    lifeEvents: cleanLifeEvents_(d.lifeEvents),
    sims: Array.isArray(d.sims) ? d.sims : [] };}
function router(me,body){switch(body.action){
      case 'portrait': return portraitAction_(me, body);
}}
function relay(){
  var now = Date.now(), same = false, wasSeen = false, lastErr = null, news = [];
  withLock_(function(){if (false) {}
    if (snap !== null && !(hh === 'none' && parsed.v === 0)) {
      consume();
    } else if (snap !== null) {
      seen.meta = meta;
    }
  });
  var ans = same ? { ok: true, same: true } : { ok: true };
  return ans;
}
function syncFor_(roster,have){var keys=[],recs=[];
  Object.keys(roster).forEach(function (sn) {
    var idx = prop_('sx_' + sn) || {}, name = roster[sn];
  });return {keys:keys,recs:recs};}
function live_(roster){var famKeys=[],fams=[],have={};Object.keys(roster).forEach(function(sn){
    var at = Number(props_().getProperty('fx_' + sn) || 0);
  });}
function exportAll_(roster){var game=[];Object.keys(roster).forEach(function(sn){
    var idx = prop_('sx_' + sn) || {};
    Object.keys(idx).forEach(function (hh) { var r = readJson_('sync__' + sn + '__' + hh + '.json', null); if (r) game.push({ name: roster[sn], hh: hh, at: r.at, data: JSON.parse(r.s) }); });
  });return game;}
function healthData_(){var sn='alice';
    var seen = prop_('seen_' + sn) || {}, idx = prop_('sx_' + sn) || {}, log = readJson_('log__' + sn + '.json', { lines: [] });
return idx;}`;
function setup(){
 const files={},props={};const c={Date,Number,JSON,Object,Array,Math,RegExp,
  readJson_:(key,d)=>key in files?JSON.parse(JSON.stringify(files[key])):d,
  writeJson_:(key,value)=>{files[key]=JSON.parse(JSON.stringify(value));},
  prop_:key=>props[key]||null,withLock_:f=>f(),sameActor_:(a,b)=>a===b,
  familyOwner_:(me,b)=>b&&b.owner==='alice'?{owner:'alice',sn:'alice'}:null,
  res_:(status,body)=>({status,body})};
 vm.runInNewContext(build(source),c);return {c,files,props};
}
function capture(id,seq,uid,children=[]){return {v:1,at:100+seq,household:{id:'123',name:'home'},
 familyCapture:{schema:1,source:'game-genealogy',streamId:id,sequence:seq,captureId:uid},
 sims:[{id:'18446744073709551615',first:'a',last:'',age:'ADULT',gender:'',dead:false,deadKnown:true,spouse:null,spouseKnown:true,inHousehold:true,parents:[],children,familyObservation:{parents:'observed',children:'partial'}}]};}
const A='a'.repeat(32),B='b'.repeat(32),U='1'.repeat(32),V='2'.repeat(32),W='3'.repeat(32);
test('unbound streams stay separate from legacy; only owner can bind and revision protects choice',()=>{
 const {c,files}=setup();files['fam__alice.json']={sims:{'99':{f:'legacy'}}};
 assert.equal(c.familyCaptureAccept_('alice',capture(A,1,U,['2']),'123',10).status,'pending_review');
 assert.equal(c.familyCaptureAccept_('alice',capture(B,1,V,['3']),'123',11).status,'pending_review');
 assert.equal(c.familyCaptureRead_('alice'),null);let state=c.familyCaptureState_('alice');
 assert.equal(state.legacyAvailable,true);assert.equal(state.choices.length,2);assert.equal(state.active,null);
 assert.equal(c.familyCaptureBind_('bob',{owner:'alice',streamId:A,revision:state.revision}).status,403);
 assert.equal(c.familyCaptureBind_('alice',{owner:'alice',streamId:A,revision:0}).status,409);
 const bind=c.familyCaptureBind_('alice',{owner:'alice',streamId:A,revision:state.revision});assert.equal(bind.status,200);
 const graph=c.familyCaptureRead_('alice');assert.equal(graph.scope,A);assert.ok(graph.family.sims['18446744073709551615']);assert.equal(graph.family.sims['99'],undefined);
 const live=c.syncFor_({alice:'alice'},{});assert.equal(live.recs.length,1);assert.equal(live.recs[0].rec.data.sims[0].id,'18446744073709551615');
 assert.equal(c.familyCaptureAccept_('alice',{sims:[]},'123',12).status,'legacy_not_active');
 assert.deepEqual(files['fam__alice.json'],{sims:{'99':{f:'legacy'}}});
});
test('duplicates, delayed captures and a different stream cannot overwrite the accepted stream',()=>{
 const {c}=setup();c.familyCaptureAccept_('alice',capture(A,2,U,['2']),'123',10);
 const rev=c.familyCaptureState_('alice').revision;c.familyCaptureBind_('alice',{owner:'alice',streamId:A,revision:rev});
 assert.equal(c.familyCaptureAccept_('alice',capture(A,2,U,['9']),'123',11).status,'duplicate');
 assert.equal(c.familyCaptureAccept_('alice',capture(A,1,V,['9']),'123',12).status,'stale');
 assert.equal(c.familyCaptureAccept_('alice',capture(B,1,W,['8']),'123',13).status,'pending_review');
 let read=c.familyCaptureRead_('alice');assert.equal(read.scope,A);assert.deepEqual(Array.from(read.family.sims['18446744073709551615'].c),['2']);
 assert.equal(c.familyCaptureAccept_('alice',capture(A,3,V,['4']),'123',14).status,'accepted');
 read=c.familyCaptureRead_('alice');assert.deepEqual(Array.from(read.family.sims['18446744073709551615'].c),['2','4']);
});
test('unsequenced captures stay out of the family, and histories are bounded',()=>{
 const {c,files}=setup();let bad=capture(A,1,U);delete bad.familyCapture.sequence;
 assert.equal(c.familyCaptureAccept_('alice',bad,'123',1).status,'unsequenced');assert.equal(c.familyCaptureRead_('alice'),null);
 for(let i=1;i<=12;i++) c.familyCaptureAccept_('alice',capture(A,i,String(i).padStart(32,'0')),'123',i);
 assert.equal(files['family-capture__alice__'+A+'.json'].history.length,8);
});
test('bound sync cache changes for same-millisecond captures and source switches',()=>{
 const {c}=setup();c.familyCaptureAccept_('alice',capture(A,1,U),'123',10);
 let s=c.familyCaptureState_('alice');c.familyCaptureBind_('alice',{owner:'alice',streamId:A,revision:s.revision});
 let first=c.syncFor_({alice:'alice'},{}).recs[0].rec.at;
 c.familyCaptureAccept_('alice',capture(A,2,V),'123',10);
 let second=c.syncFor_({alice:'alice'},{'alice|123':first}).recs[0].rec.at;
 assert.ok(second>first);
 c.familyCaptureAccept_('alice',capture(B,1,W),'123',10);s=c.familyCaptureState_('alice');
 c.familyCaptureBind_('alice',{owner:'alice',streamId:B,revision:s.revision});
 let third=c.syncFor_({alice:'alice'},{'alice|123':second}).recs[0].rec.at;assert.ok(third>second);
});
test('the person limit keeps earlier history and reports truncation',()=>{
 const {c}=setup(),fam={sims:{}};for(let i=1;i<=900;i++)fam.sims[String(i)]={f:'old'};
 const s=capture(A,1,U);s.sims[0].id='901';const out=c.familyCaptureMerge_(fam,s,'123',10);
 assert.equal(Object.keys(out.sims).length,900);assert.equal(out.sims['1'].f,'old');assert.equal(out.truncated,true);
});
test('fully observed direct fields replace old claims while partial and unknown preserve history',()=>{
 const {c}=setup(),person=(id,parents,children,p,ch)=>({id,first:'s',last:'',age:'',gender:'',parents,children,familyObservation:{parents:p,children:ch}});
 let fam=c.familyCaptureMerge_(null,{sims:[person('1',[],['3'],'observed','observed'),person('3',['1'],[],'observed','observed'),person('4',[],['5'],'observed','observed')]},'123',1);
 fam=c.familyCaptureMerge_(fam,{sims:[person('3',['2'],[],'observed','unknown'),person('2',[],['3'],'unknown','partial')]},'123',2);
 assert.deepEqual(Array.from(fam.sims['3'].p),['2']);assert.equal(fam.sims['3'].po,'observed');
 assert.deepEqual(Array.from(fam.sims['1'].c),['3']);assert.deepEqual(Array.from(fam.sims['4'].c),['5']);
 fam=c.familyCaptureMerge_(fam,{sims:[person('3',['7'],[],'partial','unknown'),person('1',[],[],'unknown','unknown')]},'123',3);
 assert.deepEqual(Array.from(fam.sims['3'].p),['2','7']);assert.equal(fam.sims['3'].po,'observed');assert.deepEqual(Array.from(fam.sims['1'].c),['3']);
});
test('reported relationship flags are sanitized and omission does not invent an ending',()=>{
 const {c}=setup();const clean=c.cleanSnap_({sims:[],familyRelationships:[{a:'2',b:'1',flags:['spouse','bogus']},{a:'bad',b:'1',flags:['fiance']}]});
 assert.equal(clean.familyRelationships.length,1);assert.deepEqual(Array.from(clean.familyRelationships[0].flags),['spouse']);
 let fam=c.familyCaptureMerge_(null,clean,'123',10);assert.equal(fam.relationships[0].a,'1');assert.equal(fam.relationships[0].b,'2');
 fam=c.familyCaptureMerge_(fam,{sims:[],familyRelationships:[]},'123',11);assert.deepEqual(Array.from(fam.relationships[0].flags),['spouse']);
 fam=c.familyCaptureMerge_(fam,{sims:[],familyRelationships:[{a:'1',b:'2',flags:['steady']}]},'123',12);assert.deepEqual(Array.from(fam.relationships[0].flags),['steady']);
});
test('a retry repairs an interrupted projection write',()=>{
 const {c,files}=setup(),write=c.writeJson_;let fail=true;
 c.writeJson_=(name,value)=>{if(fail&&name.startsWith('family-capture-current__')){fail=false;throw Error('disk');}write(name,value);};
 assert.throws(()=>c.familyCaptureAccept_('alice',capture(A,1,U),'123',10));
 assert.equal(c.familyCaptureAccept_('alice',capture(A,1,U),'123',11).status,'duplicate');
 assert.ok(files['family-capture-current__alice__'+A+'.json']);
 const s=c.familyCaptureState_('alice');assert.equal(s.choices.length,1);
});
test('snapshot cleaner declines unverified assertions and builder fails closed',()=>{
 const {c}=setup();const out=c.cleanSnap_({sims:[{id:'18446744073709551615'}],familyCapture:{schema:1,source:'game-genealogy',completeness:'complete',saveIdentity:'verified',captureOrder:'verified'}});
 assert.equal(out.familyCapture.completeness,'partial');assert.equal(out.familyCapture.saveIdentity,'unverified');
 assert.throws(()=>build(source+source));assert.throws(()=>build(build(source)));
});
