const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:1000}, deviceScaleFactor:4});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const t=[...document.querySelectorAll("#list .row .time")].find(x=>x.querySelector(".dash"));
    const out=[...t.childNodes].map(n=>{
      if(n.nodeType===3){
        const txt=n.textContent, lead=txt.match(/^\s*/)[0].length, trail=txt.match(/\s*$/)[0].length;
        if(txt.trim()==="") return {kind:"empty",txt:JSON.stringify(txt)};
        const rg=document.createRange(); rg.setStart(n,lead); rg.setEnd(n,txt.length-trail);
        const b=rg.getBoundingClientRect();
        return {kind:"text",txt:JSON.stringify(txt),inkL:+b.left.toFixed(2),inkR:+b.right.toFixed(2)};
      }
      const b=n.getBoundingClientRect();
      return {kind:n.className,txt:n.textContent,inkL:+b.left.toFixed(2),inkR:+b.right.toFixed(2)};
    });
    const gaps=[];
    for(let i=1;i<out.length;i++){
      if(out[i].kind==="empty"||out[i-1].kind==="empty") continue;
      gaps.push({from:out[i-1].txt,to:out[i].txt,px:+(out[i].inkL-out[i-1].inkR).toFixed(2)});
    }
    return {html:t.innerHTML,gaps};
  });
  console.log("html:",r.html);
  r.gaps.forEach(g=>console.log(`  ${String(g.from).padEnd(16)} -> ${String(g.to).padEnd(16)} ${g.px}px`));
  const clip = await p.evaluate(()=>{
    const ts=[...document.querySelectorAll("#list .row .time")].slice(0,5);
    const a=ts[0].getBoundingClientRect(), z=ts[4].getBoundingClientRect();
    return {x:Math.max(0,a.left-12),y:Math.max(0,a.top-8),width:200,height:Math.round(z.bottom-a.top)+16};
  });
  await p.screenshot({path:"/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/time-after.png",clip});
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
