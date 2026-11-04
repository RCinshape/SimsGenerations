/* Twenty-Gen Legacy: family tree v2 (focus view). Loaded from index.html with one deferred script.
   Codes ONLY against docs/tree-v2-contract.md: api('tree'), api('tree_edit'), api('portrait').
   Falls back to the classic explorer (openFamilyExplorer) when the backend does not know the `tree` route.
   Uses the page globals: api, h, ME, key, toast, players, familyHref, familyRoute, preparePortrait, openFamilyExplorer, originalTreeLink. */
(function(){
'use strict';
if(window.TreeV2)return;

/* ---------- constants ---------- */
const STATUS={
  married:{sym:'💍',label:'Married',cls:'',line:'solid'},
  engaged:{sym:'💍',label:'Engaged (fiancé/fiancée)',cls:'light',line:'solid'},
  dating:{sym:'❤️',label:'Dating',cls:'',line:'solid'},
  ex:{sym:'💔',label:'Ex',cls:'',line:'dashed'},
  divorced:{sym:'💔',label:'Divorced',cls:'',line:'dashed'},
  widowed:{sym:'🖤',label:'Widowed',cls:'',line:'muted'},
  coparent:{sym:'🤝',label:'Co-parent',cls:'',line:'dotted'},
  unknown:{sym:'?',label:'Status unknown',cls:'',line:'dotted'}
};
const OCC_ICON={VAMPIRE:'🧛',WITCH:'🔮',WEREWOLF:'🐺',MERMAID:'🧜',FAIRY:'🧚',ALIEN:'👽',PLANTSIM:'🌱',ROBOT:'🤖'};
const LINE_DASH={solid:'',dashed:'9 7',dotted:'1.5 7',muted:''};
const STATUS_ORDER=['married','engaged','dating','coparent','unknown','widowed','divorced','ex'];
const PARENT_TYPES=[['birth','Birth parent'],['adopted','Adoptive parent'],['step','Step parent'],['unknown','Parent (type unknown)']];
const UNIT_COLORS=['#d9468f','#2f8fe0','#e08a1e','#138a7e','#7a4fd0','#c2a210','#c53a28','#4f9e2a'];
const SOLO_COLOR='#8a9fb3';
const AGES=[['BABY','Baby'],['INFANT','Infant'],['TODDLER','Toddler'],['CHILD','Child'],['TEEN','Teen'],['YOUNGADULT','Young adult'],['ADULT','Adult'],['ELDER','Elder']];
const AGE_RANK=['ELDER','ADULT','YOUNGADULT','TEEN','CHILD','TODDLER','INFANT','BABY'];
const OCCULTS=[['VAMPIRE','Vampire'],['WITCH','Spellcaster'],['WEREWOLF','Werewolf'],['MERMAID','Mermaid'],['FAIRY','Fairy'],['ALIEN','Alien'],['PLANTSIM','Plant sim'],['ROBOT','Robot']];
const FIELD_LABEL={first:'First name',last:'Last name',gender:'Gender',age:'Age',kind:'Kind',species:'Species',life:'Condition',cause:'Cause of death',occults:'Occults',traits:'Traits',asp:'Aspiration'};
const EDIT_NOTE='Edit mode is on. Dotted outlines show what you can change. Every change is saved to this tree right away and can be undone.';

/* ---------- small helpers ---------- */
const $q=(r,s)=>r.querySelector(s);
const str=v=>v==null?'':String(v);
const normAge=a=>str(a).toUpperCase().replace(/[^A-Z]/g,'');
const ageLabel=a=>{const n=normAge(a),f=AGES.find(x=>x[0]===n);return f?f[1]:(str(a)?str(a).charAt(0).toUpperCase()+str(a).slice(1).toLowerCase():'');};
const cap=s=>{const v=str(s).replace(/^(trait|aspiration)[_ ]/i,'').replace(/_+/g,' ').trim();return /[a-z]/.test(v)?v.replace(/^./,c=>c.toUpperCase()):v.toLowerCase().replace(/^./,c=>c.toUpperCase());};
const occLabel=o=>{const f=OCCULTS.find(x=>x[0]===str(o).toUpperCase());return f?f[1]:cap(o);};
const nameOf=s=>s?(`${s.first||''} ${s.last||''}`.trim()||'(no name)'):'Unknown sim';
const tail=id=>/^\d+$/.test(id)?'#'+id.slice(-4):(id[0]==='m'?'manual':'#'+id.slice(-4));
const isPet=s=>s&&s.kind==='pet';
function hue(id){let n=0;for(const c of str(id))n=(n*31+c.charCodeAt(0))%360;return n;}
function initials(s){const p=nameOf(s).split(/\s+/).filter(Boolean).slice(0,2);return p.map(x=>x[0]).join('').toUpperCase()||'?';}
function petEmoji(s){const sp=str(s&&s.species).toLowerCase();return /dog|puppy/.test(sp)?'🐶':/cat|kitten/.test(sp)?'🐱':/horse/.test(sp)?'🐴':/fox/.test(sp)?'🦊':'🐾';}
const other=(l,id)=>l.a===id?l.b:l.a;
const sortAge=(a,b,sims)=>{const ra=AGE_RANK.indexOf(normAge(sims[a].age)),rb=AGE_RANK.indexOf(normAge(sims[b].age));return (ra<0?99:ra)-(rb<0?99:rb)||nameOf(sims[a]).localeCompare(nameOf(sims[b]));};
function lowHigh(a,b){const num=/^\d+$/.test(a)&&/^\d+$/.test(b);const lt=num?(a.length!==b.length?a.length<b.length:a<b):a<b;return lt?[a,b]:[b,a];}

/* ---------- data index: the rules of the contract live here ---------- */
function buildIndex(t){
  const sims={};Object.keys(t.sims||{}).forEach(k=>{sims[k]=t.sims[k];});
  const ix={sims,hidden:new Set((t.hidden||[]).map(String)),par:new Map(),kids:new Map(),pt:new Map(),fr:new Map()};
  const add=(m,k,v)=>{let a=m.get(k);if(!a){a=[];m.set(k,a);}a.push(v);};
  (t.parents||[]).forEach(l=>{const c=str(l.child),p=str(l.parent);if(sims[c]&&sims[p]){add(ix.par,c,l);add(ix.kids,p,l);}});
  (t.partners||[]).forEach(l=>{const a=str(l.a),b=str(l.b);if(sims[a]&&sims[b]&&a!==b){add(ix.pt,a,l);add(ix.pt,b,l);}});
  (t.friends||[]).forEach(l=>{const a=str(l.a),b=str(l.b);if(sims[a]&&sims[b]&&a!==b){add(ix.fr,a,l);add(ix.fr,b,l);}});
  return ix;
}
/* Rule 1 + 2: children come only from parent links; a unit is one child's exact parent set. */
function unitsOf(ix,id){
  const map=new Map();
  (ix.kids.get(id)||[]).forEach(l=>{
    const c=l.child;if(!ix.sims[c]||isPet(ix.sims[c])||ix.hidden.has(c))return;
    const set=(ix.par.get(c)||[]).map(x=>x.parent).filter((v,i,a)=>a.indexOf(v)===i).sort();
    const k=set.join('|');let u=map.get(k);if(!u){u={key:k,parents:set,others:set.filter(p=>p!==id),children:[]};map.set(k,u);}
    if(!u.children.includes(c))u.children.push(c);
  });
  const units=[...map.values()];units.forEach(u=>u.children.sort((a,b)=>sortAge(a,b,ix.sims)));
  return units;
}
function partnersOf(ix,id){
  return (ix.pt.get(id)||[]).map(l=>({link:l,id:other(l,id)})).filter(p=>ix.sims[p.id]&&!ix.hidden.has(p.id))
    .sort((a,b)=>STATUS_ORDER.indexOf(a.link.status)-STATUS_ORDER.indexOf(b.link.status));
}
function parentsOf(ix,id){return (ix.par.get(id)||[]).filter(l=>ix.sims[l.parent]&&!ix.hidden.has(l.parent));}
function petsOf(ix,id){return (ix.kids.get(id)||[]).filter(l=>isPet(ix.sims[l.child])&&!ix.hidden.has(l.child)).map(l=>l.child);}
function descendants(ix,id){const seen=new Set(),q=[id];while(q.length){const x=q.pop();(ix.kids.get(x)||[]).forEach(l=>{if(!seen.has(l.child)){seen.add(l.child);q.push(l.child);}});}return seen;}
function ancestors(ix,id){const seen=new Set(),q=[id];while(q.length){const x=q.pop();(ix.par.get(x)||[]).forEach(l=>{if(!seen.has(l.parent)){seen.add(l.parent);q.push(l.parent);}});}return seen;}
function colorMap(ix,focus,units,partners){
  const m=new Map();let i=0;
  partners.forEach(p=>{m.set(p.id,UNIT_COLORS[i++%UNIT_COLORS.length]);});
  units.forEach(u=>u.others.forEach(o=>{if(!m.has(o))m.set(o,UNIT_COLORS[i++%UNIT_COLORS.length]);}));
  return m;
}
function defaultFocus(t,ix){
  const heirs=t.heirs||{},gens=Object.keys(heirs).map(Number).filter(n=>n&&ix.sims[str(heirs[n])]).sort((a,b)=>b-a);
  if(gens.length)return str(heirs[gens[0]]);
  const ids=Object.keys(ix.sims).filter(i=>!isPet(ix.sims[i])&&!ix.hidden.has(i));
  ids.sort((a,b)=>(!(ix.par.get(a)||[]).length?0:1)-(!(ix.par.get(b)||[]).length?0:1)||descendants(ix,b).size-descendants(ix,a).size);
  return ids[0]||Object.keys(ix.sims)[0]||'';
}

/* ---------- state ---------- */
let S=null,EPOCH=0;
const IMG_CACHE=new Map(),READS=[];
const valid=t=>t&&typeof t==='object'&&t.sims&&typeof t.sims==='object'&&Array.isArray(t.parents);
const gidKey=()=>{try{return typeof GID==='string'?GID:'';}catch(e){return '';}};
const unknownRoute=e=>{const m=str(e&&e.message),c=str(e&&e.code);return m==='404'||m==='405'||/unknown|not_found|no_route|bad_route|unsupported/i.test(c);};

/* ---------- modal ---------- */
function modal(title,body,opts={}){
  const opener=document.activeElement,back=h('div',{class:'tv-modal-back'});
  const box=h('div',{class:'tv tv-modal',role:'dialog','aria-modal':'true','aria-label':title});
  const close=()=>{back.remove();document.removeEventListener('keydown',onKey,true);if(S)S.modals=S.modals.filter(m=>m!==api_);if(opener&&opener.isConnected)opener.focus();opts.onClose&&opts.onClose();};
  const api_={el:box,close};
  function onKey(e){
    if(e.key==='Escape'&&S&&S.modals[S.modals.length-1]===api_){e.stopPropagation();e.preventDefault();close();}
    if(e.key==='Tab'&&S&&S.modals[S.modals.length-1]===api_){const f=[...box.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href]')].filter(x=>!x.closest('[hidden]'));if(!f.length)return;const i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}}
  }
  back.addEventListener('mousedown',e=>{if(e.target===back)close();});
  box.append(h('div',{class:'tv-modal-head'},h('h2',{text:title}),h('button',{class:'tv-x',type:'button','aria-label':'Close',onclick:close},'✕')),...[].concat(body));
  back.append(box);document.body.append(back);document.addEventListener('keydown',onKey,true);
  if(S)S.modals.push(api_);
  const first=box.querySelector('input,select,textarea')||box.querySelector('.tv-modal-head .tv-x');setTimeout(()=>first&&first.focus(),0);
  return api_;
}
function confirmDialog(title,text,okLabel,danger){
  return new Promise(res=>{
    let done=false;const finish=v=>{if(!done){done=true;res(v);}};
    const m=modal(title,[h('p',{class:'tv-modal-text',text}),h('div',{class:'tv-actions'},
      h('button',{class:'tv-btn',type:'button',onclick:()=>{finish(false);m.close();}},'Cancel'),
      h('button',{class:'tv-btn '+(danger?'danger':'primary'),type:'button','data-confirm':'ok',onclick:()=>{finish(true);m.close();}},okLabel))],{onClose:()=>finish(false)});
    setTimeout(()=>{const b=$q(m.el,'[data-confirm]');b&&b.focus();},10);
  });
}

/* ---------- portraits: same `portrait` API as the classic explorer, small read budget ---------- */
const photoOk=at=>Number.isSafeInteger(at)&&at>=0;
const jpegOk=v=>/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v||'');
function budget(){const now=Date.now();while(READS.length&&READS[0]<now-300000)READS.shift();if(READS.length>=50)return false;READS.push(now);return true;}
async function portraitList(st){
  if(!budget())return;
  try{
    const r=await api('portrait',{action:'list',owner:st.owner});
    if(!alive(st)||!r||!Array.isArray(r.portraits))return;
    st.pAvail=new Map();r.portraits.forEach(p=>{if(photoOk(p.at))st.pAvail.set(str(p.simId),p.at);});
    st.pAvail.forEach((at,id)=>{const c=IMG_CACHE.get(cacheKey(st,id,at));if(c)st.pImg.set(id,c);});
    st.pLoaded=true;st.pAvail.forEach((_,id)=>applyPic(st,id));wantPhotos(st);
  }catch(e){st.pLoaded=true;}
}
const cacheKey=(st,id,at)=>[gidKey(),key(ME),key(st.owner),id,at].join(':');
function wantPhotos(st){
  if(!alive(st)||!st.pLoaded)return;
  (st.visible||[]).forEach(id=>{
    if(!st.pAvail.has(id)||st.pImg.has(id)||st.pPending.has(id))return;
    st.pQueue.push(id);st.pPending.add(id);
  });
  pump(st);
}
function pump(st){
  while(st.pActive<2&&st.pQueue.length){
    const id=st.pQueue.shift(),at=st.pAvail.get(id);
    if(!budget()){st.pPending.delete(id);continue;}
    st.pActive++;
    api('portrait',{action:'get',owner:st.owner,simId:id}).then(r=>{
      if(!alive(st)||!r||!photoOk(r.at)||!jpegOk(r.image))return;
      if(photoOk(st.pAvail.get(id))&&r.at<st.pAvail.get(id))return;
      st.pAvail.set(id,r.at);st.pImg.set(id,r.image);IMG_CACHE.set(cacheKey(st,id,r.at),r.image);
      while(IMG_CACHE.size>150)IMG_CACHE.delete(IMG_CACHE.keys().next().value);
      applyPic(st,id);
    }).catch(()=>{}).finally(()=>{st.pActive--;st.pPending.delete(id);pump(st);});
  }
}
function applyPic(st,id){
  if(!alive(st))return;const img=st.pImg.get(id);
  document.querySelectorAll('.tv-pic[data-pic="'+id+'"]').forEach(p=>{if(!p.closest('.tv'))return;paintPic(p,st.ix.sims[id],img);});
}
function paintPic(p,sim,img){
  p.textContent='';
  if(img){p.append(h('img',{src:img,alt:''}));p.classList.add('has-img');}
  else{p.classList.remove('has-img');p.append(isPet(sim)?petEmoji(sim):initials(sim));}
}
function pic(st,id,cls){
  const sim=st.ix.sims[id],p=h('span',{class:'tv-pic '+(cls||''),'data-pic':id,'aria-hidden':'true',style:`--ph:${hue(id)}`});
  paintPic(p,sim,st.pImg.get(id));return p;
}
function alive(st){return S===st&&st.shell.isConnected&&st.actor===ME;}

/* ---------- writes ---------- */
async function reload(st){
  const t=await api('tree',{owner:st.owner});
  if(!alive(st))return;if(!valid(t))throw new Error('bad tree');adopt(st,t);
}
function adopt(st,t){
  st.tree=t;st.rev=t.rev;st.ix=buildIndex(t);
  if(!st.ix.sims[st.focus])st.focus=defaultFocus(t,st.ix);
  st.stack=st.stack.filter(i=>st.ix.sims[i]);
  if(st.selected&&!st.ix.sims[st.selected])st.selected=null;
  if(!t.canEdit)st.edit=false;
  paint(st);
}
async function write(st,ops,msg,undo){
  if(st.busy||!alive(st))return null;
  if(!st.tree.canEdit){toast('Only the owner can edit this tree.',true);return null;}
  st.busy=true;st.shell.classList.add('tv-busy');
  try{
    const r=await api('tree_edit',{owner:st.owner,rev:st.rev,ops});
    if(!alive(st))return null;
    if(r&&r.rev!=null)st.rev=r.rev;
    try{await reload(st);}catch(e){toast('Saved, but the tree could not be refreshed. Reload the page.',true);}
    if(msg)snack(st,msg,undo);
    return r||{};
  }catch(e){
    if(!alive(st))return null;
    const tr=e&&e.data&&e.data.tree;
    if((e.code==='tree_conflict'||str(e.message)==='409')&&valid(tr)){adopt(st,tr);toast('The tree was changed somewhere else, so it was reloaded. Your change was not saved. Please try again.',true);}
    else if(e.code==='not_owner'||str(e.message)==='403')toast('Only the owner can edit this tree.',true);
    else if(e.code==='cycle')toast('That would make someone their own ancestor.',true);
    else toast('Could not save the change. '+(e.code?e.code.replace(/_/g,' ')+'.':'Check your connection and try again.'),true);
    return null;
  }finally{st.busy=false;if(alive(st))st.shell.classList.remove('tv-busy');}
}
function snack(st,text,undo){
  const box=st.ui.snack;box.textContent='';clearTimeout(snack.t);
  box.append(h('span',{text}));
  if(undo)box.append(h('button',{class:'tv-btn small',type:'button','data-undo':'1',onclick:async()=>{box.hidden=true;await undo();}},'Undo'));
  box.append(h('button',{class:'tv-x',type:'button','aria-label':'Dismiss',onclick:()=>{box.hidden=true;}},'✕'));
  box.hidden=false;snack.t=setTimeout(()=>{box.hidden=true;},12000);
}
function findLink(st,kind,a,b){
  const t=st.tree;
  if(kind==='parent')return (t.parents||[]).find(l=>l.child===a&&l.parent===b);
  const list=kind==='partner'?t.partners:t.friends;
  return (list||[]).find(l=>(l.a===a&&l.b===b)||(l.a===b&&l.b===a));
}
function linkRecreateOp(kind,l){
  if(kind==='parent')return {op:'link_add',kind:'parent',child:l.child,parent:l.parent,type:l.type||'unknown'};
  if(kind==='partner')return {op:'link_add',kind:'partner',a:l.a,b:l.b,status:l.status||'unknown'};
  return {op:'link_add',kind:'friend',a:l.a,b:l.b};
}
async function addLink(st,kind,spec){
  const ops=[Object.assign({op:'link_add',kind},spec)];
  const names=kind==='parent'?[spec.child,spec.parent]:[spec.a,spec.b];
  const r=await write(st,ops,`Linked ${nameOf(st.ix.sims[names[0]])} and ${nameOf(st.ix.sims[names[1]])}.`,async()=>{
    const l=kind==='parent'?findLink(st,'parent',spec.child,spec.parent):findLink(st,kind,spec.a,spec.b);
    if(l)await write(st,[{op:'link_remove',id:l.id}],'Link undone.');
  });
  return r;
}
async function removeLink(st,kind,l){
  const a=kind==='parent'?l.child:l.a,b=kind==='parent'?l.parent:l.b;
  const ok=await confirmDialog('Remove this link?',`${nameOf(st.ix.sims[a])} and ${nameOf(st.ix.sims[b])} stay in the tree. Only the ${kind==='parent'?'parent':kind} link is removed.`,'Remove link',true);
  if(!ok)return;
  const owner=l.src==='owner';
  await write(st,[{op:'link_remove',id:l.id}],'Link removed.',async()=>{await write(st,[owner?linkRecreateOp(kind,l):{op:'link_restore',id:l.id}],'Link restored.');});
}
async function setLink(st,kind,l,value){
  const f=kind==='parent'?'type':'status',old=l[f];if(value===old)return;
  await write(st,[{op:'link_set',id:l.id,[f]:value}],'Changed.',async()=>{await write(st,[{op:'link_set',id:l.id,[f]:old}],'Change undone.');});
}
async function hideSim(st,id,hide){
  const n=nameOf(st.ix.sims[id]);
  if(hide){const ok=await confirmDialog('Hide '+n+'?','They will not be drawn in the tree. Their family links stay, and you can show them again from "Hidden sims".','Hide sim',false);if(!ok)return;}
  await write(st,[{op:'sim_hide',id,hidden:hide}],hide?n+' hidden.':n+' is visible again.',async()=>{await write(st,[{op:'sim_hide',id,hidden:!hide}],'Change undone.');});
}
async function deleteSim(st,id){
  const sim=st.ix.sims[id];if(!sim||sim.src!=='manual')return;
  const ok=await confirmDialog('Delete '+nameOf(sim)+'?','This permanently deletes the sim you added, together with the links you made for them. Sims from the game cannot be deleted; hide them instead.','Delete sim',true);
  if(!ok)return;
  const links={parents:(st.tree.parents||[]).filter(l=>l.child===id||l.parent===id),partners:(st.tree.partners||[]).filter(l=>l.a===id||l.b===id),friends:(st.tree.friends||[]).filter(l=>l.a===id||l.b===id)};
  const fields={};['first','last','gender','age','kind','species','life','cause','occults','traits','asp'].forEach(f=>{if(sim[f]!=null&&sim[f]!==''&&!(Array.isArray(sim[f])&&!sim[f].length))fields[f]=sim[f];});
  if(sim.notes)fields.notes=sim.notes;
  const wasSel=st.selected===id;
  const r=await write(st,[{op:'sim_delete',id}],nameOf(sim)+' deleted.',async()=>{
    const a=await write(st,[{op:'sim_add',sim:fields}]);const nid=a&&a.added&&a.added[0];if(!nid)return;
    const swap=x=>x===id?nid:x,ops=[];
    links.parents.forEach(l=>ops.push(linkRecreateOp('parent',{child:swap(l.child),parent:swap(l.parent),type:l.type})));
    links.partners.forEach(l=>ops.push(linkRecreateOp('partner',{a:swap(l.a),b:swap(l.b),status:l.status})));
    links.friends.forEach(l=>ops.push(linkRecreateOp('friend',{a:swap(l.a),b:swap(l.b)})));
    if(ops.length)await write(st,ops);
    toast(nameOf(sim)+' was brought back.');
  });
  if(r&&wasSel)closePanel(st);
}
async function resetField(st,id,field){
  const sim=st.ix.sims[id],prev=sim[field];
  await write(st,[{op:'sim_reset',id,field}],FIELD_LABEL[field]+': game value restored.',async()=>{await write(st,[{op:'sim_set',id,fields:{[field]:prev}}],'Change undone.');});
}
async function saveFields(st,id,fields){
  const sim=st.ix.sims[id],undoOps=[];
  Object.keys(fields).forEach(f=>{if((sim.edited||[]).includes(f))undoOps.push({op:'sim_set',id,fields:{[f]:sim[f]}});else undoOps.push({op:'sim_reset',id,field:f});});
  return write(st,[{op:'sim_set',id,fields}],'Details saved.',async()=>{await write(st,undoOps,'Change undone.');});
}

/* ---------- navigation ---------- */
function setHash(st){
  try{
    const p=new URLSearchParams(location.hash.slice(1));if(!p.get('family'))return;
    if(st.focus&&st.focus!==defaultFocus(st.tree,st.ix))p.set('sim',st.focus);else p.delete('sim');
    history.replaceState(null,'',location.pathname+location.search+'#'+p.toString());
  }catch(e){}
}
function refocus(st,id,opts={}){
  if(!st.ix.sims[id])return;
  if(id!==st.focus){if(!opts.noPush){st.stack.push(st.focus);if(st.stack.length>40)st.stack.shift();}st.focus=id;}
  st.selected=opts.keepSelected?st.selected:id;st.panelMode='sim';
  paint(st,{focusFocus:true});announce(st,'Focused on '+nameOf(st.ix.sims[id])+'.');setHash(st);
}
function goBack(st){if(!st.stack.length)return;st.focus=st.stack.pop();st.selected=null;st.panelMode='sim';paint(st,{focusFocus:true});announce(st,'Back to '+nameOf(st.ix.sims[st.focus])+'.');setHash(st);}
function crumbJump(st,i){ // i = index in stack; jump there and drop everything after
  const id=st.stack[i];if(!id)return;st.stack=st.stack.slice(0,i);st.focus=id;st.selected=null;paint(st,{focusFocus:true});setHash(st);
}
function select(st,id,opener){st.selected=id;st.panelMode='sim';paint(st);st.opener=$q(st.ui.stage,'[data-id="'+id+'"]')||opener||null;const c=$q(st.ui.panel,'.tv-panel-close');c&&c.focus({preventScroll:true});}
function closePanel(st){
  st.selected=null;st.panelMode='sim';st.form=null;paint(st);
  const oid=st.opener&&st.opener.dataset&&st.opener.dataset.id,o=(st.opener&&st.opener.isConnected?st.opener:null)||(oid&&$q(st.ui.stage,'[data-id="'+oid+'"]'))||$q(st.ui.stage,'.tv-focus .tv-sim');o&&o.focus({preventScroll:true});st.opener=null;
}
function announce(st,msg){st.ui.live.textContent='';setTimeout(()=>{if(st.ui.live)st.ui.live.textContent=msg;},20);}

/* ---------- bubbles ---------- */
function simLabel(st,id){
  const s=st.ix.sims[id];return [nameOf(s),isPet(s)?(s.species||'pet'):ageLabel(s.age),s.life==='dead'?'deceased':s.life==='ghost'?'ghost':''].filter(Boolean).join(', ');
}
const heirGen=(st,id)=>{const hs=(st.tree&&st.tree.heirs)||{};const k=Object.keys(hs).find(n=>str(hs[n])===id);return k?Number(k):0;};
/* a small round icon that can be focused and explains itself (see the tooltip block below) */
function tipIcon(sym,tip,tag,cls,attrs){
  const el=h(tag||'button',Object.assign({class:'tv-tip '+(cls||''),'data-tip':tip,'aria-label':tip},tag==='span'?{role:'img'}:{type:'button'},attrs||{}),h('span',{'aria-hidden':'true',text:sym}));
  return el;
}
function marksFor(st,id,extra={}){
  const s=st.ix.sims[id],m=[];
  if(isPet(s)){const sp=cap(s.species)||'Pet';m.push([petEmoji(s),sp,'species']);}
  if(s.life==='dead')m.push(['🪦','Deceased','dead']);else if(s.life==='ghost')m.push(['👻','Ghost','ghost']);
  const g=heirGen(st,id);if(g)m.push(['👑','Heir of generation '+g,'heir']);
  (s.occults||[]).slice(0,3).forEach(o=>{const k=str(o).toUpperCase();m.push([OCC_ICON[k]||'✨',occLabel(o),'occult']);});
  if(extra.ptype==='adopted')m.push(['🏠',extra.asParent?'Adoptive parent':'Adopted child','adopted']);
  if(extra.ptype==='step')m.push(['🧩',extra.asParent?'Step parent':'Step child','step']);
  return m;
}
function bubble(st,id,size,extra={}){
  const s=st.ix.sims[id];
  const b=h('button',{type:'button',class:`tv-sim s-${size}${s.life==='dead'?' dead':''}${s.life==='ghost'?' ghost':''}${isPet(s)?' pet':''}${st.selected===id?' selected':''}${st.ix.hidden.has(id)?' is-hidden':''}${extra.cls?' '+extra.cls:''}`,'data-id':id,title:`${nameOf(s)} (${tail(id)})`,'aria-label':simLabel(st,id)+(extra.aria?', '+extra.aria:''),style:extra.color?`--uc:${extra.color}`:null},
    pic(st,id,'big'),
    h('span',{class:'tv-nm',text:nameOf(s)}),
    h('span',{class:'tv-sb',text:isPet(s)?(s.species||'Pet'):ageLabel(s.age)}));
  b.addEventListener('click',e=>{if(e.detail>1)return;select(st,id,b);});
  b.addEventListener('dblclick',()=>refocus(st,id));
  b.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();refocus(st,id);}});
  const marks=marksFor(st,id,extra);
  const node=h('span',{class:`tv-node s-${size}`,'data-node':id});
  node.append(b);
  if(marks.length)node.append(h('span',{class:'tv-marks'},...marks.map(m=>tipIcon(m[0],m[1],'button','tv-mark',{'data-mark':m[2]}))));
  return node;
}
function statusSym(status,asText){
  const m=STATUS[status]||STATUS.unknown;
  return tipIcon(m.sym,m.label,asText?'span':'button','tv-status '+m.cls,{'data-status':status||'unknown'});
}

/* ---------- stage ---------- */
function ghostBtn(text,label,fn){return h('button',{class:'tv-ghost',type:'button','aria-label':label,onclick:fn},text);}
function paintStage(st){
  const ix=st.ix,f=st.focus,stage=st.ui.stage;
  if(st.ro){st.ro.disconnect();st.ro=null;}
  stage.textContent='';st.ui.canvas=st.ui.wires=null;
  if(!f||!ix.sims[f]){stage.append(h('p',{class:'tv-note',text:'This tree has no sims yet.'}),st.edit?h('button',{class:'tv-btn primary',type:'button',onclick:()=>openForm(st,null)},'+ Add Sim'):null);return;}
  const units=unitsOf(ix,f),partners=partnersOf(ix,f),colors=colorMap(ix,f,units,partners);
  const parents=parentsOf(ix,f),pets=petsOf(ix,f);
  st.visible=[f,...parents.map(l=>l.parent),...partners.map(p=>p.id),...units.flatMap(u=>u.children),...pets];if(st.selected)st.visible.push(st.selected);
  /* one canvas: the wires (svg) sit behind the nodes (.tv-tree) */
  const cv=h('div',{class:'tv-canvas'}),svg=document.createElementNS(NS,'svg');
  svg.setAttribute('class','tv-wires');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  const tree=h('div',{class:'tv-tree'});
  cv.append(svg,tree);stage.append(cv);st.ui.canvas=cv;st.ui.wires=svg;
  /* parents */
  const prow=h('div',{class:'tv-parents tv-zone','aria-label':'Parents'});
  parents.forEach(l=>prow.append(h('div',{class:'tv-pwrap'},bubble(st,l.parent,'sm',{ptype:l.type,asParent:true}),h('span',{class:'tv-tag',text:(PARENT_TYPES.find(t=>t[0]===l.type)||PARENT_TYPES[3])[1].replace(' parent','').replace(' (type unknown)','')}))));
  if(parents.length===2){
    const a=parents[0].parent,b=parents[1].parent,pl=(ix.pt.get(a)||[]).find(l=>other(l,a)===b);
    prow.dataset.couple=pl?pl.status||'unknown':'';
    if(pl)prow.append(statusSym(pl.status||'unknown'));
  }
  if(st.edit)prow.append(ghostBtn('＋ Parent','Add a parent',()=>openPicker(st,'parent',f)));
  if(prow.children.length)tree.append(h('div',{class:'tv-row-label tv-sr',text:'Parents'}),prow);
  /* focus, with pets beside it on a dotted line of their own */
  const core=h('div',{class:'tv-core'});
  if(pets.length||st.edit){
    const row=h('div',{class:'tv-pets tv-zone','aria-label':'Pets'},h('span',{class:'tv-pets-tag',text:'Pets'}),...pets.map(p=>bubble(st,p,'sm')));
    if(st.edit)row.append(ghostBtn('＋ Pet','Add a pet',()=>openPicker(st,'pet',f)));
    core.append(row);
  }
  core.append(h('div',{class:'tv-focus'},bubble(st,f,'xl',{cls:'focus'})));
  tree.append(core);
  /* one column per couple: partner on top, that couple's children right below */
  const rank=s=>({married:0,engaged:0,dating:0,coparent:1,unknown:1,ex:1,divorced:1,widowed:2})[s];
  const ordered=partners.map((p,i)=>({p,i})).sort((a,b)=>((rank(a.p.link.status)??1)-(rank(b.p.link.status)??1))||a.i-b.i).map(x=>x.p);
  const byPartner=new Map(),extra=[];
  units.forEach(u=>{const o=u.others[0];if(o&&ordered.some(p=>p.id===o)&&!byPartner.has(o))byPartner.set(o,u);else extra.push(u);});
  extra.sort((a,b)=>(a.others.length?0:1)-(b.others.length?0:1));
  const typeOf=k=>{const l=(ix.kids.get(f)||[]).find(x=>x.child===k);return l?l.type:'';};
  const unitEl=(u,c)=>{
    const lab=u.others.length?'with '+u.others.map(x=>ix.hidden.has(x)?'a hidden sim':nameOf(ix.sims[x])).join(' and '):'on their own',short=u.others.length?'with '+u.others.map(x=>ix.hidden.has(x)?'a hidden sim':(ix.sims[x].first||nameOf(ix.sims[x]))).join(' & '):'on their own';
    return h('div',{class:'tv-unit','data-unit':u.key,'data-with':u.others.join(','),role:'group','aria-label':`Children ${lab}`,style:`--uc:${c}`},
      h('span',{class:'tv-unit-label',text:short,title:lab}),h('div',{class:'tv-unit-kids'+(u.children.length>3?' wrap2':'')},...u.children.map(k=>bubble(st,k,'md',{ptype:typeOf(k)}))));
  };
  const cols=h('div',{class:'tv-kids tv-cols','aria-label':'Partners and children'});
  ordered.forEach(p=>{
    const c=colors.get(p.id),m=STATUS[p.link.status]||STATUS.unknown,u=byPartner.get(p.id);
    const box=h('div',{class:'tv-partner','data-partner':p.id,'data-status':p.link.status,style:`--uc:${c}`},bubble(st,p.id,'md',{color:c,aria:m.label}),
      h('span',{class:'tv-tag',text:m.label}),statusSym(p.link.status));
    if(st.edit)box.append(h('button',{class:'tv-btn small',type:'button','aria-label':'Remove the link with '+nameOf(ix.sims[p.id]),onclick:()=>removeLink(st,'partner',p.link)},'Unlink'));
    else box.append(h('button',{class:'tv-btn small subtree',type:'button','data-subtree':p.id,'aria-label':'Open subtree of '+nameOf(ix.sims[p.id]),onclick:()=>refocus(st,p.id)},'Open subtree'));
    cols.append(h('div',{class:'tv-col','data-col':p.id},box,u?unitEl(u,c):null));
  });
  extra.forEach(u=>{
    const o=u.others[0],known=o&&ix.sims[o]&&!ix.hidden.has(o),c=o?colors.get(o)||SOLO_COLOR:SOLO_COLOR;
    const head=known?h('div',{class:'tv-partner tv-nolink',style:`--uc:${c}`},bubble(st,o,'md',{color:c}),h('span',{class:'tv-tag',text:'Not linked as a partner'}))
      :h('div',{class:'tv-partner tv-ph'},h('span',{class:'tv-ph-t',text:o?'Hidden sim':'Other parent unknown'}));
    cols.append(h('div',{class:'tv-col tv-hangcol','data-col':'hang:'+u.key},head,unitEl(u,c)));
  });
  if(st.edit){
    cols.append(h('div',{class:'tv-col new'},ghostBtn('＋ Partner','Add a partner',()=>openPicker(st,'partner',f)),h('div',{class:'tv-unit new'},ghostBtn('＋ Child','Add a child',()=>openPicker(st,'child',f)))));
  }
  if(cols.children.length)tree.append(h('div',{class:'tv-row-label tv-sr',text:'Partners and children'}),cols);
  else tree.append(h('p',{class:'tv-note tv-nokids',text:'No partners or children recorded for '+nameOf(ix.sims[f])+'.'}));
  /* wires: draw now, and again whenever the layout can change */
  drawWires(st);scheduleWires(st);
  if(window.ResizeObserver){st.ro=new ResizeObserver(()=>scheduleWires(st));st.ro.observe(cv);st.ro.observe(stage);}
  cv.addEventListener('load',()=>scheduleWires(st),true);
}

/* ---------- wires: one svg behind the nodes, coordinates measured from the rendered DOM ---------- */
const NS='http://www.w3.org/2000/svg';
function sv(name,attrs){const e=document.createElementNS(NS,name);Object.keys(attrs||{}).forEach(k=>{if(attrs[k]!=null)e.setAttribute(k,attrs[k]);});return e;}
const isNarrow=()=>window.innerWidth<=700;
const r1=n=>Math.round(n*10)/10;
function roundedPath(pts,r){
  const p=pts.filter((q,i)=>!i||Math.abs(q[0]-pts[i-1][0])>.01||Math.abs(q[1]-pts[i-1][1])>.01);
  let d=`M${r1(p[0][0])} ${r1(p[0][1])}`;
  for(let i=1;i<p.length-1;i++){
    const a=p[i-1],b=p[i],c=p[i+1],l1=Math.hypot(b[0]-a[0],b[1]-a[1]),l2=Math.hypot(c[0]-b[0],c[1]-b[1]),rr=Math.min(r==null?10:r,l1/2,l2/2);
    if(rr<1){d+=` L${r1(b[0])} ${r1(b[1])}`;continue;}
    d+=` L${r1(b[0]+(a[0]-b[0])/l1*rr)} ${r1(b[1]+(a[1]-b[1])/l1*rr)} Q${r1(b[0])} ${r1(b[1])} ${r1(b[0]+(c[0]-b[0])/l2*rr)} ${r1(b[1]+(c[1]-b[1])/l2*rr)}`;
  }
  const z=p[p.length-1];return p.length>1?d+` L${r1(z[0])} ${r1(z[1])}`:d;
}
function scheduleWires(st){
  if(st.wireRaf)return;
  const raf=window.requestAnimationFrame?window.requestAnimationFrame.bind(window):f=>setTimeout(f,16);
  st.wireRaf=raf(()=>{st.wireRaf=0;if(alive(st))drawWires(st);});
}
/* Layout rules: parents -> focus; focus -> a horizontal bus; one column per couple hangs from the bus (partner on top, its
   children right below). Every line is a short straight piece between two neighbours, so nothing crosses or overlaps. */
function drawWires(st){
  const cv=st.ui.canvas,svg=st.ui.wires;if(!cv||!svg||!cv.isConnected)return;
  const cr=cv.getBoundingClientRect(),narrow=isNarrow();
  const R=el=>{const r=el.getBoundingClientRect();return {l:r.left-cr.left,r:r.right-cr.left,t:r.top-cr.top,b:r.bottom-cr.top,cx:(r.left+r.right)/2-cr.left,cy:(r.top+r.bottom)/2-cr.top,w:r.width,h:r.height};};
  const Q=(root,sel)=>[...root.querySelectorAll(sel)];
  const W=Math.max(cv.scrollWidth,Math.round(cr.width)),H=Math.max(cv.scrollHeight,Math.round(cr.height));
  svg.textContent='';svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const focusSim=cv.querySelector('.tv-focus .tv-sim');if(!focusSim)return;
  const fp=R(focusSim.querySelector('.tv-pic')),fb=R(focusSim).b;
  const group=(cls,attrs)=>{const g=sv('g',Object.assign({class:cls,fill:'none','stroke-linecap':'round','stroke-linejoin':'round'},attrs));svg.append(g);return g;};
  const line=(g,pts,o={})=>{
    const p=sv('path',{class:'tv-wire '+(o.cls||''),d:roundedPath(pts,o.r==null?0:o.r),'stroke-width':o.w||3});
    if(o.dash)p.setAttribute('stroke-dasharray',o.dash);
    if(o.kind)p.setAttribute('data-style',o.kind);
    if(o.op!=null)p.setAttribute('stroke-opacity',o.op);
    g.append(p);return p;
  };
  const statusLine=(g,pts,status,cls)=>{
    const k=(STATUS[status]||STATUS.unknown).line;
    return line(g,pts,{cls:(cls||'tv-link')+' is-'+k,kind:k,dash:LINE_DASH[k]||null,w:k==='muted'?2.5:3.5,op:k==='muted'?.55:null});
  };
  const place=(badge,host,x,y)=>{if(!badge||!host)return;const hr=R(host);badge.style.left=r1(x-hr.l-15)+'px';badge.style.top=r1(y-hr.t-15)+'px';badge.classList.add('on-line');};
  /* parents -> focus */
  const prow=cv.querySelector('.tv-parents'),pws=prow?Q(prow,'.tv-pwrap'):[];
  if(pws.length){
    const g=group('tv-parents-wire',{'data-kind':'parents'}),pics=pws.map(w=>R(w.querySelector('.tv-pic'))).sort((a,b)=>a.cx-b.cx),bots=pws.map(w=>R(w).b),maxB=Math.max(...bots);
    const ym=Math.max(maxB+8,(maxB+fp.t)/2);let S;
    if(pws.length===2){
      const y=(pics[0].cy+pics[1].cy)/2,mx=(pics[0].r+pics[1].l)/2,status=prow.dataset.couple;
      if(status)statusLine(g,[[pics[0].r+1,y],[pics[1].l-1,y]],status);else line(g,[[pics[0].r+1,y],[pics[1].l-1,y]],{cls:'tv-link is-solid',kind:'solid'});
      place(prow.querySelector('.tv-status'),prow,mx,y);S=[mx,y];
    }else if(pws.length===1){S=[pics[0].cx,bots[0]+2];}
    else{
      const y=maxB+10;pws.forEach(w=>{const q=R(w),pc=R(w.querySelector('.tv-pic'));line(g,[[pc.cx,q.b+2],[pc.cx,y]]);});
      line(g,[[pics[0].cx,y],[pics[pics.length-1].cx,y]]);S=[(pics[0].cx+pics[pics.length-1].cx)/2,y];
    }
    line(g,[S,[S[0],ym],[fp.cx,ym],[fp.cx,fp.t-3]],{r:10});
  }
  /* columns */
  const cols=Q(cv,'.tv-kids > .tv-col[data-col]');
  if(cols.length){
    const info=cols.map(col=>{
      const head=col.querySelector('.tv-partner'),hr=R(head),u=col.querySelector('.tv-unit[data-with]'),pid=head.dataset.partner||'';
      const c=(head.style.getPropertyValue('--uc')||'').trim()||SOLO_COLOR;
      return {col,head,hr,u,pid,c,status:head.dataset.status||'',cx:hr.cx};
    });
    const colTop=Math.min(...info.map(i=>i.hr.t));
    const busY=Math.max(fb+16,colTop-54),spineX=14;
    info.forEach((i,k)=>{
      const g=group('tv-couple'+(i.pid?'':' tv-hang'),{'data-with':i.pid||(i.u?i.u.dataset.with:''),'data-status':i.status,stroke:i.pid?i.c:i.c});
      i.g=g;
      /* desktop: a drop from the bus; phone: a short branch from the left spine. The status badge sits on it. */
      let from,to;
      if(!narrow){from=[i.cx,busY];to=[i.cx,i.hr.t-1];}
      else{from=[spineX,i.hr.cy];to=[i.hr.l-1,i.hr.cy];}
      const mid=[(from[0]+to[0])/2,(from[1]+to[1])/2];
      if(i.pid)statusLine(g,[from,to],i.status);
      else line(g,[from,to],{cls:'tv-link is-solid',kind:'solid',w:2.5,op:.6});
      if(narrow)g.append(sv('circle',{cx:r1(from[0]),cy:r1(from[1]),r:4.5,fill:i.c,stroke:'none'}));
      if(i.pid)place(i.head.querySelector('.tv-status'),i.head,mid[0],mid[1]);
      /* partner -> this couple's children */
      if(!i.u)return;
      const lr=R(i.u.querySelector('.tv-unit-label')),pics=Q(i.u,'.tv-unit-kids .tv-pic').map(R).sort((a,b)=>a.t-b.t||a.cx-b.cx),rows=[];
      pics.forEach(p=>{const last=rows[rows.length-1];if(last&&Math.abs(last.top-p.t)<10)last.p.push(p);else rows.push({top:p.t,p:[p]});});
      if(!rows.length)return;
      line(g,[[i.cx,i.hr.b+1],[i.cx,lr.t-1]],{cls:'tv-descent'});
      const bars=rows.map((r,ri)=>ri?r.top-18:lr.cy);
      rows.forEach((r,ri)=>{
        const xs=r.p.map(p=>p.cx).sort((a,b)=>a-b),y=bars[ri];
        if(xs[xs.length-1]-xs[0]>1)line(g,[[xs[0],y],[xs[xs.length-1],y]]);
        xs.forEach(x=>line(g,[[x,y],[x,r.top-3]]));
      });
      /* two per row: one short trunk between the pair joins the rows */
      if(rows.length>1)line(g,[[i.cx,lr.cy],[i.cx,bars[bars.length-1]]]);
    });
    if(narrow){
      const g=group('tv-bus-wire',{'data-kind':'spine'}),lastY=Math.max(...info.map(i=>i.hr.cy));
      line(g,[[fp.cx,fb+2],[fp.cx,fb+16],[spineX,fb+16],[spineX,lastY]],{r:10});
    }else{
      const g=group('tv-bus-wire',{'data-kind':'bus'}),xs=[fp.cx,...info.map(i=>i.cx)];
      line(g,[[fp.cx,fb+2],[fp.cx,busY]]);
      if(Math.max(...xs)-Math.min(...xs)>1)line(g,[[Math.min(...xs),busY],[Math.max(...xs),busY]]);
    }
  }
  /* pets hang on a dotted line of their own */
  const pr=cv.querySelector('.tv-pets');
  if(pr&&pr.querySelector('.tv-sim')){
    const g=group('tv-pets-wire',{'data-kind':'pets'}),prr=R(pr),y=Math.max(fp.t+10,Math.min(fp.b-10,prr.cy));
    line(g,[[fp.l-1,y],[prr.r+2,y]],{dash:'1.5 7',kind:'dotted',cls:'tv-link is-dotted'});
  }
}

/* ---------- tooltips: every icon explains itself (hover, keyboard focus, tap) ---------- */
function setupTips(st){
  let tip=null,cur=null;
  const root=el=>el&&el.closest&&el.closest('.tv');
  const ensure=()=>{if(!tip){tip=h('div',{class:'tv tv-tooltip',role:'tooltip',id:'tv-tooltip',hidden:true});document.body.append(tip);}return tip;};
  const hide=()=>{if(cur){cur.removeAttribute('aria-describedby');cur=null;}if(tip){tip.hidden=true;tip.classList.remove('on');}};
  const show=el=>{
    const t=el.getAttribute('data-tip');if(!t)return;
    if(cur&&cur!==el)cur.removeAttribute('aria-describedby');
    cur=el;const b=ensure();b.textContent=t;b.hidden=false;el.setAttribute('aria-describedby','tv-tooltip');
    const r=el.getBoundingClientRect(),tr=b.getBoundingClientRect(),vw=document.documentElement.clientWidth||window.innerWidth||1024;
    let left=r.left+r.width/2-tr.width/2;left=Math.max(8,Math.min(left,vw-tr.width-8));
    let top=r.top-tr.height-9,below=false;if(top<8){top=r.bottom+9;below=true;}
    b.style.left=Math.round(left)+'px';b.style.top=Math.round(top)+'px';
    b.style.setProperty('--ax',Math.round(r.left+r.width/2-left)+'px');b.classList.toggle('below',below);b.classList.add('on');
  };
  const near=e=>{const el=e.target&&e.target.closest?e.target.closest('[data-tip]'):null;return el&&root(el)&&(root(el)===st.shell||root(el)===st.ui.sheet)?el:null;};
  const on={
    mouseover:e=>{const el=near(e);if(el)show(el);},
    mouseout:e=>{const el=near(e);if(el&&cur===el&&!(e.relatedTarget&&el.contains(e.relatedTarget)))hide();},
    focusin:e=>{const el=near(e);if(el)show(el);},
    focusout:e=>{const el=near(e);if(el&&cur===el)hide();},
    click:e=>{const el=near(e);if(el)show(el);},
    touchstart:e=>{const el=near(e);if(el)show(el);},
    pointerdown:e=>{if(e.pointerType==='touch'&&cur&&!near(e))hide();},
    keydown:e=>{if(e.key==='Escape')hide();},
    scroll:()=>hide()
  };
  Object.keys(on).forEach(k=>document.addEventListener(k,on[k],k==='scroll'||k==='touchstart'?{capture:true,passive:true}:true));
  return ()=>{Object.keys(on).forEach(k=>document.removeEventListener(k,on[k],k==='scroll'||k==='touchstart'?{capture:true}:true));hide();if(tip){tip.remove();tip=null;}};
}

/* ---------- header, strip, search ---------- */
function paintHead(st){
  const ui=st.ui,ix=st.ix;
  ui.back.disabled=!st.stack.length;
  ui.crumbs.textContent='';
  st.stack.forEach((id,i)=>{ui.crumbs.append(h('li',{},h('button',{type:'button',class:'tv-crumb',onclick:()=>crumbJump(st,i),text:nameOf(ix.sims[id])})));});
  ui.crumbs.append(h('li',{'aria-current':'page'},h('b',{class:'tv-crumb cur',text:nameOf(ix.sims[st.focus])})));
  /* heirs */
  ui.strip.textContent='';
  const gens=Object.keys(st.tree.heirs||{}).map(Number).filter(n=>n>0&&ix.sims[str(st.tree.heirs[n])]).sort((a,b)=>a-b);
  gens.forEach(n=>{const id=str(st.tree.heirs[n]);ui.strip.append(h('button',{type:'button',class:'tv-chip'+(id===st.focus?' on':''),'data-gen':n,'aria-pressed':String(id===st.focus),onclick:()=>refocus(st,id)},`Gen ${n} · ${nameOf(ix.sims[id])}`));});
  ui.stripWrap.hidden=!gens.length;
  /* edit */
  const can=!!st.tree.canEdit;
  ui.editWrap.hidden=!can;
  ui.sw.setAttribute('aria-checked',String(!!st.edit));
  ui.banner.hidden=!st.edit;
  ui.hiddenBtn.hidden=!(st.edit&&st.ix.hidden.size);ui.hiddenBtn.textContent=`Hidden sims (${st.ix.hidden.size})`;
  ui.owner.value=st.owner;
}
function runSearch(st,go){
  const q=st.ui.search.value.trim().toLowerCase(),box=st.ui.results;box.textContent='';
  if(!q){box.hidden=true;return;}
  const ms=Object.keys(st.ix.sims).filter(i=>nameOf(st.ix.sims[i]).toLowerCase().includes(q)).sort((a,b)=>nameOf(st.ix.sims[a]).localeCompare(nameOf(st.ix.sims[b]))).slice(0,10);
  if(go&&ms.length){st.ui.search.value='';box.hidden=true;refocus(st,ms[0]);return;}
  if(!ms.length)box.append(h('li',{class:'tv-none',text:'No sim with that name.'}));
  ms.forEach(i=>box.append(h('li',{},h('button',{type:'button',class:'tv-res',onclick:()=>{st.ui.search.value='';box.hidden=true;refocus(st,i);}},pic(st,i,'mini'),h('span',{},h('b',{text:nameOf(st.ix.sims[i])}),h('small',{text:[ageLabel(st.ix.sims[i].age),tail(i),st.ix.hidden.has(i)?'hidden':''].filter(Boolean).join(' · ')}))))));
  box.hidden=false;
}

/* ---------- side panel ---------- */
function section(st,title,kind,id,rows,addFn,addLabel){
  const sec=h('section',{class:'tv-sec','data-sec':kind},h('div',{class:'tv-sec-head'},h('h3',{text:title}),st.edit&&addFn?h('button',{class:'tv-btn small',type:'button','data-add':kind,'aria-label':addLabel||('Add '+title.toLowerCase()),onclick:addFn},'Add'):null));
  if(rows.length)sec.append(h('ul',{class:'tv-list'},...rows));else sec.append(h('p',{class:'tv-empty',text:'None yet.'}));
  return sec;
}
function row(st,id,note,actions,extraCls){
  const s=st.ix.sims[id];
  const open=h('button',{type:'button',class:'tv-rowbtn',onclick:e=>select(st,id,e.currentTarget),ondblclick:()=>refocus(st,id),'aria-label':`${nameOf(s)}${note?', '+note:''}. Open sim card`},pic(st,id,'mini'),h('span',{},h('b',{text:nameOf(s)}),h('small',{text:[note,ageLabel(s.age),tail(id)].filter(Boolean).join(' · ')})));
  return h('li',{class:'tv-row '+(extraCls||'')},open,...(actions||[]).filter(Boolean));
}
function selectOf(options,value,label,fn){
  const s=h('select',{class:'tv-sel','aria-label':label},...options.map(o=>h('option',{value:o[0],text:o[1],selected:o[0]===value})));
  s.addEventListener('change',()=>fn(s.value));return s;
}
function infoRow(st,sim,field,valueText,canReset){
  if(valueText===''||valueText==null)return null;
  const edited=(sim.edited||[]).includes(field);
  const dd=h('dd',{},h('span',{text:valueText}));
  if(edited){
    dd.append(h('span',{class:'tv-edited',title:'You changed this. The game says: '+fmtGame(sim.gameValues&&sim.gameValues[field])},'edited'));
    if(st.edit&&canReset)dd.append(h('button',{class:'tv-link',type:'button','data-reset':field,onclick:()=>resetField(st,sim.id,field)},'Use game value'));
  }
  return h('div',{class:'tv-info-row'},h('dt',{text:FIELD_LABEL[field]}),dd);
}
function fmtGame(v){return Array.isArray(v)?(v.map(cap).join(', ')||'none'):(v==null||v===''?'nothing':str(v));}
const motionOK=()=>{try{return typeof matchMedia==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}};
/* the sim card is an overlay sheet: position:fixed, transform + opacity only, so the tree never reflows */
function setSheet(st,open){
  const sheet=st.ui.sheet,bd=st.ui.backdrop;
  if(open===!!st.sheetOpen)return;
  st.sheetOpen=open;clearTimeout(st.sheetT);
  st.shell.classList.toggle('tv-has-panel',open);
  if(open){
    sheet.hidden=false;bd.hidden=false;document.documentElement.classList.add('tv-panel-open');
    void sheet.offsetWidth;
    sheet.classList.add('is-open');bd.classList.add('is-open');
  }else{
    sheet.classList.remove('is-open');bd.classList.remove('is-open');
    const done=()=>{if(st.sheetOpen)return;sheet.hidden=true;bd.hidden=true;document.documentElement.classList.remove('tv-panel-open');};
    if(motionOK())st.sheetT=setTimeout(done,420);else done();
  }
}
function paintPanel(st){
  const p=st.ui.panel,ix=st.ix;
  const open=!!(st.panelMode==='form'||(st.selected&&ix.sims[st.selected]));
  const key=open?st.panelMode+':'+(st.panelMode==='form'?(st.form&&st.form.editId)||'new':st.selected):'';
  const same=key===st.panelKey,scroll=p.scrollTop;let ghost=null;
  /* switching between two sims cross-fades the content; the sheet itself does not move */
  if(open&&st.sheetOpen&&!same&&motionOK()){ghost=p.cloneNode(true);ghost.className='tv-panel-body tv-panel-ghost';ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));ghost.setAttribute('aria-hidden','true');ghost.setAttribute('inert','');}
  st.panelKey=key;p.textContent='';
  setSheet(st,open);
  if(!open)return;
  if(ghost){const sh=st.ui.sheet;sh.append(ghost);ghost.scrollTop=scroll;setTimeout(()=>ghost.remove(),260);p.classList.remove('tv-fadein');void p.offsetWidth;p.classList.add('tv-fadein');}
  if(st.panelMode==='form'){renderForm(st);p.scrollTop=same?scroll:0;return;}
  const id=st.selected,sim=ix.sims[id];
  const close=h('button',{class:'tv-x tv-panel-close',type:'button','aria-label':'Close sim card',onclick:()=>closePanel(st)},'✕');
  const nameEdited=(sim.edited||[]).some(f=>f==='first'||f==='last');
  const life=sim.life==='dead'?'🪦 Deceased':sim.life==='ghost'?'👻 Ghost':'Alive';
  const head=h('div',{class:'tv-card-head'},pic(st,id,'xxl'),h('div',{class:'tv-card-title'},h('h2',{text:nameOf(sim)}),
    h('p',{class:'tv-life',text:[life,sim.inHousehold?'In the household':'',st.ix.hidden.has(id)?'Hidden':'',sim.src==='manual'?'Added by hand':''].filter(Boolean).join(' · ')}),
    nameEdited?h('span',{class:'tv-edited',text:'edited'}):null));
  p.append(h('div',{class:'tv-panel-bar'},h('span',{class:'tv-kicker',text:isPet(sim)?'Pet card':'Sim card'}),close),head);
  const acts=h('div',{class:'tv-actions wrap'});
  if(id!==st.focus)acts.append(h('button',{class:'tv-btn primary',type:'button','data-act':'focus',onclick:()=>refocus(st,id)},'Focus on '+(sim.first||'this sim')));
  if(st.tree.canEdit){
    const fileIn=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp',class:'tv-file','aria-label':'Choose a portrait photo',hidden:true});
    fileIn.addEventListener('change',()=>{if(fileIn.files&&fileIn.files[0])uploadPhoto(st,id,fileIn.files[0]);});
    acts.append(fileIn,h('button',{class:'tv-btn',type:'button','data-act':'upload',onclick:()=>fileIn.click()},st.pAvail.has(id)?'Change photo':'Add photo'));
    if(st.pAvail.get(id)>=0&&st.pAvail.has(id))acts.append(h('button',{class:'tv-btn',type:'button','data-act':'remove-photo',onclick:()=>removePhoto(st,id)},'Remove photo'));
  }
  p.append(acts,h('p',{class:'tv-note small',role:'status',id:'tv-photo-msg'}));
  /* relationships */
  const parents=parentsOf(ix,id).map(l=>row(st,l.parent,(PARENT_TYPES.find(t=>t[0]===l.type)||PARENT_TYPES[3])[1],st.edit?[selectOf(PARENT_TYPES,l.type,'Parent type',v=>setLink(st,'parent',l,v)),h('button',{class:'tv-btn small',type:'button','aria-label':'Remove parent link to '+nameOf(ix.sims[l.parent]),onclick:()=>removeLink(st,'parent',l)},'Remove')]:null));
  p.append(section(st,'Parents','parents',id,parents,()=>openPicker(st,'parent',id)));
  const partners=partnersOf(ix,id).map(q=>{const m=STATUS[q.link.status]||STATUS.unknown;
    return row(st,q.id,m.label,st.edit?[selectOf(Object.keys(STATUS).map(k=>[k,STATUS[k].label]),q.link.status,'Relationship status',v=>setLink(st,'partner',q.link,v)),h('button',{class:'tv-btn small',type:'button','aria-label':'Remove partner link to '+nameOf(ix.sims[q.id]),onclick:()=>removeLink(st,'partner',q.link)},'Remove')]:null);});
  const prow=partnersOf(ix,id).map((q,i)=>{const li=partners[i];$q(li,'.tv-rowbtn').prepend(statusSym(q.link.status,true));return li;});
  p.append(section(st,'Partners','partners',id,prow,()=>openPicker(st,'partner',id)));
  const kidLinks=(ix.kids.get(id)||[]).filter(l=>!isPet(ix.sims[l.child])&&!ix.hidden.has(l.child)).sort((a,b)=>sortAge(a.child,b.child,ix.sims));
  const kids=kidLinks.map(l=>{const o=(ix.par.get(l.child)||[]).map(x=>x.parent).filter(x=>x!==id&&ix.sims[x]);return row(st,l.child,o.length?'with '+o.map(x=>ix.hidden.has(x)?'a hidden sim':nameOf(ix.sims[x])).join(' and '):'',st.edit?[h('button',{class:'tv-btn small',type:'button','aria-label':'Remove child link to '+nameOf(ix.sims[l.child]),onclick:()=>removeLink(st,'parent',l)},'Remove')]:null);});
  p.append(section(st,'Children','children',id,kids,()=>openPicker(st,'child',id)));
  const fr=(ix.fr.get(id)||[]).map(l=>({l,o:other(l,id)})).filter(x=>ix.sims[x.o]&&!ix.hidden.has(x.o)).map(x=>row(st,x.o,'Friend',st.edit?[h('button',{class:'tv-btn small',type:'button','aria-label':'Remove friendship with '+nameOf(ix.sims[x.o]),onclick:()=>removeLink(st,'friend',x.l)},'Remove')]:null));
  p.append(section(st,'Friends','friends',id,fr,()=>openPicker(st,'friend',id)));
  const pets=petsOf(ix,id).map(pid=>{const l=(ix.kids.get(id)||[]).find(x=>x.child===pid);return row(st,pid,(ix.sims[pid].species||'Pet'),st.edit?[h('button',{class:'tv-btn small',type:'button','aria-label':'Remove pet link to '+nameOf(ix.sims[pid]),onclick:()=>removeLink(st,'parent',l)},'Remove')]:null);});
  p.append(section(st,'Pets','pets',id,pets,()=>openPicker(st,'pet',id)));
  /* information */
  const dl=h('dl',{class:'tv-info'});
  const rows=[
    infoRow(st,sim,'kind',isPet(sim)?'Pet':'Person',true),
    isPet(sim)?infoRow(st,sim,'species',cap(sim.species),true):null,
    infoRow(st,sim,'gender',cap(sim.gender),true),
    infoRow(st,sim,'age',ageLabel(sim.age),true),
    infoRow(st,sim,'life',life.replace(/^\S+\s/,''),true),
    infoRow(st,sim,'occults',(sim.occults||[]).map(occLabel).join(', '),true),
    infoRow(st,sim,'traits',(sim.traits||[]).map(cap).join(', '),true),
    infoRow(st,sim,'asp',cap(sim.asp),true),
    sim.life!=='alive'||sim.cause?infoRow(st,sim,'cause',sim.cause?cap(sim.cause):'',true):null
  ].filter(Boolean);
  rows.forEach(r=>dl.append(r));
  (sim.edited||[]).filter(f=>['first','last'].includes(f)).forEach(f=>{dl.append(infoRow(st,sim,f,str(sim[f])||'(empty)',true)||'');});
  p.append(h('section',{class:'tv-sec','data-sec':'info'},h('div',{class:'tv-sec-head'},h('h3',{text:'Information'}),st.edit?h('button',{class:'tv-btn small',type:'button','data-act':'edit-details',onclick:()=>openForm(st,id)},'Edit details'):null),rows.length?dl:h('p',{class:'tv-empty',text:'Nothing recorded.'})));
  /* destructive actions are separate and only in edit mode */
  if(st.edit){
    const dz=h('section',{class:'tv-sec tv-danger','data-sec':'danger'},h('h3',{text:'Manage this sim'}));
    const hid=st.ix.hidden.has(id);
    dz.append(h('div',{class:'tv-actions wrap'},
      h('button',{class:'tv-btn',type:'button','data-act':'hide',onclick:()=>hideSim(st,id,!hid)},hid?'Show sim again':'Hide sim'),
      sim.src==='manual'?h('button',{class:'tv-btn danger',type:'button','data-act':'delete',onclick:()=>deleteSim(st,id)},'Delete sim'):null),
      h('p',{class:'tv-note small',text:'Remove a link with the Remove buttons above. Hiding keeps every link. Only sims you added by hand can be deleted.'}));
    p.append(dz);
  }
  p.scrollTop=same?scroll:0;
}
async function uploadPhoto(st,id,file){
  const msg=$q(st.ui.panel,'#tv-photo-msg');const say=t=>{if(alive(st)&&msg&&msg.isConnected)msg.textContent=t;};
  try{
    say('Preparing photo…');const image=await preparePortrait(file);
    say('Saving…');const r=await api('portrait',{action:'put',owner:st.owner,simId:id,image,ifAt:st.pAvail.get(id)||0});
    if(!alive(st))return;const at=r&&photoOk(r.at)?r.at:Date.now();
    st.pAvail.set(id,at);st.pImg.set(id,image);IMG_CACHE.set(cacheKey(st,id,at),image);applyPic(st,id);paintPanel(st);
    const m2=$q(st.ui.panel,'#tv-photo-msg');if(m2)m2.textContent='Photo saved.';
  }catch(e){say(e.message==='unsupported-image'?'Choose a JPEG, PNG or WebP image.':e.code==='portrait_conflict'||e.message==='409'?'The photo changed on another device. Reload and try again.':e.message==='404'?'Photo support is not available yet.':'Could not save the photo.');}
}
async function removePhoto(st,id){
  const msg=$q(st.ui.panel,'#tv-photo-msg');
  try{
    await api('portrait',{action:'remove',owner:st.owner,simId:id,ifAt:st.pAvail.get(id)||0});
    if(!alive(st))return;st.pAvail.delete(id);st.pImg.delete(id);applyPic(st,id);paintPanel(st);
  }catch(e){if(msg)msg.textContent=e.code==='portrait_conflict'||e.message==='409'?'The photo changed on another device. Reload and try again.':'Could not remove the photo.';}
}

/* ---------- picker ---------- */
function openPicker(st,kind,forId){
  const ix=st.ix,me=ix.sims[forId];
  const cfg={
    parent:{title:'Add a parent for '+nameOf(me),opts:PARENT_TYPES,label:'Parent type',def:'birth'},
    child:{title:'Add a child for '+nameOf(me),opts:PARENT_TYPES,label:'Parent type',def:'birth'},
    partner:{title:'Add a partner for '+nameOf(me),opts:Object.keys(STATUS).map(k=>[k,STATUS[k].label]),label:'Relationship status',def:'dating'},
    friend:{title:'Add a friend for '+nameOf(me),opts:null},
    pet:{title:'Add a pet for '+nameOf(me),opts:null}
  }[kind];
  const linked=new Set();
  if(kind==='parent')(ix.par.get(forId)||[]).forEach(l=>linked.add(l.parent));
  if(kind==='child'||kind==='pet')(ix.kids.get(forId)||[]).forEach(l=>linked.add(l.child));
  if(kind==='partner')(ix.pt.get(forId)||[]).forEach(l=>linked.add(other(l,forId)));
  if(kind==='friend')(ix.fr.get(forId)||[]).forEach(l=>linked.add(other(l,forId)));
  const desc=descendants(ix,forId),anc=ancestors(ix,forId);
  const cands=Object.keys(ix.sims).filter(i=>{
    if(i===forId||linked.has(i)||ix.hidden.has(i))return false;
    const pet=isPet(ix.sims[i]);
    if(kind==='pet')return pet;
    if(kind==='parent')return !pet&&!desc.has(i);
    if(kind==='child')return !pet&&!anc.has(i);
    if(kind==='partner')return !pet;
    return true;
  }).sort((a,b)=>nameOf(ix.sims[a]).localeCompare(nameOf(ix.sims[b]))||a.localeCompare(b));
  const sel=cfg.opts?selectOf(cfg.opts,cfg.def,cfg.label,()=>{}):null;
  const search=h('input',{type:'search',class:'tv-input','aria-label':'Search sims in this tree',placeholder:'Search sims in this tree'});
  const list=h('ul',{class:'tv-pick-list',role:'list'});
  let m;
  const pick=id=>{
    const v=sel?sel.value:null;m.close();
    if(kind==='parent')addLink(st,'parent',{child:forId,parent:id,type:v});
    else if(kind==='child')addLink(st,'parent',{child:id,parent:forId,type:v});
    else if(kind==='pet')addLink(st,'parent',{child:id,parent:forId,type:'unknown'});
    else if(kind==='partner')addLink(st,'partner',{a:forId,b:id,status:v});
    else addLink(st,'friend',{a:forId,b:id});
  };
  const fill=()=>{
    const q=search.value.trim().toLowerCase();list.textContent='';
    const ms=cands.filter(i=>!q||nameOf(ix.sims[i]).toLowerCase().includes(q));
    if(!ms.length)list.append(h('li',{class:'tv-none',text:cands.length?'No sim with that name. You can create a new one below.':'No other sims in this tree yet. Create a new one below.'}));
    ms.slice(0,60).forEach(i=>{const s=ix.sims[i];list.append(h('li',{},h('button',{type:'button',class:'tv-res','data-pick':i,onclick:()=>pick(i)},pic(st,i,'mini'),h('span',{},h('b',{text:nameOf(s)}),h('small',{text:[isPet(s)?(s.species||'Pet'):ageLabel(s.age),s.life==='dead'?'deceased':s.life==='ghost'?'ghost':'',tail(i)].filter(Boolean).join(' · ')})))));});
  };
  search.addEventListener('input',fill);
  const create=h('button',{class:'tv-btn primary',type:'button','data-act':'create',onclick:()=>{const v=sel?sel.value:null;m.close();openForm(st,null,{kind,forId,value:v});}},kind==='pet'?'Create a new pet':'Create a new sim');
  m=modal(cfg.title,[sel?h('label',{class:'tv-field'},h('span',{text:cfg.label}),sel):null,h('label',{class:'tv-field'},h('span',{text:'Choose a sim already in this tree'}),search),list,h('div',{class:'tv-actions'},create)]);
  m.el.classList.add('tv-picker');fill();
  /* photos for the listed sims */
  cands.slice(0,12).forEach(i=>{if(!st.visible.includes(i))st.visible.push(i);});wantPhotos(st);
}

/* ---------- add / edit form (in the side panel) ---------- */
function openForm(st,editId,relation){
  st.panelMode='form';st.form={editId,relation:relation||null,file:null,preview:''};st.selected=editId||st.selected;paint(st);
  const f=$q(st.ui.panel,'input[name=first]');f&&f.focus();
}
function renderForm(st){
  const p=st.ui.panel,F=st.form,sim=F.editId?st.ix.sims[F.editId]:null,ix=st.ix;
  const v=(k,d='')=>sim&&sim[k]!=null?sim[k]:d;
  const close=h('button',{class:'tv-x tv-panel-close',type:'button','aria-label':'Close form',onclick:()=>cancelForm(st)},'✕');
  p.append(h('div',{class:'tv-panel-bar'},h('span',{class:'tv-kicker',text:sim?'Edit details':'Add a sim'}),close));
  const form=h('form',{class:'tv-form',novalidate:true,'aria-label':sim?'Edit '+nameOf(sim):'Add a sim'});
  const err=h('p',{class:'tv-error',role:'alert',hidden:true});
  const fld=(label,ctl,cls)=>h('label',{class:'tv-field '+(cls||'')},h('span',{text:label}),ctl);
  const first=h('input',{class:'tv-input',name:'first',required:true,maxlength:40,value:v('first'),autocomplete:'off'});
  const last=h('input',{class:'tv-input',name:'last',maxlength:40,value:v('last'),autocomplete:'off'});
  const gender=h('select',{class:'tv-sel',name:'gender'},...[['','Not set'],['female','Female'],['male','Male'],['other','Other']].map(o=>h('option',{value:o[0],text:o[1],selected:o[0]===str(v('gender')).toLowerCase()})));
  const age=h('select',{class:'tv-sel',name:'age'},h('option',{value:'',text:'Not set'}),...AGES.map(o=>h('option',{value:o[0],text:o[1],selected:o[0]===normAge(v('age'))})));
  const kind=h('select',{class:'tv-sel',name:'kind'},h('option',{value:'person',text:'Person',selected:v('kind','person')!=='pet'}),h('option',{value:'pet',text:'Pet',selected:v('kind')==='pet'}));
  const species=h('input',{class:'tv-input',name:'species',maxlength:30,value:v('species'),placeholder:'Dog, cat, horse…'});
  const life=h('select',{class:'tv-sel',name:'life'},...[['alive','Alive'],['dead','Dead'],['ghost','Ghost']].map(o=>h('option',{value:o[0],text:o[1],selected:o[0]===v('life','alive')})));
  const cause=h('input',{class:'tv-input',name:'cause',maxlength:60,value:v('cause'),placeholder:'For example old age'});
  const occ=h('fieldset',{class:'tv-occ'},h('legend',{text:'Occult'}),...OCCULTS.map(o=>h('label',{class:'tv-check'},h('input',{type:'checkbox',name:'occult',value:o[0],checked:(v('occults',[])||[]).map(x=>str(x).toUpperCase()).includes(o[0])}),o[1])));
  const traits=h('input',{class:'tv-input',name:'traits',maxlength:200,value:(v('traits',[])||[]).join(', '),placeholder:'Separate with commas'});
  const asp=h('input',{class:'tv-input',name:'asp',maxlength:60,value:v('asp'),placeholder:'Aspiration'});
  const notes=h('textarea',{class:'tv-input',name:'notes',rows:3,maxlength:300,'aria-label':'Notes'});if(sim&&sim.notes)notes.value=sim.notes;
  const causeF=fld('Cause of death',cause),speciesF=fld('Species',species),personOnly=[occ];
  const sync=()=>{causeF.hidden=life.value==='alive';speciesF.hidden=kind.value!=='pet';occ.hidden=kind.value==='pet';};
  life.addEventListener('change',sync);kind.addEventListener('change',sync);sync();
  /* photo (new sims only; existing sims use the card's photo buttons) */
  let photo=null;
  if(!sim){
    const prev=h('span',{class:'tv-pic xxl','data-pic-preview':'1',style:'--ph:200','aria-hidden':'true'},'＋');
    const fi=h('input',{type:'file',name:'photo',accept:'image/jpeg,image/png,image/webp','aria-label':'Photo'});
    fi.addEventListener('change',()=>{F.file=fi.files&&fi.files[0]||null;if(F.file&&window.URL&&URL.createObjectURL){try{const u=URL.createObjectURL(F.file);prev.textContent='';prev.append(h('img',{src:u,alt:''}));prev.classList.add('has-img');}catch(e){}}});
    photo=h('div',{class:'tv-photo-pick'},prev,fld('Photo (optional)',fi));
  }
  const rel=F.relation?h('p',{class:'tv-note small',text:`This sim will be linked to ${nameOf(ix.sims[F.relation.forId])} as ${{parent:'a parent',child:'a child',partner:'a partner ('+(STATUS[F.relation.value]||{}).label+')',friend:'a friend',pet:'a pet'}[F.relation.kind]}.`}):null;
  if(F.relation&&F.relation.kind==='pet')kind.value='pet',sync();
  form.append(photo,rel,fld('First name (required)',first),fld('Last name',last),h('div',{class:'tv-two'},fld('Gender',gender),fld('Age',age)),h('div',{class:'tv-two'},fld('Kind',kind),speciesF),fld('Condition',life),causeF,occ,fld('Traits',traits),fld('Aspiration',asp),sim?null:fld('Notes',notes),err,
    h('div',{class:'tv-actions'},h('button',{class:'tv-btn',type:'button',onclick:()=>cancelForm(st)},'Cancel'),h('button',{class:'tv-btn primary',type:'submit','data-act':'save'},sim?'Save changes':'Add sim')));
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!first.value.trim()){err.textContent='A first name is required.';err.hidden=false;first.focus();return;}
    err.hidden=true;
    const data={first:first.value.trim(),last:last.value.trim(),gender:gender.value,age:age.value,kind:kind.value,life:life.value};
    if(kind.value==='pet')data.species=species.value.trim();
    if(life.value!=='alive')data.cause=cause.value.trim();
    if(kind.value!=='pet')data.occults=[...occ.querySelectorAll('input:checked')].map(x=>x.value);
    data.traits=traits.value.split(',').map(x=>x.trim()).filter(Boolean);
    data.asp=asp.value.trim();
    if(sim)return saveEdit(st,sim,data);
    const out={};Object.keys(data).forEach(k=>{const x=data[k];if(Array.isArray(x)?x.length:x!=='')out[k]=x;});
    if(notes.value.trim())out.notes=notes.value.trim();
    await createSim(st,out,F);
  });
  p.append(form);
}
function cancelForm(st){const had=st.form&&st.form.editId;st.form=null;st.panelMode='sim';if(!had)st.selected=st.selected&&st.ix.sims[st.selected]&&st.selected;paint(st);}
async function saveEdit(st,sim,data){
  const changed={};
  Object.keys(data).forEach(k=>{const a=data[k],b=sim[k];const as=Array.isArray(a)?a.join('|'):str(a),bs=Array.isArray(b)?b.map(str).join('|'):str(b);if(k==='occults'?as.toUpperCase()!==bs.toUpperCase():as!==bs)changed[k]=a;});
  if(data.life==='alive'&&sim.cause)changed.cause='';
  if(!Object.keys(changed).length){st.form=null;st.panelMode='sim';paint(st);return;}
  const r=await saveFields(st,sim.id,changed);
  if(r){st.form=null;st.panelMode='sim';paint(st);}
}
async function createSim(st,fields,F){
  const r=await write(st,[{op:'sim_add',sim:fields}]);
  const id=r&&r.added&&r.added[0];
  if(!id){return;}
  if(F.file){try{const image=await preparePortrait(F.file);const pr=await api('portrait',{action:'put',owner:st.owner,simId:id,image,ifAt:0});if(alive(st)){const at=pr&&photoOk(pr.at)?pr.at:Date.now();st.pAvail.set(id,at);st.pImg.set(id,image);}}catch(e){toast('The sim was added, but the photo could not be saved.',true);}}
  const rel=F.relation;
  if(rel){
    const s={parent:{kind:'parent',spec:{child:rel.forId,parent:id,type:rel.value}},child:{kind:'parent',spec:{child:id,parent:rel.forId,type:rel.value}},pet:{kind:'parent',spec:{child:id,parent:rel.forId,type:'unknown'}},partner:{kind:'partner',spec:{a:rel.forId,b:id,status:rel.value}},friend:{kind:'friend',spec:{a:rel.forId,b:id}}}[rel.kind];
    const ok=await write(st,[Object.assign({op:'link_add',kind:s.kind},s.spec)]);
    if(!ok)toast('The sim was added, but linking failed. You can link them from the sim card.',true);
  }
  if(!alive(st))return;
  st.form=null;st.panelMode='sim';st.selected=id;paint(st);
  snack(st,nameOf(st.ix.sims[id])+' added.',async()=>{await write(st,[{op:'sim_delete',id}],'Sim removed again.');if(st.selected===id)closePanel(st);});
}

/* ---------- hidden sims list ---------- */
function openHidden(st){
  const ix=st.ix,list=h('ul',{class:'tv-pick-list'});
  [...ix.hidden].filter(i=>ix.sims[i]).forEach(i=>list.append(h('li',{class:'tv-row'},h('span',{class:'tv-rowbtn'},pic(st,i,'mini'),h('span',{},h('b',{text:nameOf(ix.sims[i])}),h('small',{text:[ageLabel(ix.sims[i].age),tail(i)].join(' · ')}))),h('button',{class:'tv-btn small',type:'button',onclick:()=>{m.close();hideSim(st,i,false);}},'Show'))));
  const m=modal('Hidden sims',[list.children.length?list:h('p',{class:'tv-empty',text:'No hidden sims.'})]);
}

/* ---------- paint ---------- */
function paint(st,opts={}){
  if(!alive(st))return;
  paintHead(st);
  st.shell.classList.toggle('tv-editing',!!st.edit);
  paintStage(st);paintPanel(st);
  wantPhotos(st);
  if(opts.focusFocus){const b=$q(st.ui.stage,'.tv-focus .tv-sim');b&&b.focus({preventScroll:false});}
}

/* ---------- mount ---------- */
function dispose(){
  if(S){S.cleanup&&S.cleanup();S.modals.slice().forEach(m=>m.close());document.documentElement.classList.remove('tv-panel-open');}
  S=null;EPOCH++;
}
async function open(owner,container){
  dispose();const epoch=EPOCH,actor=ME;
  const shell=h('div',{id:'family-explorer',class:'tv tv-page','aria-label':'Family tree'},h('p',{class:'tv-note',role:'status',text:'Loading the family tree…'}));
  shell._dispose=()=>{if(S&&S.shell===shell)dispose();};
  container.append(shell);
  const classic=()=>{shell.remove();openFamilyExplorer(owner,true);};
  let tree;
  try{tree=await api('tree',{owner});if(!valid(tree)){const e=new Error('404');throw e;}}
  catch(e){
    if(epoch!==EPOCH||!shell.isConnected||actor!==ME)return;
    if(unknownRoute(e)||str(e.message)==='404'){classic();return;}
    shell.textContent='';
    shell.append(h('p',{class:'tv-note',role:'alert',text:e.message==='offline'?'You seem to be offline. The family tree could not be loaded.':'The family tree could not be loaded.'}),
      h('div',{class:'tv-actions'},h('button',{class:'tv-btn primary',type:'button',onclick:()=>{shell.remove();open(owner,container);}},'Try again'),h('button',{class:'tv-btn',type:'button',onclick:classic},'Open the classic view')));
    return;
  }
  if(epoch!==EPOCH||!shell.isConnected||actor!==ME)return;
  build(shell,owner,tree,classic,container);
}
function build(shell,owner,tree,classic,container){
  const ix=buildIndex(tree);
  const st={shell,owner,actor:ME,tree,rev:tree.rev,ix,focus:'',stack:[],selected:null,panelMode:'sim',form:null,edit:false,busy:false,modals:[],ui:{},
    pAvail:new Map(),pImg:new Map(),pPending:new Set(),pQueue:[],pActive:0,pLoaded:false,visible:[],opener:null};
  const want=str(new URLSearchParams(location.hash.slice(1)).get('sim'));
  st.focus=want&&ix.sims[want]?want:defaultFocus(tree,ix);
  S=st;shell.textContent='';
  const ui=st.ui;
  ui.back=h('button',{class:'tv-btn small',type:'button','data-act':'back',onclick:()=>goBack(st)},'← Back');
  ui.crumbs=h('ol',{class:'tv-crumbs','aria-label':'Path through the family'});
  const players_=(()=>{try{return Array.from(new Set([owner,...players()]));}catch(e){return [owner];}})();
  ui.owner=h('select',{class:'tv-sel','aria-label':'Whose family tree'},...players_.map(n=>h('option',{value:n,text:n+(key(n)===key(ME)?' (you)':''),selected:n===owner})));
  ui.owner.addEventListener('change',()=>{const o=ui.owner.value;try{history.pushState(null,'',familyHref(o));}catch(e){}const hd=container.querySelector('.h1');if(hd)hd.textContent=o+'’s family tree';shell.remove();open(o,container);});
  ui.sw=h('button',{type:'button',class:'tv-switch',role:'switch','aria-checked':'false','data-act':'edit-toggle',onclick:()=>{if(!st.tree.canEdit)return;st.edit=!st.edit;if(!st.edit&&st.panelMode==='form'){st.form=null;st.panelMode='sim';}paint(st);announce(st,st.edit?'Edit mode on.':'Edit mode off.');}},h('span',{class:'tv-knob','aria-hidden':'true'}),h('span',{text:'Edit mode'}));
  ui.addSim=h('button',{class:'tv-btn primary',type:'button','data-act':'add-sim',onclick:()=>openForm(st,null)},'+ Add Sim');
  ui.hiddenBtn=h('button',{class:'tv-btn small',type:'button',hidden:true,onclick:()=>openHidden(st)},'Hidden sims');
  ui.editWrap=h('div',{class:'tv-editwrap',hidden:true},ui.sw);
  ui.banner=h('div',{class:'tv-banner',role:'status',hidden:true},h('b',{text:'Edit mode'}),h('span',{text:EDIT_NOTE}),ui.addSim,ui.hiddenBtn,h('button',{class:'tv-btn small',type:'button',onclick:()=>{st.edit=false;paint(st);}},'Done'));
  ui.strip=h('div',{class:'tv-strip',role:'group','aria-label':'Heir line'});
  ui.stripWrap=h('div',{class:'tv-stripwrap'},h('span',{class:'tv-kicker',text:'Heir line'}),ui.strip);
  ui.search=h('input',{type:'search',class:'tv-input','aria-label':'Search sims by name',placeholder:'Search names',autocomplete:'off'});
  ui.results=h('ul',{class:'tv-results',hidden:true});
  ui.search.addEventListener('input',()=>runSearch(st));
  ui.search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runSearch(st,true);}if(e.key==='Escape'&&ui.search.value){e.stopPropagation();ui.search.value='';ui.results.hidden=true;}});
  ui.stage=h('div',{class:'tv-stage',role:'region','aria-label':'Family of the focused sim','aria-describedby':'tv-hint'});
  ui.sheet=h('aside',{class:'tv tv-panel',role:'dialog','aria-modal':'false','aria-label':'Sim card',hidden:true});
  ui.panel=h('div',{class:'tv-panel-body'});
  ui.sheet.append(h('div',{class:'tv-grab','aria-hidden':'true'}),ui.panel);
  ui.backdrop=h('div',{class:'tv tv-backdrop','aria-hidden':'true',hidden:true});
  document.body.append(ui.backdrop,ui.sheet);
  ui.live=h('p',{class:'tv-sr',role:'status','aria-live':'polite'});
  ui.hint=h('p',{class:'tv-sr',id:'tv-hint',text:'Tab through the sims. Space or click opens the sim card. Enter or double-click makes that sim the focus. Escape closes the card.'});
  ui.snack=h('div',{class:'tv-snack',role:'status',hidden:true});
  const orig=(()=>{try{return typeof originalTreeLink==='function'?originalTreeLink(owner):null;}catch(e){return null;}})();
  const top=h('div',{class:'tv-top'},
    h('div',{class:'tv-bar'},ui.back,ui.crumbs),
    h('div',{class:'tv-bar tools'},h('div',{class:'tv-searchwrap'},ui.search,ui.results),ui.owner,ui.editWrap,h('button',{class:'tv-btn small',type:'button','data-act':'classic',onclick:classic},'Classic view'),orig),
    ui.stripWrap,ui.banner);
  shell.append(top,h('div',{class:'tv-body'},ui.stage),ui.snack,ui.live,ui.hint);
  const onEsc=e=>{
    if(e.key!=='Escape'||st.modals.length)return;
    if(!ui.results.hidden){ui.results.hidden=true;return;}
    if(st.sheetOpen){e.preventDefault();e.stopPropagation();if(st.panelMode==='form')cancelForm(st);else closePanel(st);}
  };
  shell.addEventListener('keydown',onEsc);ui.sheet.addEventListener('keydown',onEsc);
  ui.backdrop.addEventListener('click',()=>{if(st.sheetOpen){if(st.panelMode==='form')cancelForm(st);else closePanel(st);}});
  const away=e=>{if(!e.target.closest('.tv-searchwrap'))ui.results.hidden=true;};
  document.addEventListener('click',away);
  const onResize=()=>scheduleWires(st);window.addEventListener('resize',onResize);
  const untip=setupTips(st);
  st.cleanup=()=>{document.removeEventListener('click',away);window.removeEventListener('resize',onResize);untip();clearTimeout(st.sheetT);if(st.ro)st.ro.disconnect();ui.sheet.remove();ui.backdrop.remove();};
  paint(st);
  portraitList(st);
}
function recenter(){
  if(!S)return false;const st=S;
  st.stack=[];st.focus=defaultFocus(st.tree,st.ix);st.selected=null;st.panelMode='sim';st.form=null;
  paint(st,{focusFocus:true});setHash(st);
  const sc=st.shell.scrollIntoView;if(typeof sc==='function')try{st.shell.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}catch(e){}
  announce(st,'Centered on '+nameOf(st.ix.sims[st.focus])+'.');return true;
}

/* ---------- floating tree bubble ---------- */
function bubbleTarget(){
  const sc=document.getElementById('scrim');
  if(sc&&!sc.hidden){
    const sh=sc.querySelector('.sheet');
    if(sh){
      const a=[...sh.querySelectorAll('a[href*="family="]')][0];
      if(a){try{const f=new URLSearchParams((a.getAttribute('href').split('#')[1]||'')).get('family');if(f)return f;}catch(e){}}
      const lab=sh.getAttribute('aria-label');
      try{const p=players().find(n=>key(n)===key(lab));if(p)return p;}catch(e){}
    }
  }
  return ME;
}
function onTreePage(){return !!(S&&S.shell.isConnected&&!S.shell.closest('[hidden]'));}
function setupBubble(){
  if(document.getElementById('tv-bubble'))return;
  const a=h('a',{id:'tv-bubble',class:'tv-bubble',href:'#',target:'_blank',rel:'noopener noreferrer','aria-label':'Family tree',title:'Family tree',hidden:true},h('span',{class:'tv-bubble-ic','aria-hidden':'true',text:'🌳'}),h('span',{class:'tv-bubble-tx',text:'Family tree'}));
  const refresh=()=>{const tabs=document.getElementById('tabs');const show=!!ME&&!!tabs&&!tabs.hidden;a.hidden=!show;if(show){const t=bubbleTarget();try{a.href=familyHref(t);}catch(e){}a.dataset.owner=t;}};
  a.addEventListener('click',e=>{refresh();if(onTreePage()){e.preventDefault();recenter();}});
  a.addEventListener('focus',refresh);a.addEventListener('pointerenter',refresh);a.addEventListener('touchstart',refresh,{passive:true});
  document.body.append(a);
  const tabs=document.getElementById('tabs');
  if(tabs&&window.MutationObserver)new MutationObserver(refresh).observe(tabs,{attributes:true,attributeFilter:['hidden']});
  const sc=document.getElementById('scrim');if(sc&&window.MutationObserver)new MutationObserver(refresh).observe(sc,{attributes:true,childList:true,attributeFilter:['hidden']});
  refresh();
  window.TreeV2.refreshBubble=refresh;
}

window.TreeV2={open,recenter,state:()=>S,buildIndex,unitsOf,partnersOf,petsOf,descendants,defaultFocus,bubbleTarget,STATUS};
window.treeV2Open=open;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupBubble);else setupBubble();
})();
