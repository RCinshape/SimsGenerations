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
test('own panel and pending requests are fenced on logout',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(w.eval("familyPanel('qa-beta').textContent.includes('Linked tree')"),true);assert.equal(w.eval("familyPanel(ME).textContent.includes('Linked tree')"),true);
 w.eval("window.pending=null;api=()=>new Promise(r=>window.pending=r);openLinkedTree()");assert.equal(d.querySelector('#linked-tree iframe'),null);w.eval('loggedOut()');w.pending({tree:{label:'fixture',url:good}});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('#linked-tree'),null);
});
test('explicit click loads validated link with fallback and close restores focus',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.fixtureUrl=good;w.eval("api=async()=>({tree:{label:'fixture',url:window.fixtureUrl}})");const button=d.createElement('button');d.body.append(button);button.focus();w.eval('openLinkedTree()');await new Promise(r=>setTimeout(r,0));const frame=d.querySelector('#linked-tree iframe'),link=d.querySelector('#linked-tree a');assert.ok(frame);assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer');assert.match(frame.getAttribute('sandbox'),/allow-scripts/);assert.match(frame.getAttribute('sandbox'),/allow-same-origin/);assert.doesNotMatch(frame.getAttribute('sandbox'),/allow-top-navigation/);assert.equal(link.rel,'noopener noreferrer');d.querySelector('#linked-tree button').click();assert.equal(d.activeElement,button);
});

test('invalid metadata never creates an external link or frame',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.fixtureUrl=good+'\n';w.eval("api=async()=>({tree:{label:'fixture',url:window.fixtureUrl}});openLinkedTree()");await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('#linked-tree iframe'),null);assert.equal(d.querySelector('#linked-tree a'),null);
});
test('pending metadata cannot cross an actor or session change',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 for(const change of ["ME='qa-beta'", "sessionGeneration++"]){w.eval("window.pending=null;api=()=>new Promise(r=>window.pending=r);openLinkedTree();"+change);w.pending({tree:{label:'fixture',url:good}});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('#linked-tree iframe'),null);assert.equal(d.querySelector('#linked-tree a'),null);w.eval('dismissLinkedTree()');}
});

test('selected player action sends that owner and fences replaced requests',async t=>{
 const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};}});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 for(let i=0;i<100&&!d.querySelector('.pcard');i++)await new Promise(r=>setTimeout(r,10));
 w.eval("window.calls=[];api=(path,body)=>{if(path==='linkedtree'){calls.push(body.owner);return new Promise(r=>window.pending=r)}return Promise.resolve({portraits:[]})};openFamilyExplorer(ME)");
 const select=d.querySelector('#family-explorer select');select.value='qa-beta';select.dispatchEvent(new w.Event('change',{bubbles:true}));[...d.querySelectorAll('#family-explorer button')].find(b=>b.textContent==='Linked tree').click();assert.equal(w.calls[0],'qa-beta');
 const old=w.pending;w.eval("openLinkedTree('qa-alpha')");old({tree:{label:'old fixture',url:'https://app.thesimstree.com/crafted/pages/dynasty/tree/123'}});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('#linked-tree iframe'),null);assert.equal(w.calls[1],'qa-alpha');w.pending({tree:{label:'new fixture',url:'https://app.thesimstree.com/crafted/pages/dynasty/tree/123'}});await new Promise(r=>setTimeout(r,0));assert.equal(d.querySelector('#linked-tree iframe').title,'new fixture');
});
