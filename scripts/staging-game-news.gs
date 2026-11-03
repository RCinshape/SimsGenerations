/** Staging-only runtime checks; all persistence and notifications are replaced in memory. */
function qaRunGameNews() {
  editorOnly_();
  if (ScriptApp.getScriptId() !== 'STAGING_ONLY_REPLACE_LOCALLY') throw new Error('staging only');
  var original = {readJson_:readJson_,writeJson_:writeJson_,props_:props_,withLock_:withLock_,roster_:roster_,playerKey_:playerKey_,bump_:bump_,feedAs_:feedAs_,alert_:alert_,mergeFamily_:mergeFamily_,updateInfo_:updateInfo_,hostLog_:hostLog_};
  var files = {}, properties = {}, delivered = [], checks = [], errors = [], now = Date.now();
  function check(name, condition) { if (!condition) throw new Error(name); checks.push(name); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function sim(i, extra) { var s={id:String(i),first:'Sample'+i,last:'Family',age:'CHILD',dead:false,inHousehold:true,spouse:null,parents:[],children:[],skills:[{n:'Cooking',lv:9,max:10}]};Object.keys(extra||{}).forEach(function(k){s[k]=extra[k];});return s; }
  function snap(sims, at) { return {at:at||Math.floor(now/1000),household:{id:'900',funds:1000},legacy:{slot:'77',claimed:true},sims:sims,lifeEvents:[]}; }
  function journal(kind,id,at) { return {id:id,kind:kind,simId:'1',hh:'900',slot:'77',at:at||now}; }
  function relay(snapshot) { return relayPost_({postData:{contents:JSON.stringify({n:'qa-alpha',k:'synthetic-key',s:JSON.stringify(snapshot),e:{},m:{via:'game'}})}}); }
  try {
    readJson_=function(k,f){return Object.prototype.hasOwnProperty.call(files,k)?clone(files[k]):f;};
    writeJson_=function(k,v){files[k]=clone(v);};
    props_=function(){return {getProperty:function(k){return properties[k]===undefined?null:properties[k];},setProperty:function(k,v){properties[k]=String(v);},deleteProperty:function(k){delete properties[k];},getProperties:function(){return clone(properties);}};};
    withLock_=function(fn){return fn();};roster_=function(){return {'qa-alpha':'qa-alpha'};};playerKey_=function(){return 'synthetic-key';};bump_=function(){return 1;};
    feedAs_=function(who,text){delivered.push({who:who,text:text});};alert_=function(){};mergeFamily_=function(){};updateInfo_=function(){return null;};hostLog_=function(s){errors.push(s);};
    var before=snap(Array.from({length:12},function(_,i){return sim(i+1);}),Math.floor(now/1000)-100);
    var after=snap(before.sims.map(function(s){return sim(s.id,{age:'TEEN',skills:[{n:'Cooking',lv:10,max:10}]});}));
    check('first baseline accepted',relay(before).ok===true);check('baseline stays quiet',delivered.length===0);
    check('age-up sync accepted',relay(after).ok===true);check('12 individual age-up messages',delivered.length===12&&delivered.every(function(d){return /Sample/.test(d.text)&&!/(Cooking|Level 10|maxed)/.test(d.text);}));
    check('identical retry accepted',relay(after).ok===true);check('retry has no duplicate news',delivered.length===12);
    var later=clone(after);later.at+=1;later.lifeEvents=[journal('death','syntheticdeath1',now-200),journal('revive','syntheticrevive1',now-100),journal('abduct','syntheticabduct1',now-90),journal('preterm','syntheticpreterm1',now-80),journal('rescue','syntheticrescue1',now-70)];
    check('journal sync accepted',relay(later).ok===true);check('all five short-lived stories delivered',delivered.length===17);
    check('death and revival retained in order',files['news.json'].slice(-5).map(function(e){return e.kind;}).join(',')==='death,revive,abduct,preterm,rescue');
    check('unknown life input stripped',cleanLifeEvents_([{id:'unknownkind1',kind:'skillMax',simId:'1',at:now}]).length===0);
    var married=snap([sim(1,{spouse:'2'}),sim(2,{spouse:'1'})]);var divorced=snap([sim(1),sim(2)],married.at+1);
    check('divorce detected once',gameNews_('qa-alpha',married,divorced).filter(function(e){return e.kind==='divorce';}).length===1);
    check('missing spouse is not divorce',gameNews_('qa-alpha',married,snap([sim(1)],married.at+1)).length===0);
    files['prog__qa-alpha.json']={name:'qa-alpha',current:1,gens:{1:{ticks:[0]}}};
    var goal=trackGoals_(GOAL_CATALOG_[0])[0].t;
    var response=addEvent_('qa-alpha',{v:2,actor:'qa-alpha',type:'tick',gen:1,id:'syntheticskill1',goal:goal,source:'manual',at:now});
    check('skill goal acknowledged silently',response.s===200&&response.d.suppressed===true&&delivered.length===17);
    check('no backend errors',errors.length===0);
  } finally {
    readJson_=original.readJson_;writeJson_=original.writeJson_;props_=original.props_;withLock_=original.withLock_;roster_=original.roster_;playerKey_=original.playerKey_;bump_=original.bump_;feedAs_=original.feedAs_;alert_=original.alert_;mergeFamily_=original.mergeFamily_;updateInfo_=original.updateInfo_;hostLog_=original.hostLog_;
  }
  var report={passed:checks.length,failed:0,deliveredInMemory:delivered.length,externalMessages:0,persistentWrites:0,checks:checks};Logger.log(JSON.stringify(report));return report;
}
