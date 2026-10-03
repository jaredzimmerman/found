const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:1000}, deviceScaleFactor:4});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const t=[...document.querySelectorAll("#list .row .time")].find(x=>x.textContent.includes("—"));
    const kids=[...t.childNodes];
    const out=[];
    for(const n of kids){
      if(n.nodeType===3){
        // Measure the INK: strip leading/trailing space by measuring sub-ranges.
        const txt=n.textContent;
        const lead=txt.match(/^\s*/)[0].length, trail=txt.match(/\s*$/)[0].length;
        const rg=document.createRange();
        rg.setStart(n, lead); rg.setEnd(n, txt.length-trail);
        const b=rg.getBoundingClientRect();
        out.push({kind:"text", txt:JSON.stringify(txt), lead, trail,
                  inkL:+b.left.toFixed(2), inkR:+b.right.toFixed(2)});
      } else {
        const b=n.getBoundingClientRect();
        out.push({kind:"mer", txt:n.textContent, inkL:+b.left.toFixed(2), inkR:+b.right.toFixed(2)});
      }
    }
    const gaps=[];
    for(let i=1;i<out.length;i++)
      gaps.push({from:out[i-1].txt, to:out[i].txt, px:+(out[i].inkL-out[i-1].inkR).toFixed(2)});
    return {html:t.innerHTML, out, gaps};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
