const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { build, deployed } = require('../scripts/build-progress-idempotence.cjs');
const moduleSource = fs.readFileSync(path.join(__dirname,'../gas/GoalEvents.gs'),'utf8');
const privatePath = process.env.IDEMPOTENCE_BACKEND_SOURCE;
const sources = [['portable', moduleSource]];
if (privatePath) sources.push(['production', build(fs.readFileSync(privatePath,'utf8'))]);
else test('production backend idempotence integration', {skip:'set IDEMPOTENCE_BACKEND_SOURCE to a private unpatched bundle'}, () => {});
const copy = x => JSON.parse(JSON.stringify(x));
function setup(source, isProduction) {
  let stored = null, writes = 0, locked = false, notifications = 0;
  const ctx = vm.createContext({}); vm.runInContext(source,ctx);
  Object.assign(ctx, {MAX_PROGRESS:65536,
    plainJson_: x => !!x && typeof x === 'object', plainObj_: x => !!x && typeof x === 'object' && !Array.isArray(x),
    res_: (s,d) => ({s,d}), safe_: x => x.toLowerCase(),
    withLock_: fn => { assert.equal(locked,false); locked=true; try {return fn();} finally {locked=false;} },
    readJson_: () => stored && copy(stored),
    writeJson_: (_name, value) => {assert.equal(locked,true); stored=copy(value); writes++;},
    feedAs_: () => notifications++, inboxOthers_: () => notifications++,
  });
  if (!isProduction) ctx.cleanProgress_ = p => {
    const o = {};
    for (const k of Object.keys(p)) if (k !== 'gens' && (typeof p[k] === 'string' || typeof p[k] === 'number' || typeof p[k] === 'boolean')) o[k]=p[k];
    o.current = Math.floor(Number(p.current)); o.gens={};
    for (const k of Object.keys(p.gens || {})) { o.gens[k]={}; for (const f of Object.keys(p.gens[k])) {
      const v=p.gens[k][f]; if (Array.isArray(v)) o.gens[k][f]=v.filter(x=>typeof x==='number'); else if (typeof v==='string'||typeof v==='number'||typeof v==='boolean') o.gens[k][f]=v;
    } }
    return o;
  };
  const body = {name:'alice', current:1, updatedAt:1700000000000, gens:{1:{ticks:[2],heir:'A'}}};
  return {ctx,body, save: b=>ctx.saveProgress_('alice',copy(b)), stored:()=>stored, setStored:x=>{stored=copy(x);}, writes:()=>writes, notifications:()=>notifications};
}
for (const [label,source] of sources) {
  test(`${label}: lost acknowledgement is safe and idempotent`,()=>{
    const x=setup(source,label==='production'), body=copy(x.body);
    assert.equal(x.save(body).d.revision,1); assert.equal(x.writes(),1);
    const r=x.save(body); assert.equal(r.s,200); assert.equal(r.d.dup,true); assert.equal(r.d.revision,1);
    assert.equal(x.save(body).d.dup,true); assert.equal(x.writes(),1); assert.equal(x.notifications(),0);
    const reordered={gens:{1:{heir:'A',ticks:[2]}},updatedAt:body.updatedAt,current:1,name:'ALICE'};
    assert.equal(x.save(reordered).d.dup,true); assert.equal(x.writes(),1);
    assert.equal(x.save({...body,_revision:1}).d.revision,2); assert.equal(x.writes(),2);
  });
  test(`${label}: mismatches, coercions and invalid revisions fail closed`,()=>{
    const x=setup(source,label==='production'), body=copy(x.body); x.save(body);
    const attempts=[{...body,updatedAt:body.updatedAt+1},{...body,gens:{1:{ticks:[],heir:'A'}}},
      {...body, extra:{nested:1}}, {...body,current:'1'}, {...body,_revision:2}];
    for(const a of attempts) assert.equal(x.save(a).s,409);
    assert.equal(x.save({...body,name:'bob'}).d.error,'actor_mismatch');
    assert.equal(x.writes(),1);
    const withNested={...copy(x.stored()),extra:{nested:1}}; x.setStored(withNested);
    assert.equal(x.save({...body,extra:{nested:1}}).s,409);
    x.setStored({...body}); assert.equal(x.save({...body,_revision:1}).s,409);
    x.setStored(null); assert.equal(x.save({...body,_revision:1}).s,409);
    assert.equal(x.writes(),1); assert.equal(x.notifications(),0);
  });
}
test('incremental builder is single-use and leaves all other bytes unchanged',()=>{
  const source='function sameActor_(a,b){return a===b;}\n'+deployed+'function addEvent_(){}\nvar template="unchanged";';
  const result=build(source), prefix='// Compare JSON values without treating object key order as a change.';
  const start=result.indexOf(prefix), end=result.indexOf('function addEvent_()',start);
  assert.equal(result.slice(0,start)+deployed+result.slice(end),source);
  assert.throws(()=>build(result),/already present/);
  assert.throws(()=>build(source.replace('baseRevision !== previousRevision','baseRevision != previousRevision')),/marker/);
  assert.throws(()=>build(source+deployed),/exactly one/);
  if(privatePath) {
    const privateSource=fs.readFileSync(privatePath,'utf8'), output=build(privateSource);
    const a=output.indexOf(prefix), b=output.indexOf('function addEvent_(',a);
    assert.equal(output.slice(0,a)+deployed+output.slice(b),privateSource);
  }
});
