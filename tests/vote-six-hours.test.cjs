const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {build,replacements}=require('../scripts/build-vote-six-hours.cjs');
const portable=`var VOTE_HOURS = 24, MAX_OPEN_VOTES = 3, INBOX_KEEP = 40;
var notice='Polls close in 24 hours.';
function votesView_(me) {
  var all = readJson_('votes.json', []), now = Date.now(), tester = isTester_(me);
  return all.map(function(v){return {id:v.id,closed:!!v.closed,ends: v.at + VOTE_HOURS * 36e5};});
}
function voteNew_(me, b) {
 var target=b.target, q=b.q, opts=b.opts;
 if (!target || q.length < 3 || opts.length < 2) return res_(400, { error: 'bad_vote' });
  return withLock_(function () {
    var all = readJson_('votes.json', []);
    if (all.filter(function (v) { return !v.closed && v.by === me; }).length >= MAX_OPEN_VOTES) return res_(429, { error: 'too_many_votes' });
    var v = { id: randHex_(12), by: me, target: target, q: q, opts: opts, votes: {}, at: Date.now() };
    all.push(v); writeJson_('votes.json', all); feedAs_(me,voice_('vote', { who: b_(me), target: b_(target), x: q }));return res_(200,{id:v.id});
  });
}
function voteCast_(me,b){ var i=Math.floor(Number(b.i));return withLock_(function(){
 var all=readJson_('votes.json',[]),v=all.find(x=>x.id===b.id);
 if (!v || v.closed || !(i >= 0 && i < v.opts.length)) return res_(400, { error: 'bad_vote' });
 v.votes[me]=i;if(Object.keys(v.votes).length>=Object.keys(roster_()).length)closeVote_(v);writeJson_('votes.json',all);return res_(200,{});
}); }
function closeVote_(v){v.closed=true;v.closedAt=Date.now();feedAs_(v.by,'result');}
/** Daily (and any time): close votes older than 24 hours. */
function closeVotes_() {
  withLock_(function () {
    var all = readJson_('votes.json', []), changed = false;
    all.forEach(function (v) { if (!v.closed && Date.now() - v.at > VOTE_HOURS * 36e5) { closeVote_(v); changed = true; } });
    if (changed) writeJson_('votes.json', all);
  });
}`;
const sources=[['portable',portable]];if(process.env.VOTES_BACKEND_SOURCE)sources.push(['private',fs.readFileSync(process.env.VOTES_BACKEND_SOURCE,'utf8')]);
function setup(source){let clock=1700000000000, files={},notifications=[],depth=0,seq=0;
 const ctx=vm.createContext({});vm.runInContext(build(source),ctx);
 ctx.Date=class extends Date{static now(){return clock}};ctx.readJson_=(n,d)=>n in files?JSON.parse(JSON.stringify(files[n])):d;ctx.writeJson_=(n,v)=>{files[n]=JSON.parse(JSON.stringify(v));};ctx.withLock_=fn=>{assert.equal(depth,0,'nested lock');depth++;try{return fn()}finally{depth--}};ctx.isTester_=()=>false;ctx.roster_=()=>({alice:'Alice',bob:'Bob',carol:'Carol'});ctx.safe_=s=>String(s||'').toLowerCase();ctx.clean_=(x,n)=>String(x||'').slice(0,n);ctx.randHex_=()=>String(++seq);ctx.b_=x=>x;ctx.voice_=(k,x)=>{if(k==='vote')return `closes ${x.hours} hours`;return 'result'};ctx.feedAs_=(a,b)=>notifications.push(b);ctx.inboxOthers_=()=>{};ctx.inboxPush_=()=>{};ctx.res_=(s,d)=>({s,d});
 return {ctx,files,notifications,now:()=>clock,at:n=>{clock=n}};
}
for(const [name,source] of sources){
 test(name+': new vote lasts six hours and rejects at boundary once',()=>{let {ctx,files,notifications,now,at}=setup(source),start=now();assert.equal(ctx.voteNew_('Alice',{target:'Bob',q:'choose',opts:['one','two']}).s,200);let v=files['votes.json'][0];assert.equal(v.ends,start+6*36e5);assert.match(notifications[0],/^closes 6 hours/);at(v.ends-1);assert.equal(ctx.voteCast_('Alice',{id:v.id,i:0}).s,200);at(v.ends);assert.equal(ctx.voteCast_('Bob',{id:v.id,i:1}).s,400);assert.equal(files['votes.json'][0].closed,true);assert.equal(files['votes.json'][0].votes.Bob,undefined);assert.equal(notifications.filter(x=>x.startsWith('result')).length,1);ctx.votesView_('Alice');assert.equal(notifications.filter(x=>x.startsWith('result')).length,1);});
 test(name+': legacy vote lasts 24 hours; view closes it at deadline',()=>{let {ctx,files,notifications,now,at}=setup(source),start=now();files['votes.json']=[{id:'old',by:'Alice',target:'Bob',q:'old',opts:['a','b'],votes:{},at:start}];at(start+6*36e5);let view=ctx.votesView_('Alice');assert.equal(view[0].closed,false);assert.equal(view[0].ends,start+24*36e5);at(start+24*36e5);view=ctx.votesView_('Alice');assert.equal(view[0].closed,true);assert.equal(notifications.filter(x=>x.startsWith('result')).length,1);});
 test(name+': expired polls free capacity and all-voted still closes early',()=>{let {ctx,files,now}=setup(source),start=now();files['votes.json']=Array.from({length:3},(_,i)=>({id:'old'+i,by:'Alice',target:'Bob',q:'old',opts:['a','b'],votes:{},at:start-7*36e5,ends:start-1}));assert.equal(ctx.voteNew_('Alice',{target:'Bob',q:'choose',opts:['one','two']}).s,200);let v=files['votes.json'].find(x=>!x.closed);for(const actor of ['Alice','Bob','Carol'])assert.equal(ctx.voteCast_(actor,{id:v.id,i:0}).s,200);assert.equal(files['votes.json'].find(x=>x.id===v.id).closed,true);});
}
test('builder preserves unrelated bytes and rejects drift, duplicates and reapplication',()=>{let out=build(portable), reversed=out;for(const [old,next] of [...replacements].reverse())reversed=reversed.replace(next,old);assert.equal(reversed,portable);assert.throws(()=>build(out));assert.throws(()=>build(portable+'\n'+replacements[0][0]));assert.throws(()=>build(portable.replace(replacements[0][0],'')));});
