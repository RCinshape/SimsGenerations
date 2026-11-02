const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function extractScripts(source){
  const page=source.replace(/\r\n/g,'\n');
  function between(start,end,from=0){
    const a=page.indexOf(start,from), b=page.indexOf(end,a+start.length);
    if(a<0||b<0) throw new Error(`missing script boundary: ${start} / ${end}`);
    return page.slice(a,b);
  }
  return {
    session:between('/* ---------- session ownership','async function webCall('),
    core:between('async function webCall(','/* ---------- tabs / routing'),
    listeners:between('document.addEventListener("visibilitychange",()=>{ if(document.hidden)','\n\n(async()=>',page.indexOf('/* live refresh */')),
  };
}
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const {session,core,listeners} = extractScripts(source);
test('script extraction handles windows line endings',()=>{
  const lf=extractScripts(source.replace(/\r\n/g,'\n'));
  const crlf=extractScripts(source.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'));
  assert.deepEqual(crlf,lf);
});
function deferred(){ let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; }
function fixture(){
  let now=100000, id=0, transport=async()=>({s:200,d:{me:'a'}}); const timers=new Map(), calls=[], handlers={};
  class Clock extends Date { static now(){return now;} }
  const c=vm.createContext({Date:Clock,Math,JSON,AbortController,console,
    setTimeout:(fn,ms)=>{const n=++id;timers.set(n,{fn,at:now+ms,ms});return n;},clearTimeout:n=>timers.delete(n),
    ls:{get:()=>null,set(){},del(){},key:k=>k},
    window:{addEventListener:(n,f)=>handlers[n]=f}, document:{hidden:false,addEventListener:(n,f)=>handlers[n]=f},navigator:{onLine:true},
    $:()=>({hidden:true,remove(){}}),closeSheet(){},authScreen(){},render(){},setupStatus(){},autoEmit(){},toast(){},
    key:n=>String(n||'').toLowerCase(),uid:()=> 'id',G:()=>null,trackGoals:()=>[],doneSet:()=>new Set(),
    fetch:async(url,opt)=>{const req=JSON.parse(opt.body);calls.push(req);const r=await transport(req);return {json:async()=>r};}
  });
  vm.runInContext('let ME="a", SETUP=false; const GAS=true, WEB=true, GID="fixture";',c);
  vm.runInContext(session+core+listeners,c);
  const run=s=>vm.runInContext(s,c);
  return {c,run,calls,timers,handlers,setTransport:f=>transport=f,advance:ms=>{now+=ms;},fire:async()=>{const [key,t]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]||[];if(!t)return;now=Math.max(now,t.at);timers.delete(key);await t.fn();},delay:()=>Math.min(...[...timers.values()].map(t=>t.at-now))};
}
test('concurrent pulls share a flight, while a new session never waits for or is cleared by an old one',async()=>{
  const a=fixture(), one=deferred(), two=deferred();let n=0;
  a.setTransport(()=>++n===1?one.promise:two.promise);
  const p=a.run('pull()'), q=a.run('pull()');assert.equal(a.calls.length,1);
  a.run('sessionGeneration++; ME="b"');const r=a.run('pull()');assert.equal(a.calls.length,2);
  one.resolve({s:200,d:{me:'a'}});await assert.rejects(p);await assert.rejects(q);
  const s=a.run('pull()');assert.equal(a.calls.length,2);
  two.resolve({s:200,d:{me:'b'}});await Promise.all([r,s]);assert.equal(a.run('LIVE.roster.length'),0);
});
test('foreground clock coalesces visibility and online bursts and pauses hidden or offline',async()=>{
  const a=fixture(), pending=deferred();a.setTransport(()=>pending.promise);
  a.run('scheduleRecovery(20000); SETUP=true; scheduleRecovery(8000)');assert.equal(a.delay(),8000);
  a.c.document.hidden=true;a.handlers.visibilitychange();assert.equal(a.timers.size,0);
  a.c.document.hidden=false;a.handlers.visibilitychange();a.handlers.online();a.handlers.online();assert.equal(a.timers.size,1);
  const running=a.fire();assert.equal(a.calls.length,1);a.handlers.online();const again=a.fire();assert.equal(a.calls.length,1);
  pending.resolve({s:200,d:{me:'a'}});await Promise.all([running,again]);assert.equal(a.timers.size,1);
  a.c.navigator.onLine=false;a.handlers.offline();a.handlers.online();assert.equal(a.timers.size,0);
});
test('rate limit and transient failures back off, retain edits, and success resets the clock',async()=>{
  const a=fixture();let status=429;
  a.setTransport(async()=>status===200?{s:200,d:{me:'a'}}:{s:status,d:{}});
  a.run('MINE={name:"a",current:1}; dirty=true; outbox.push({id:"x",who:"a",type:"post"})');
  await assert.rejects(a.run('pull()'));assert.ok(a.run('retryUntil-Date.now()')>=30000);
  await a.run('flush()');assert.equal(a.calls.length,1);assert.equal(a.run('dirty && outbox.length===1'),true);
  for(let i=0;i<8;i++)a.run('recoveryFailure(new Error("500"))');assert.ok(a.run('retryUntil-Date.now()')<=60000);
  a.advance(60001);status=200;await a.run('pull()');assert.equal(a.run('retryCount'),0);assert.equal(a.run('retryUntil'),0);
  assert.deepEqual(a.calls.map(x=>x.api),['live','live']);
});

test('blocked storage warns while offline changes remain queued and clears after acknowledgement',async t=>{
  const {JSDOM,VirtualConsole}=require('jsdom');
  const {html}=require('./create-debug-fixture.cjs');
  const dom=new JSDOM(html,{url:'https://fixture.invalid/#g=fixture-backend-000000000000',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.scrollTo=()=>{};}});
  t.after(()=>dom.window.close());
  const w=dom.window, d=w.document;
  async function waitFor(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('fixture timeout');}
  await waitFor(()=>d.querySelectorAll('.pcard').length===2);
  d.querySelector('.tab[data-tab="me"]').click();await waitFor(()=>d.querySelector('#t1_1'));
  const storageProto=Object.getPrototypeOf(w.localStorage), original=storageProto.setItem;
  storageProto.setItem=function(k,v){if(this===w.sessionStorage||!String(k).startsWith('qa-'))throw new Error('quota');return original.call(this,k,v);};
  Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});
  d.querySelector('#t1_1').click();
  assert.equal(d.querySelector('#t1_1').checked,true);
  assert.equal(d.querySelector('#recoveryWarning').hidden,false);
  assert.match(d.querySelector('#recoveryWarning').textContent,/keep this tab open/i);
  assert.equal(JSON.parse(w.localStorage.getItem('qa-server')).feed.length,0);
  Object.defineProperty(w.navigator,'onLine',{configurable:true,value:true});w.dispatchEvent(new w.Event('online'));
  await waitFor(()=>JSON.parse(w.localStorage.getItem('qa-server')).feed.some(e=>e.type==='tick'));
  await waitFor(()=>d.querySelector('#recoveryWarning').hidden);
  assert.equal(JSON.parse(w.localStorage.getItem('qa-server')).progress['qa-alpha'].gens[1].ticks.includes(1),true);
});
