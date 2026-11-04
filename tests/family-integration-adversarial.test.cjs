const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const FamilyEngine=require('../family-engine.js');

test('four owner trees isolate edits, sync, merge, revisions and portrait conflicts',()=>{
  const owners=['alice','bob','cara','dana'], files={}, indices={};
  for(const owner of owners){
    files[`fam__${owner}.json`]={sims:{'1':{f:`${owner}-old`,c:['2']},'2':{f:'child'},'3':{f:'import'}}};
    indices[`sx_${owner}`]={home:true};
  }
  const copy=x=>JSON.parse(JSON.stringify(x));
  const ctx={FamilyEngine,roster_:()=>Object.fromEntries(owners.map(x=>[x,x])),safe_:x=>String(x).toLowerCase(),sameActor_:(a,b)=>a.toLowerCase()===b.toLowerCase(),isTester_:()=>false,readJson_:(k,d)=>files[k]===undefined?copy(d):copy(files[k]),writeJson_:(k,v)=>{files[k]=copy(v)},prop_:k=>indices[k]||{},withLock_:fn=>fn(),res_:(s,d)=>({s,d}),plainJson_:()=>true,portraitImageValid_:()=>true,portraitIndex_:()=>[],PORTRAIT_MAX_COUNT_:900};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('gas/FamilyEdits.gs','utf8'),ctx);
  const edit=(actor,owner,revision,op)=>ctx.familyEdit_(actor,{owner,revision,op});
  const read=(actor,owner)=>ctx.familyRead_(actor,{owner});
  for(const owner of owners){
    assert.equal(edit(owner,owner,0,{type:'set_fields',id:'1',fields:{first:`${owner}-corrected`}}).s,200);
    assert.equal(edit(owner,owner,1,{type:'remove_link',linkType:'parent',a:'1',b:'2'}).s,200);
    assert.equal(edit(owner,owner,2,{type:'add_sim',id:'manual-person',fields:{notes:`${owner}-note`}}).s,200);
    assert.equal(edit(owner,owner,3,{type:'add_link',linkType:'parent',a:'manual-person',b:'2',role:'adoptive'}).s,200);
    assert.equal(edit(owners[(owners.indexOf(owner)+1)%4],owner,4,{type:'undo'}).s,403);
    assert.equal(edit(owner,owner,3,{type:'undo'}).s,409);
    files[`sync__${owner}__home.json`]={at:10,s:JSON.stringify({sims:[{id:'1',first:`${owner}-new`,children:['2']},{id:'3',first:`${owner}-game`}]})};
    let graph=read('alice',owner).d.graph;
    assert.equal(graph.sims['1'].first,`${owner}-corrected`);
    assert.equal(graph.sims['3'].first,`${owner}-game`);
    assert.equal(graph.sims['1'].childCount,0);
    assert.equal(graph.sims['manual-person'].childCount,1);
    files[`portrait__${owner}__manual-person.json`]={image:`${owner}-portrait`,at:1};
    files[`portrait__${owner}__3.json`]={image:'conflicting-portrait',at:2};
    const conflict=edit(owner,owner,4,{type:'link_manual',id:'manual-person',targetId:'3'});
    assert.equal(conflict.s,409);assert.equal(conflict.d.part,'portrait');
    assert.equal(read(owner,owner).d.revision,4);
    assert.ok(read(owner,owner).d.graph.sims['manual-person']);
    delete files[`portrait__${owner}__3.json`];
    const merged=edit(owner,owner,4,{type:'link_manual',id:'manual-person',targetId:'3'});
    assert.equal(merged.s,200);
    assert.equal(merged.d.graph.sims['3'].notes,`${owner}-note`);
    assert.equal(merged.d.graph.sims['3'].childCount,1);
    assert.equal(files[`family-edits__${owner}.json`].portraitAliases['3'].source,'manual-person');
    assert.equal(files[`portrait__${owner}__manual-person.json`].image,`${owner}-portrait`);
    assert.equal(files[`portrait__${owner}__3.json`],undefined);
    const undone=edit(owner,owner,5,{type:'undo'});assert.equal(undone.s,200);
    assert.equal(files[`family-edits__${owner}.json`].portraitAliases['3'],undefined);
    assert.equal(undone.d.graph.sims['manual-person'].notes,`${owner}-note`);
    const redone=edit(owner,owner,6,{type:'link_manual',id:'manual-person',targetId:'3'});assert.equal(redone.s,200);
  }
  for(const owner of owners){const result=read('alice',owner);assert.equal(result.d.revision,7);assert.equal(result.d.graph.sims['3'].notes,`${owner}-note`);assert.equal(result.d.graph.sims['1'].first,`${owner}-corrected`);}
});
