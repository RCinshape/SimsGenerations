const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build, rulesSource } = require('../scripts/build-backend-patch.cjs');
const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'GoalEvents.gs'), 'utf8');
const now = 1793563200000;
const copy = value => JSON.parse(JSON.stringify(value));

function setup() {
  const files = new Map(), properties = new Map(), writes = [], notifications = [];
  let locked = false, records = [];
  const context = vm.createContext({
    Date: {now:()=>now},
    MAX_PROGRESS:65536, EVENT_TYPES:['start','tick','heir','post','dare','bonus','twist','finish'],
    plainJson_:o=>!!o&&typeof o==='object', plainObj_:o=>!!o&&typeof o==='object'&&!Array.isArray(o),
    clean_:(s,n)=>String(s??'').trim().slice(0,n),
    safe_:s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
    cleanProgress_:p=>p?copy(p):null,
    res_:(s,d)=>({s,d}),
    readJson_:(name,fallback)=>files.has(name)?copy(files.get(name)):fallback,
    writeJson_:(name,value)=>{assert.equal(locked,true,'progress and event writes must hold the same lock');files.set(name,copy(value));writes.push(name);},
    prop_:name=>properties.has(name)?properties.get(name):null,
    withLock_:fn=>{assert.equal(locked,false);locked=true;try{return fn();}finally{locked=false;}},
    syncFor_:()=>({recs:records.map(rec=>({name:'qa-alpha',rec}))}),
    feedAs_:(...args)=>notifications.push(args), voiceEvent_:()=>'', inboxOthers_:()=>notifications.push('inbox'),
  });
  if(process.env.BACKEND_SOURCE) {
    vm.runInContext(build(fs.readFileSync(process.env.BACKEND_SOURCE,'utf8')),context);
    // Keep the bundled syncFor_ and exercise it against synthetic Script Properties and Drive data.
    Object.assign(context,{readJson_:(name,fallback)=>files.has(name)?copy(files.get(name)):fallback,
      writeJson_:(name,value)=>{assert.equal(locked,true);files.set(name,copy(value));writes.push(name);},
      withLock_:fn=>{assert.equal(locked,false);locked=true;try{return fn();}finally{locked=false;}},
      prop_:name=>properties.has(name)?properties.get(name):null,
      feedAs_:(...args)=>notifications.push(args),voiceEvent_:()=>'',inboxOthers_:()=>notifications.push('inbox')});
  } else vm.runInContext(rulesSource(page)+moduleSource, context);
  const progress = {name:'qa-alpha',current:1,updatedAt:1,gens:{1:{ticks:[],heir:'Sample Heir',heirSimId:'1001',autoSeen:[]}}};
  const goal = vm.runInContext('trackGoals_(GOAL_CATALOG_[0])[1].t',context);
  const event = {id:'syntheticevent1',type:'tick',gen:1,text:'untrusted display text',goal,source:'manual',actor:'qa-alpha',v:2,at:now-7*3600000};
  const backedByBundle=!!process.env.BACKEND_SOURCE;
  return {files,properties,writes,notifications,context,progress,event,
    save:p=>{const result=context.saveProgress_('qa-alpha',copy(p));if(result.s===200)p._revision=result.d.revision;return result;},
    send:e=>context.addEvent_('qa-alpha',copy(e)),
    snapshots:r=>{records=r;if(backedByBundle){
      properties.set('sx_qa-alpha','0');
      r.forEach((x,i)=>files.set('sync__qa-alpha__'+i+'.json',{hh:x.hh,at:x.at,m:x.m||{},s:JSON.stringify(x.data)}));
    }}};
}

test('the backend rejects a progress body belonging to a different player', () => {
  const app=setup();app.progress.name='qa-beta';
  assert.equal(app.save(app.progress).d.error,'actor_mismatch');
  assert.equal(app.writes.length,0);
});

test('a first write accepts an unversioned stored record, then rejects an absent stale revision', () => {
  const app=setup();
  app.files.set('prog__qa-alpha.json',{...copy(app.progress),gens:{1:{ticks:[1]}}});
  assert.equal(app.save(app.progress).d.revision,1);
  const stale=copy(app.progress);delete stale._revision;stale.gens[1].ticks=[1];
  const conflict=app.save(stale);
  assert.equal(conflict.s,409);
  assert.equal(conflict.d.error,'progress_conflict');
  assert.equal(conflict.d.progress.name,'qa-alpha');
  assert.equal(conflict.d.progress._revision,1);
  assert.deepEqual(conflict.d.progress.gens[1].ticks,[]);
  assert.equal(app.files.get('prog__qa-alpha.json')._revision,1);
});

test('malformed progress revisions are rejected without writing', () => {
  const app=setup();
  for(const revision of ['1',-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(app.save({...app.progress,_revision:revision}).d.error,'bad_progress');
  }
  assert.equal(app.writes.length,0);
});

test('a delayed stale client cannot restore an unticked goal', () => {
  const app=setup();
  app.progress.gens[1].ticks=[1];
  assert.equal(app.save(app.progress).d.revision,1);
  const delayed=copy(app.progress);
  app.progress.gens[1].ticks=[];
  assert.equal(app.save(app.progress).d.revision,2);
  assert.equal(app.save(delayed).d.error,'progress_conflict');
  assert.deepEqual(app.files.get('prog__qa-alpha.json').gens[1].ticks,[]);
  assert.equal(app.send(app.event).d.error,'stale_tick');
});

test('the backend rejects an incomplete manual goal without publishing or notifying', () => {
  const app=setup();app.save(app.progress);
  assert.equal(app.send(app.event).d.error,'stale_tick');
  assert.equal(app.files.has('feed.json'),false);
  assert.equal(app.notifications.length,0);
});

test('saved completion is recorded with canonical goal, original time and receipt time', () => {
  const app=setup();app.progress.gens[1].ticks=[1];app.save(app.progress);
  assert.equal(app.send(app.event).s,200);
  const event=app.files.get('feed.json')[0];
  assert.equal(event.text,`ticked “${app.event.goal}”`);
  assert.equal(event.at,app.event.at);
  assert.equal(event.receivedAt,now);
  assert.equal(event.timeBasis,'client');
  assert.equal(event.progressRevision,1);
  assert.equal(event.who,'qa-alpha');
  assert.equal(event.source,'manual');
});

test('claimed game completion needs the actual matching game snapshot', () => {
  const app=setup();app.progress.gens[1].autoSeen=[1];app.save(app.progress);
  const event={...app.event,source:'game'};
  assert.equal(app.send(event).d.error,'stale_tick');
  app.snapshots([{at:now,hh:'household',data:{sims:[{id:'1001',first:'Sample',last:'Heir',inHousehold:true,asp:{n:'Romantic Explorer',done:false}}]}}]);
  assert.equal(app.send(event).d.error,'stale_tick');
  app.snapshots([{at:now,hh:'household',data:{sims:[{id:'1001',first:'Sample',last:'Heir',inHousehold:true,asp:{n:'Romantic Explorer',done:true}}]}}]);
  assert.equal(app.send(event).s,200);
  assert.match(app.files.get('feed.json')[0].text,/from the game$/);
});

test('the bundled sync lookup never uses another player’s indexed snapshot', {skip:!process.env.BACKEND_SOURCE}, () => {
  const app=setup();app.progress.gens[1].autoSeen=[1];app.save(app.progress);
  app.snapshots([{at:now,hh:'other-save',m:{},data:{sims:[{id:'1001',first:'Sample',last:'Heir',inHousehold:true,asp:{n:'Romantic Explorer',done:true}}]}}]);
  app.properties.set('sx_qa-beta','0');
  app.files.set('sync__qa-beta__0.json',{hh:'other-save',at:now,m:{},s:JSON.stringify({sims:[{id:'1001',first:'Sample',last:'Heir',inHousehold:true,asp:{n:'Romantic Explorer',done:true}}]})});
  app.properties.delete('sx_qa-alpha');
  assert.equal(app.send({...app.event,source:'game'}).d.error,'stale_tick');
  assert.equal(app.files.has('feed.json'),false);
});

test('another flagged heir cannot complete the selected heir’s aspiration', () => {
  const app=setup();app.progress.gens[1].heirSimId='9999';app.progress.gens[2]={heirSimId:'1001'};app.save(app.progress);
  app.snapshots([{at:now,hh:'other-save',data:{sims:[{id:'1001',first:'Other',last:'Heir',heir:true,inHousehold:true,asp:{n:'Romantic Explorer',done:true}}]}}]);
  assert.equal(app.send({...app.event,source:'game'}).d.error,'stale_tick');
});

test('a pending completion is rejected after its saved tick is retracted', () => {
  const app=setup();app.progress.gens[1].ticks=[1];app.save(app.progress);
  app.progress.gens[1].ticks=[];app.save(app.progress);
  assert.equal(app.send(app.event).d.error,'stale_tick');
  assert.equal(app.notifications.length,0);
});

test('event actor mismatches and old untraceable tick clients are rejected', () => {
  const app=setup();
  assert.equal(app.send({...app.event,actor:'qa-beta'}).d.error,'actor_mismatch');
  const legacy={...app.event};delete legacy.actor;delete legacy.v;
  assert.equal(app.send(legacy).d.error,'update_required');
  assert.equal(app.files.has('feed.json'),false);
});

test('retrying a recorded event is idempotent even after a later untick', () => {
  const app=setup();app.progress.gens[1].ticks=[1];app.save(app.progress);app.send(app.event);
  app.progress.gens[1].ticks=[];app.save(app.progress);
  assert.equal(app.send(app.event).d.dup,true);
  assert.equal(app.files.get('feed.json').length,1);
  assert.equal(app.notifications.length,1);
});

test('an event id owned by another player cannot be silently acknowledged', () => {
  const app=setup();app.files.set('feed.json',[{id:app.event.id,who:'qa-beta'}]);
  assert.equal(app.send(app.event).d.error,'event_id_conflict');
});

test('an invalid future client time uses the receipt time explicitly', () => {
  const app=setup();app.progress.gens[1].ticks=[1];app.save(app.progress);
  app.send({...app.event,at:now+86400000});
  assert.equal(app.files.get('feed.json')[0].at,now);
  assert.equal(app.files.get('feed.json')[0].timeBasis,'received');
});
