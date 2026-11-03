const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash}=require('node:crypto');
const {build}=require('../scripts/build-game-news.cjs');
const {build:goalBuild}=require('../scripts/build-backend-patch.cjs');
const source=fs.readFileSync(require.resolve('../gas/GameNews.gs'),'utf8');
const now=1793718000000;
const copy=x=>JSON.parse(JSON.stringify(x));
function app() {
  const files=new Map(),props=new Map(),sent=[];
  const context=vm.createContext({Date:{now:()=>now},Number,Object,Array,String,
    plainObj_:x=>!!x&&typeof x==='object'&&!Array.isArray(x),
    clean_:(s,n)=>String(s??'').trim().slice(0,n),
    b_:s=>'**'+String(s??'').replace(/[*_~`|>\\]/g,'')+'**',
    voice_:(kind,d)=>kind+' '+Object.values(d).join(' '),
    sha256hex_:s=>createHash('sha256').update(s).digest('hex'),
    prop_:k=>props.has(k)?copy(props.get(k)):null,
    readJson_:(k,f)=>files.has(k)?copy(files.get(k)):f,
    writeJson_:(k,v)=>files.set(k,copy(v))});
  vm.runInContext(source,context);
  return {context,files,props,sent,news:(a,b)=>copy(context.gameNews_('qa-alpha',copy(a),copy(b))),
    save:events=>copy(context.newNews_('qa-alpha','qa-alpha',copy(events)))};
}
const sim=(id,more={})=>({id:String(id),first:'Sample'+id,last:'Family',inHousehold:true,age:'ADULT',dead:false,spouse:null,parents:[],children:[],...more});
const snap=(sims,at=now/1000)=>({at,household:{id:'900',funds:1000},legacy:{slot:'77',claimed:true},sims,lifeEvents:[]});
const event=(kind,simId,id,extra={})=>({id,kind,simId:String(simId),hh:'900',slot:'77',at:now-200,...extra});

test('life changes produce individual events; skills and promotions do not',()=>{
  const a=app(),before=snap([sim(1,{age:'CHILD',skills:[{n:'Cooking',lv:9,max:10}],careers:[{n:'Career',lv:1,top:10}]}),sim(2)] ,now/1000-100);
  const after=snap([sim(1,{age:'TEEN',spouse:'2',skills:[{n:'Cooking',lv:10,max:10}],careers:[{n:'Career',lv:10,top:10}]}),sim(2,{spouse:'1'})]);
  assert.deepEqual(a.news(before,after).map(e=>e.kind).sort(),['ageup','marry']);
});
test('all age-ups in the supplied family are covered, including relatives outside the household',()=>{
  const a=app(),before=snap([sim(1,{age:'ADULT',inHousehold:false})],now/1000-100),after=snap([sim(1,{age:'ELDER',inHousehold:false})]);
  assert.equal(a.news(before,after)[0].kind,'ageup');
});
test('death followed by revival between uploads survives in journal order',()=>{
  const a=app(),before=snap([sim(1)],now/1000-100),after=snap([sim(1)]);
  after.lifeEvents=[event('death',1,'deathincident1',{at:now-500}),event('revive',1,'reviveincident1',{at:now-400})];
  const news=a.news(before,after);
  assert.deepEqual(news.map(e=>e.kind),['death','revive']);
  assert.match(news[1].t,/alive again/);
  assert.equal(a.save(news).length,2);
  assert.equal(a.save(news).length,0);
});
test('successful rescue from death has its own story without inventing a confirmed death',()=>{
  const a=app(),before=snap([sim(1)],now/1000-100),after=snap([sim(1)]);
  after.lifeEvents=[event('rescue',1,'rescueincident1')];
  assert.deepEqual(a.news(before,after).map(e=>e.kind),['rescue']);
  assert.match(a.news(before,after)[0].t,/escaped death/);
});
test('abduction and pre-term labour report explicit journal signals even when flags already cleared',()=>{
  const a=app(),before=snap([sim(1)],now/1000-100),after=snap([sim(1)]);
  after.lifeEvents=[event('abduct',1,'abductionevent1'),event('preterm',1,'pretermevent1')];
  assert.deepEqual(a.news(before,after).map(e=>e.kind),['abduct','preterm']);
});
test('journal and state evidence for the same transition do not double announce',()=>{
  const a=app(),before=snap([sim(1)],now/1000-100),after=snap([sim(1,{dead:true})]);
  after.lifeEvents=[event('death',1,'deathincident1')];
  assert.equal(a.news(before,after).length,1);
});
test('existing snapshot collectors detect death, revival and mutual divorce without new fields',()=>{
  const a=app();
  assert.equal(a.news(snap([sim(1)],now/1000-100),snap([sim(1,{dead:true})]))[0].kind,'death');
  assert.equal(a.news(snap([sim(1,{dead:true})],now/1000-100),snap([sim(1)]))[0].kind,'revive');
  const married=snap([sim(1,{spouse:'2'}),sim(2,{spouse:'1'})],now/1000-100);
  assert.deepEqual(a.news(married,snap([sim(1),sim(2)])).map(e=>e.kind),['divorce']);
  assert.equal(a.news(married,snap([sim(1)] )).length,0);
  assert.equal(a.news(married,snap([sim(1),sim(2,{dead:true})])).some(e=>e.kind==='divorce'),false);
  assert.equal(a.news(married,snap([sim(1,{spouseKnown:false}),sim(2,{spouseKnown:false})])).length,0);
});
test('different saves, unknown Sims, invalid or unscoped journal entries never produce stories',()=>{
  const a=app(),before=snap([sim(1)],now/1000-100),after=snap([sim(1)]);
  after.lifeEvents=[event('death',9,'unknownsim1'),event('skillMax',1,'notalifeevent'),event('preterm',1,'wrongscope1',{hh:'901'}),event('death',1,'futureevent1',{at:now+400000})];
  assert.equal(a.news(before,after).length,0);
  after.legacy.slot='78';after.sims[0].dead=true;
  assert.equal(a.news(before,after).length,0);
});
test('more than eight events in a sync are retained, and duplicates within the sync are removed',()=>{
  const a=app(),events=Array.from({length:25},(_,i)=>({k:'age_'+i,kind:'ageup',t:'birthday '+i,at:now-i}));
  assert.equal(a.save([...events,...events]).length,25);
  assert.equal(a.files.get('news.json').length,25);
  assert.equal(a.files.get('news-seen__qa-alpha.json').length,25);
  assert.equal(a.save(events).length,0);
  assert.equal(a.files.get('news.json')[0].receivedAt,now);
});
test('repeated deaths and remarriages get distinct occurrence keys',()=>{
  const a=app(),alive=snap([sim(1)],now/1000-300),dead=snap([sim(1,{dead:true})],now/1000-200);
  const aliveAgain=snap([sim(1)],now/1000-100),deadAgain=snap([sim(1,{dead:true})]);
  assert.notEqual(a.news(alive,dead)[0].k,a.news(aliveAgain,deadAgain)[0].k);
});
test('private builder preserves all other source, handles sanitation and removes daily aggregation', {skip:!process.env.NEWS_BACKEND_SOURCE},()=>{
  const original=fs.readFileSync(process.env.NEWS_BACKEND_SOURCE,'utf8'),result=build(goalBuild(original));
  assert.throws(()=>build(result),/already applied/);
  assert.ok(!result.includes('feed_(dailyRecap_())'));
  assert.equal(result.slice(result.indexOf('/* ===================== ModFiles.gs')),original.slice(original.indexOf('/* ===================== ModFiles.gs')));
  const a=app();vm.runInContext(result,a.context);
  const clean=a.context.cleanSnap_({...snap([sim(1,{life:{pregnant:true,preterm:true,other:'ignored'}})]),lifeEvents:[event('preterm',1,'pretermevent1')]});
  assert.equal(clean.lifeEvents.length,1);
  assert.deepEqual(copy(clean.sims[0].life),{pregnant:true,preterm:true});
  assert.equal(clean.sims[0].deadKnown,true);
  assert.equal(a.context.cleanSim_({id:'1'}).deadKnown,false);
  assert.equal(a.context.cleanSim_({id:'1'}).spouseKnown,false);
});
