const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('health.html','utf8');
const base=1700000000000;
const snapshot=(extra={})=>({now:base,appPresenceWindowMs:90000,players:[{name:'one',appSeenAt:base-1000,seen:{at:base-2000,via:'helper',snapAt:base-3000,env:{mod:3},meta:{up:'2.0'}}},{name:'two',seen:{}}],links:[],...extra});
async function setup({hash='#g=test&h=test',session=true,manualTimers=false,responses=[{ok:true,data:snapshot()}]}={}){
  let time=0, calls=[], signals=[], intervals=[], timeouts=new Map(), nextTimer=0, hidden=false;
  const dom=new JSDOM(html,{url:'https://example.test/health.html'+hash,runScripts:'dangerously',beforeParse(w){
    if(session)w.sessionStorage.setItem('tg-hs','session');
    Object.defineProperty(w.performance,'now',{value:()=>time});
    Object.defineProperty(w.document,'hidden',{get:()=>hidden});
    if(manualTimers){w.setTimeout=(fn,ms)=>{const id=++nextTimer;timeouts.set(id,{fn,ms});return id;};w.clearTimeout=id=>timeouts.delete(id);}
    w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
    w.fetch=async(_url,opts)=>{calls.push(JSON.parse(opts.body));signals.push(opts.signal);const r=responses.shift();if(r instanceof Error)throw r;return {json:async()=>r};};
  }});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};await flush();
  return {dom,calls,signals,flush,expire:async()=>{const list=[...timeouts.values()];timeouts.clear();for(const t of list)t.fn();await flush();},advance:async(ms)=>{time+=ms;for(const i of intervals)if(ms>=i.ms)i.fn();await flush();},hide:v=>hidden=v};
}
test('comparison ages from server time and handles missing fields',async()=>{
 const x=await setup();let panel=x.dom.window.document.querySelector('#comparison');
 assert.match(panel.textContent,/active in last 90s/);assert.match(panel.textContent,/unknown/);assert.match(panel.textContent,/via helper/);assert.match(panel.textContent,/v3/);assert.ok(panel.querySelector('[title]'));
 await x.advance(91000);assert.match(panel.textContent,/not seen recently/);assert.match(panel.textContent,/stale/);x.dom.window.close();
});
test('automatic refresh preserves form and file input; failures retain snapshot',async()=>{
 const x=await setup({responses:[{ok:true,data:snapshot()},{ok:true,data:snapshot({now:base+30000})},new Error('offline')]});const d=x.dom.window.document;
 const form=d.querySelector('#nMail'), file=d.querySelector('input[type=file]');form.value='unsaved@example.test';
 await x.advance(30000);assert.equal(d.querySelector('#nMail'),form);assert.equal(form.value,'unsaved@example.test');assert.equal(d.querySelector('input[type=file]'),file);
 await x.advance(30000);assert.match(d.querySelector('#comparison').textContent,/refresh failed/);assert.match(d.querySelector('#comparison').textContent,/one/);x.dom.window.close();
});
test('hidden tab does not refresh and expired login removes private view',async()=>{
 const x=await setup({responses:[{ok:true,data:snapshot()},{login:true}]});x.hide(true);await x.advance(30000);assert.equal(x.calls.length,1);x.hide(false);await x.advance(30000);assert.match(x.dom.window.document.querySelector('#main').textContent,/log in/i);assert.equal(x.dom.window.document.querySelector('#comparison'),null);x.dom.window.close();
});
test('missing link does not fetch and no session only checks authentication',async()=>{
 const x=await setup({hash:''});assert.equal(x.calls.length,0);x.dom.window.close();
 const y=await setup({session:false,responses:[{ok:true}]});assert.deepEqual(y.calls.map(c=>c.action),['authstate']);y.dom.window.close();
});
test('old backend without app presence reports unknown',async()=>{
 const data=snapshot();delete data.appPresenceWindowMs;delete data.players[0].appSeenAt;const x=await setup({responses:[{ok:true,data}]});assert.match(x.dom.window.document.querySelector('#comparison').textContent,/oneunknown/);x.dom.window.close();
});
test('a late refresh cannot restore a logged-out dashboard',async()=>{
 let resolve;const delayed=new Promise(r=>{resolve=r;});
 const x=await setup({responses:[{ok:true,data:snapshot()},delayed,{ok:true}]});
 await x.advance(30000);const button=[...x.dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Log out');button.click();await x.flush();
 resolve({ok:true,data:snapshot()});await x.flush();assert.equal(x.dom.window.document.querySelector('#comparison'),null);assert.match(x.dom.window.document.querySelector('#main').textContent,/log in/i);x.dom.window.close();
});
test('keeps mobile scroll, shows app time, and treats version numbers independently',async()=>{
 const data=snapshot({modNow:7});data.players[0].seen.env.mod=6;
 const x=await setup({responses:[{ok:true,data}]});const d=x.dom.window.document;
 let scroll=d.querySelector('.comparison-scroll');scroll.scrollLeft=123;
 const app=d.querySelector('tbody tr td:nth-child(2)');assert.match(app.textContent,/active in last 90s.*sec ago/);assert.ok(app.querySelector('[title]'));
 await x.advance(1000);scroll=d.querySelector('.comparison-scroll');assert.equal(scroll.scrollLeft,123);
 assert.match(d.querySelector('#comparison').textContent,/Latest release bundle: v7/);assert.match(d.querySelector('#comparison').textContent,/version numbers are independent/);
 assert.doesNotMatch(d.querySelector('#main').textContent,/Old game file|Update v7 is installed|restart.*Sims 4/i);x.dom.window.close();
});
test('timed out refresh releases the slot and the next automatic refresh succeeds',async()=>{
 let resolve;const delayed=new Promise(r=>{resolve=r;});
 const x=await setup({manualTimers:true,responses:[{ok:true,data:snapshot()},delayed,{ok:true,data:snapshot({now:base+60000})}]});
 const d=x.dom.window.document, field=d.querySelector('#nMail');field.value='unsaved';
 await x.advance(30000);assert.equal(x.calls.length,2);await x.expire();assert.equal(x.signals[1].aborted,true);assert.match(d.querySelector('#comparison').textContent,/refresh failed/);
 await x.advance(30000);assert.equal(x.calls.length,3);assert.doesNotMatch(d.querySelector('#comparison').textContent,/refresh failed/);assert.equal(field.value,'unsaved');
 resolve({login:true});await x.flush();assert.ok(d.querySelector('#comparison'));x.dom.window.close();
});
test('mutation timeout reports unknown outcome and never retries',async()=>{
 const x=await setup({manualTimers:true,responses:[{ok:true,data:snapshot()},new Promise(()=>{})]});const d=x.dom.window.document;
 const input=d.querySelector('#nMail');input.value='unsaved';const save=[...d.querySelectorAll('button')].find(b=>b.textContent==='Save');save.click();await x.flush();await x.expire();
 assert.equal(x.calls.filter(c=>c.action==='notify').length,1);assert.match(save.closest('section').textContent,/Request timed out; result may have completed\. Refresh before trying again\./);assert.equal(input.value,'unsaved');assert.equal(x.signals[1].aborted,true);x.dom.window.close();
});
test('setup timeout leaves loading state and reports failure',async()=>{
 const x=await setup({session:false,manualTimers:true,responses:[{ok:true,setup:true},new Promise(()=>{})]});
 await x.expire();assert.match(x.dom.window.document.querySelector('#main').textContent,/can't reach the app/i);x.dom.window.close();
});
test('enter login timeout reports uncertain outcome and preserves credentials',async()=>{
 const x=await setup({session:false,manualTimers:true,responses:[{ok:true},new Promise(()=>{})]});const d=x.dom.window.document;
 d.querySelector('#pw').value='password';const code=d.querySelector('#code');code.value='123456';code.dispatchEvent(new x.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await x.flush();await x.expire();
 assert.match(d.querySelector('#main').textContent,/result may have completed/i);assert.equal(d.querySelector('#pw').value,'password');assert.equal(code.value,'123456');x.dom.window.close();
});
test('automatic refresh identifies the age of the older player details',async()=>{
 const x=await setup({responses:[{ok:true,data:snapshot()},{ok:true,data:snapshot({now:base+30000})}]});await x.advance(30000);
 const d=x.dom.window.document;assert.match(d.querySelector('#details-stamp').textContent,/30 sec ago/);assert.match(d.querySelector('#details-stamp').textContent,/Refresh in Host tools/);assert.match(d.querySelector('#comparison').textContent,/Last refreshed 0 sec ago/);x.dom.window.close();
});
