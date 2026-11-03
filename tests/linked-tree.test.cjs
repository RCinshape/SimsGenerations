const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {html}=require('./create-debug-fixture.cjs');
const {build,marker}=require('../scripts/build-linked-tree-backend.cjs');
const moduleSource=fs.readFileSync('gas/LinkedTree.gs','utf8');
const fixture=`function api(path,body,token){var me=sessionUser_(token);if(!me)return res_(401,{});switch(path){\n${marker}\n}return res_(404,{});}`;
const good='https://app.thesimstree.com/crafted/pages/dynasty/tree/123';
test('builder preserves source and refuses reapplication',()=>{const out=build(fixture);assert.equal(out.slice(0,-('\n'+moduleSource+'\n').length).replace("\n      case 'linkedtree': return linkedTreeAction_(me, body);",''),fixture);assert.throws(()=>build(out));assert.throws(()=>build(''));});
test('group reads honor roster and tester visibility and metadata validation',()=>{
 const files=new Map(),read=[];const ctx=vm.createContext({sessionUser_:t=>({a:'Alice',b:'Bob',t:'Test'})[t]||'',safe_:s=>String(s||'').toLowerCase(),roster_:()=>({alice:'Alice',bob:'Bob',test:'Test'}),sameActor_:(a,b)=>a.toLowerCase()===b.toLowerCase(),isTester_:s=>String(s).toLowerCase()==='test',readJson_:(n,d)=>{read.push(n);return files.get(n)||d;},res_:(s,d)=>({s,d})});vm.runInContext(build(fixture),ctx);
 files.set('linked-tree__alice.json',{label:' My tree ',url:good,secret:'ignored'});
 assert.equal(ctx.api('linkedtree',{},'').s,401);assert.equal(ctx.api('linkedtree',{owner:'Alice'},'b').d.tree.url,good);assert.equal(ctx.api('linkedtree',{owner:'outsider'},'a').s,404);assert.equal(ctx.api('linkedtree',{owner:'Test'},'a').s,404);assert.equal(ctx.api('linkedtree',{owner:null},'a').s,404);assert.equal(ctx.api('linkedtree',{owner:'../Alice'},'a').s,404);files.set('linked-tree__test.json',{label:'test',url:good});assert.equal(ctx.api('linkedtree',{owner:'Test'},'t').d.tree.label,'test');assert.equal(ctx.api('linkedtree',{owner:'Alice',action:'put',url:'invalid'},'b').d.tree.url,good);
 let t=ctx.api('linkedtree',{},'a').d.tree;assert.equal(t.label,'My tree');assert.equal(t.url,good);assert.equal(t.secret,undefined);
 for(const url of ['http://app.thesimstree.com/crafted/pages/dynasty/tree/123','https://app.thesimstree.com:443/crafted/pages/dynasty/tree/123','https://x@app.thesimstree.com/crafted/pages/dynasty/tree/123',good+'?a=1',good+'#x',good+'\n',good+'/x','https://app.thesimstree.com.evil.test/public/tree/token','https://app.thesimstree.com/public/tree/../foo']){files.set('linked-tree__alice.json',{label:'x',url});assert.equal(ctx.api('linkedtree',{},'a').d.tree,null,url);}
 files.set('linked-tree__alice.json',{label:'x',url:'https://app.thesimstree.com/public/tree/a_b-1'});assert.ok(ctx.api('linkedtree',{},'a').d.tree);
 files.set('linked-tree__alice.json',{label:'bad\nlabel',url:good});assert.equal(ctx.api('linkedtree',{},'a').d.tree,null);
 files.set('linked-tree__alice.json',{label:'x'.repeat(81),url:good});assert.equal(ctx.api('linkedtree',{},'a').d.tree,null);assert.ok(read.every(x=>x.startsWith('linked-tree__')));
});
test('real links use validated destinations and cache by owner',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.fixtureUrl=good;w.eval("dismissLinkedTree();window.calls=[];api=async(path,body)=>{calls.push(body.owner);return {tree:{label:'fixture',url:window.fixtureUrl}}};document.body.append(familyPanel('qa-beta'),familyPanel('qa-beta'))");await new Promise(r=>setTimeout(r,0));
 const panels=[...d.querySelectorAll('.compact-family')].slice(-2);for(const panel of panels){const native=panel.querySelector('a.btn.go'),original=panel.querySelector('a.btn.ghost');assert.equal(native.target,'_blank');assert.match(native.href,/family=qa-beta/);assert.equal(original.href,good);assert.equal(original.target,'_blank');assert.equal(original.rel,'noopener noreferrer');assert.equal(original.getAttribute('referrerpolicy'),'no-referrer');}assert.equal(w.calls.length,1);
});
test('invalid and stale metadata never creates a link',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.eval("dismissLinkedTree();window.pending=null;api=()=>new Promise(r=>window.pending=r);window.panel=familyPanel('qa-beta');document.body.append(panel);sessionGeneration++");w.pending({tree:{label:'fixture',url:good}});await new Promise(r=>setTimeout(r,0));assert.equal(w.panel.querySelector('a.btn.ghost'),null);
 w.eval("dismissLinkedTree();api=async()=>({tree:{label:'bad',url:'https://app.thesimstree.com.evil.test/public/tree/x'}});window.panel2=familyPanel('qa-beta');document.body.append(panel2)");await new Promise(r=>setTimeout(r,0));assert.equal(w.panel2.querySelector('a.btn.ghost'),null);assert.match(w.panel2.textContent,/No original tree/);
});
test('direct route and player selection preserve history and app shell',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000&family=qa-beta',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('#family-explorer');i++)await new Promise(r=>setTimeout(r,10));assert.equal(d.querySelector('#family-explorer').className,'fx-page');assert.equal(d.querySelector('#tabs').hidden,false);assert.equal(d.querySelector('#family-explorer select').value,'qa-beta');assert.equal(d.querySelector('#family-explorer').getAttribute('role'),null);
 const select=d.querySelector('#family-explorer select');select.value='qa-alpha';select.dispatchEvent(new w.Event('change'));assert.match(w.location.hash,/family=qa-alpha/);assert.match(d.querySelector('#v-family h1').textContent,/qa-alpha/);w.history.back();await new Promise(r=>setTimeout(r,30));assert.equal(d.querySelector('#family-explorer select').value,'qa-beta');
});
