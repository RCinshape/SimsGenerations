// Local-only browser reproduction. Every request goes to the fake backend below.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(process.env.APP_SOURCE || path.join(__dirname, '..', 'index.html'), 'utf8');
const mock = `<script>
(() => {
  const KEY='qa-server', TRACE='qa-trace';
  const progress=name=>({name,current:1,updatedAt:1,gens:{1:{ticks:[2],heir:'Sample Heir',heirSimId:'1001',autoSeen:[]}}});
  if(!localStorage.getItem(KEY)) localStorage.setItem(KEY,JSON.stringify({progress:{'qa-alpha':progress('qa-alpha'),'qa-beta':progress('qa-beta')},feed:[]}));
  if(!localStorage.getItem('tg-token')) localStorage.setItem('tg-token','qa-alpha');
  let offline=false;
  const read=()=>JSON.parse(localStorage.getItem(KEY));
  const trace=e=>{const a=JSON.parse(localStorage.getItem(TRACE)||'[]');a.push(e);localStorage.setItem(TRACE,JSON.stringify(a));const p=document.getElementById('qa-trace');if(p)p.textContent=JSON.stringify(a,null,2);};
  window.fetch=async(url,options)=>{
    if(!String(url).startsWith('https://script.google.com/')) throw Error('fixture blocks all other fetch requests');
    const r=JSON.parse(options.body), actor=r.t, d=read();
    trace({route:r.api,actor,payloadName:r.b&&r.b.name,text:r.b&&r.b.text,ticks:r.b&&r.b.gens&&r.b.gens[1].ticks,offline});
    if(offline) throw Error('fixture offline');
    let value={ok:true};
    if(r.api==='whoami') value={name:actor};
    else if(r.api==='names') value={names:['qa-alpha','qa-beta']};
    else if(r.api==='live') value={me:actor,roster:['qa-alpha','qa-beta'],progress:Object.entries(d.progress).map(([name,data])=>({name,data})),feed:d.feed,reactions:[],sync:[],syncKeys:[],fams:[],famKeys:[],syncOn:false};
    else if(r.api==='progress') {d.progress[actor]=r.b;localStorage.setItem(KEY,JSON.stringify(d));}
    else if(r.api==='event') {d.feed.push({id:r.b.id,at:Date.now(),who:actor,type:r.b.type,gen:r.b.gen,text:r.b.text});localStorage.setItem(KEY,JSON.stringify(d));}
    else if(r.api==='logout') return {json:async()=>({s:200,d:{ok:true},t:''})};
    return {json:async()=>({s:200,d:value})};
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const panel=document.createElement('details');panel.open=true;panel.id='qa-controls';panel.style='position:relative;z-index:80;background:white;color:black;padding:12px;border:4px solid #a33;font:14px monospace';
    const title=document.createElement('summary');title.textContent='local reproduction controls — synthetic data, no live writes';panel.append(title);
    const button=(id,text,fn)=>{const b=document.createElement('button');b.id=id;b.textContent=text;b.onclick=fn;panel.append(b);};
    button('qa-offline','go offline',()=>{offline=true;trace({control:'offline'});});
    button('qa-online','reconnect and flush',async()=>{offline=false;await flush();await pull();render();trace({control:'reconnected',state:read()});});
    button('qa-account','switch the shared session to qa-beta',()=>{localStorage.setItem('tg-token','qa-beta');trace({control:'another tab picked qa-beta'});});
    button('qa-reset','reset this fixture',()=>{localStorage.clear();location.reload();});
    const pre=document.createElement('pre');pre.id='qa-trace';pre.style='max-height:200px;overflow:auto;white-space:pre-wrap;font:12px monospace';panel.append(pre);document.body.prepend(panel);
  });
})();
</script>`;
const html=source.replace('<head>','<head>'+mock);
module.exports={html};
if(require.main===module){
  const output=process.argv[2];
  if(!output) throw Error('supply an output HTML path');
  fs.writeFileSync(output,html);
  console.log(output);
}
