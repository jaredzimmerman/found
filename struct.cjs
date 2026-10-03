const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    // find the deepest element that repeats (the card)
    const counts={};
    document.querySelectorAll("*").forEach(el=>{
      const c=String(el.className||"");
      if(c) counts[c]=(counts[c]||0)+1;
    });
    const common=Object.entries(counts).filter(([k,v])=>v>5).sort((a,b)=>b[1]-a[1]).slice(0,22);
    // find a repeated card and dump its children
    let card=null;
    for(const [c,n] of common){
      const el=document.querySelector("."+c.split(" ")[0]);
      if(el && el.children.length>=3 && n>5){ card=el; break; }
    }
    return {common, cardClass:card?card.className:null,
      cardHTML:card?card.outerHTML.slice(0,1400):null};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
