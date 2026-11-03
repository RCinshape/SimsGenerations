// Patch only documented vote behavior in an owner-provided backend bundle.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {createHash}=require('node:crypto');
const replacements=[
 ["var VOTE_HOURS = 24, MAX_OPEN_VOTES = 3, INBOX_KEEP = 40;", "var VOTE_HOURS = 24, VOTE_NEW_HOURS = 6, MAX_OPEN_VOTES = 3, INBOX_KEEP = 40;"],
 ["Polls close in 24 hours.", "Polls close in {hours} hours."],
 ["function votesView_(me) {\n  var all = readJson_('votes.json', []), now = Date.now(), tester = isTester_(me);", "function voteEnds_(v) { return Number.isSafeInteger(v.ends) && v.ends > 0 ? v.ends : v.at + VOTE_HOURS * 36e5; }\nfunction votesView_(me) {\n  closeVotes_();\n  var all = readJson_('votes.json', []), now = Date.now(), tester = isTester_(me);"],
 ["ends: v.at + VOTE_HOURS * 36e5", "ends: voteEnds_(v)"],
 ["if (!target || q.length < 3 || opts.length < 2) return res_(400, { error: 'bad_vote' });\n  return withLock_(function () {", "if (!target || q.length < 3 || opts.length < 2) return res_(400, { error: 'bad_vote' });\n  closeVotes_();\n  return withLock_(function () {"],
 ["var v = { id: randHex_(12), by: me, target: target, q: q, opts: opts, votes: {}, at: Date.now() };", "var at = Date.now();\n    var v = { id: randHex_(12), by: me, target: target, q: q, opts: opts, votes: {}, at: at, ends: at + VOTE_NEW_HOURS * 36e5 };"],
 ["voice_('vote', { who: b_(me), target: b_(target), x: q })", "voice_('vote', { who: b_(me), target: b_(target), x: q, hours: VOTE_NEW_HOURS })"],
 ["if (!v || v.closed || !(i >= 0 && i < v.opts.length)) return res_(400, { error: 'bad_vote' });", "if (!v || v.closed) return res_(400, { error: 'bad_vote' });\n    if (Date.now() >= voteEnds_(v)) { closeVote_(v); writeJson_('votes.json', all); return res_(400, { error: 'bad_vote' }); }\n    if (!(i >= 0 && i < v.opts.length)) return res_(400, { error: 'bad_vote' });"],
 ["/** Daily (and any time): close votes older than 24 hours. */", "/** Close votes at their stored deadline; older votes retain 24 hours. */"],
 ["if (!v.closed && Date.now() - v.at > VOTE_HOURS * 36e5)", "if (!v.closed && Date.now() >= voteEnds_(v))"]
];
function build(source){
 if(/\b(?:voteEnds_|VOTE_NEW_HOURS)\b/.test(source))throw Error('vote patch already present or conflicting');
 let out=source;
 for(const [old,replacement] of replacements){const i=out.indexOf(old);if(i<0||out.indexOf(old,i+old.length)>=0)throw Error('vote patch marker missing or duplicated');out=out.slice(0,i)+replacement+out.slice(i+old.length);}
 new vm.Script(out,{filename:'vote-six-hours-candidate.gs'});return out;
}
module.exports={build,replacements};
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('usage: node scripts/build-vote-six-hours.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');const source=fs.readFileSync(input,'utf8'),out=build(source);fs.writeFileSync(output,out,{mode:0o600});const hash=x=>createHash('sha256').update(x).digest('hex');console.log(JSON.stringify({inputSha256:hash(source),outputSha256:hash(out)}));}
