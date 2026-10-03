const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  for (const W of [1185, 1440]) {
    const p = await b.newPage({viewport:{width:W,height:900}, deviceScaleFactor:2});
    await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
    await p.waitForTimeout(1800);
    await p.evaluate(()=>window.scrollTo(0,1400));
    await p.waitForTimeout(1500);
    const r = await p.evaluate(()=>{
      const top=document.querySelector(".fbar-top");
      const bar=document.querySelector("#bar");
      const br=top.querySelector(".brand"), b=br.querySelector("b");
      // Is the wordmark CLIPPED? compare the text's natural width to the box.
      const need=b.getBoundingClientRect().width, have=br.getBoundingClientRect().width;
      const M=e=>{const x=e.getBoundingClientRect();return {x:+x.x.toFixed(1),r:+x.right.toFixed(1),w:+x.width.toFixed(1),h:+x.height.toFixed(1),cy:+(x.top+x.height/2).toFixed(1),t:(e.textContent||"").trim().replace(/\s+/g," ").slice(0,14)};};
      const kids=[...top.children].map(M);
      const gaps=[];for(let i=1;i<kids.length;i++)gaps.push(+(kids[i].x-kids[i-1].r).toFixed(1));
      return {
        vw:innerWidth, barH:+bar.getBoundingClientRect().height.toFixed(1),
        wrapH:+top.getBoundingClientRect().height.toFixed(1),
        lines: new Set([...top.children].map(c=>Math.round(c.getBoundingClientRect().top))).size,
        brandBox:+have.toFixed(1), brandNeeds:+need.toFixed(1), clipped: need>have+0.5,
        brandVar:getComputedStyle(top).getPropertyValue("--brand-w-full"),
        kids, gaps,
      };
    });
    console.log("=== "+W+" ===");
    console.log(JSON.stringify(r,null,1));
    await p.screenshot({path:`hdr-${W}.png`,clip:{x:0,y:0,width:W,height:64}});
    await p.close();
  }
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
