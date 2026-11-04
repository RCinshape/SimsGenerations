// Shared by tests/tree-v2-ui.test.cjs and scripts/tree-v2-screens.cjs: the Sadie tree from the contract and a fake backend.
const fs = require('node:fs');
const path = require('node:path');
const { html: base } = require('./create-debug-fixture.cjs');
const root = path.join(__dirname, '..');

function sim(id, first, last, age, extra = {}) {
  return Object.assign({ id, first, last, gender: '', age, kind: 'person', species: '', life: 'alive', cause: '', occults: [], traits: [], asp: '', inHousehold: false, src: 'game', edited: [], gameValues: {} }, extra);
}
function sadieTree(canEdit = true) {
  const sims = {};
  [
    sim('1001', 'Wilma', 'Hart', 'ELDER', { gender: 'female', life: 'dead', cause: 'OLD_AGE', traits: ['TRAIT_BAKER'] }),
    sim('1002', 'Gordon', 'Hart', 'ELDER', { gender: 'male', life: 'dead', cause: 'OLD_AGE' }),
    sim('2001', 'Sadie', 'Hart', 'ADULT', { gender: 'female', inHousehold: true, occults: ['WITCH'], traits: ['TRAIT_CREATIVE', 'TRAIT_FOODIE', 'TRAIT_GOOFBALL'], asp: 'Master Chef', edited: ['asp'], gameValues: { asp: 'Friend of the World' } }),
    sim('2002', 'Salim', 'Rahman', 'ADULT', { gender: 'male' }),
    sim('2003', 'Romeo', 'Quill', 'ADULT', { gender: 'male', inHousehold: true }),
    sim('2004', 'Kyle', 'Brandt', 'ADULT', { gender: 'male', inHousehold: true }),
    sim('2005', 'Juliette', 'Quill', 'ADULT', { gender: 'female' }),
    sim('2101', 'Basil', 'Rahman', 'TEEN', { gender: 'male', inHousehold: true }),
    sim('2102', 'Reuben', 'Quill', 'CHILD', { gender: 'male', inHousehold: true }),
    sim('2103', 'Honey', 'Brandt', 'TODDLER', { gender: 'female', inHousehold: true }),
    sim('2201', 'Clay', 'Quill', 'TEEN'),
    sim('2202', 'Sawyer', 'Quill', 'CHILD'),
    sim('2203', 'Dante', 'Quill', 'INFANT'),
    sim('2301', 'Biscuit', '', 'ADULT', { kind: 'pet', species: 'dog', inHousehold: true }),
    sim('2009', 'Hidden', 'Cousin', 'ADULT')
  ].forEach(s => { sims[s.id] = s; });
  const par = (parent, child, type = 'birth') => ({ id: `p:${parent}:${child}`, child, parent, type, src: 'game' });
  const prt = (a, b, status, src = 'game') => ({ id: `m:${a < b ? a : b}:${a < b ? b : a}`, a, b, status, src });
  return {
    owner: 'qa-alpha', rev: 7, sims,
    parents: [par('1001', '2001'), par('1002', '2001'), par('2001', '2101'), par('2002', '2101'), par('2001', '2102'), par('2003', '2102'), par('2001', '2103'), par('2004', '2103'),
      par('2003', '2201'), par('2005', '2201'), par('2003', '2202'), par('2005', '2202'), par('2003', '2203'), par('2005', '2203'), par('2001', '2301', 'unknown')],
    partners: [prt('2001', '2002', 'ex'), prt('2001', '2003', 'coparent', 'inferred'), prt('2001', '2004', 'married'), prt('2003', '2005', 'married'), prt('1001', '1002', 'married')],
    friends: [], heirs: { 1: '1001', 2: '2001' }, hidden: ['2009'], canEdit
  };
}
// Evaluated inside the page. Wraps window.fetch so the page's real api() path (webCall) is exercised.
const serverSource = `(function(){
  const orig=window.fetch, srv=window.__srv={tree:null,calls:[],mode:{},next:1,images:{}};
  const copy=o=>JSON.parse(JSON.stringify(o));
  const lh=(a,b)=>a<b?[a,b]:[b,a];
  function apply(op){
    const t=srv.tree;
    if(op.op==='sim_add'){const id='m'+(srv.next++);t.sims[id]=Object.assign({id,first:'',last:'',gender:'',age:'',kind:'person',species:'',life:'alive',cause:'',occults:[],traits:[],asp:'',inHousehold:false,src:'manual',edited:[],gameValues:{}},op.sim);return id;}
    if(op.op==='link_add'){
      if(op.kind==='parent')t.parents.push({id:'p:'+op.parent+':'+op.child,child:op.child,parent:op.parent,type:op.type,src:'owner'});
      if(op.kind==='partner'){const [l,h]=lh(op.a,op.b);t.partners.push({id:'m:'+l+':'+h,a:op.a,b:op.b,status:op.status,src:'owner'});}
      if(op.kind==='friend'){const [l,h]=lh(op.a,op.b);t.friends.push({id:'f:'+l+':'+h,a:op.a,b:op.b,src:'owner'});}
    }
    if(op.op==='link_remove'){['parents','partners','friends'].forEach(k=>{t[k]=t[k].filter(l=>l.id!==op.id);});}
    if(op.op==='link_set'){['parents','partners'].forEach(k=>t[k].forEach(l=>{if(l.id===op.id){if(op.status)l.status=op.status;if(op.type)l.type=op.type;}}));}
    if(op.op==='sim_hide'){t.hidden=t.hidden.filter(i=>i!==op.id);if(op.hidden)t.hidden.push(op.id);}
    if(op.op==='sim_delete'){delete t.sims[op.id];['parents','partners','friends'].forEach(k=>{t[k]=t[k].filter(l=>![l.a,l.b,l.child,l.parent].includes(op.id));});}
    if(op.op==='sim_set'){const s=t.sims[op.id];Object.keys(op.fields).forEach(f=>{if(!s.edited.includes(f)){s.edited.push(f);s.gameValues[f]=s[f];}s[f]=op.fields[f];});}
    if(op.op==='sim_reset'){const s=t.sims[op.id];if(s.edited.includes(op.field)){s[op.field]=s.gameValues[op.field];s.edited=s.edited.filter(f=>f!==op.field);delete s.gameValues[op.field];}}
  }
  window.fetch=async(url,options)=>{
    const r=JSON.parse(options.body);
    if(!['tree','tree_edit','portrait'].includes(r.api))return orig(url,options);
    srv.calls.push({path:r.api,body:r.b});
    const out=(s,d)=>({json:async()=>({s,d})});
    if(r.api==='tree'){
      if(srv.mode.unknown===404)return out(404,{error:'not_found'});
      if(srv.mode.unknown==='route')return out(400,{error:'unknown_route'});
      if(srv.mode.unknown==='ok')return out(200,{ok:true});
      return out(200,copy(srv.tree));
    }
    if(r.api==='portrait'){
      const b=r.b;
      if(b.action==='list')return out(200,{portraits:Object.keys(srv.images).map(id=>({simId:id,at:1}))});
      if(b.action==='get')return srv.images[b.simId]?out(200,{image:srv.images[b.simId],at:1}):out(404,{error:'none'});
      if(b.action==='put'){srv.images[b.simId]=b.image;return out(200,{ok:true,at:2});}
      if(b.action==='remove'){delete srv.images[b.simId];return out(200,{ok:true});}
    }
    const b=r.b;
    if(!srv.tree.canEdit)return out(403,{error:'not_owner'});
    if(srv.mode.conflict){srv.mode.conflict=false;srv.tree.rev++;srv.tree.sims['2009'].first='Changed elsewhere';return out(409,{error:'tree_conflict',tree:copy(srv.tree)});}
    if(b.rev!==srv.tree.rev)return out(409,{error:'tree_conflict',tree:copy(srv.tree)});
    const added=[];b.ops.forEach(op=>{const id=apply(op);if(op.op==='sim_add')added.push(id);});
    srv.tree.rev++;
    return out(200,{ok:true,rev:srv.tree.rev,added});
  };
})();`;

function inlineHtml() {
  const js = fs.readFileSync(path.join(root, 'tree.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'tree.css'), 'utf8');
  return base
    .replace('<link rel="stylesheet" href="tree.css">', () => '<style>' + css + '</style>')
    .replace('<script defer src="tree.js"></script>', () => '<script>' + js.replace(/<\/script>/g, '<\\/script>') + '</script>');
}
module.exports = { sadieTree, serverSource, inlineHtml, sim };
