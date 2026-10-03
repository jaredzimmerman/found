const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2000);
  await p.evaluate(()=>window.scrollTo(0,1400));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(()=>{
    const bar=document.querySelector("#bar");
    const top=document.querySelector(".fbar-top");
    const bb=bar.getBoundingClientRect(), tb=top.getBoundingClientRect();
    const cs=getComputedStyle(top);
    const M=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);
      return {t:e.tagName.toLowerCase()+(e.className?"."+String(e.className).split(" ")[0]:""),
              txt:(e.textContent||"").trim().replace(/\s+/g," ").slice(0,18),
              x:+b.x.toFixed(1), r:+b.right.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1),
              cy:+((b.top+b.height/2)).toFixed(1), fs:s.fontSize};};
    const kids=[...top.children].map(M);
    // gaps between consecutive visible children
    const gaps=[];
    for(let i=1;i<kids.length;i++) gaps.push({a:kids[i-1].t,b:kids[i].t,px:+(kids[i].x-kids[i-1].r).toFixed(1)});
    return {
      barH:+bb.height.toFixed(1), barY:+bb.y.toFixed(1),
      topH:+tb.height.toFixed(1), topCy:+((tb.top+tb.height/2)).toFixed(1),
      topDisplay:cs.display, topAlign:cs.alignItems, topGap:cs.gap, topPad:cs.padding,
      kids, gaps,
      brand:(()=>{const e=top.querySelector(".brand");if(!e)return null;const s=getComputedStyle(e);
        return {...M(e), mw:s.marginLeft, w:s.width, ov:s.overflow, op:s.opacity};})(),
      chips:[...top.querySelectorAll("#f-day .chip")].map(M),
    };
  });
  console.log(JSON.stringify(r,null,1));
  await p.screenshot({path:"hdr.png",clip:{x:0,y:0,width:1440,height:66}});
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
