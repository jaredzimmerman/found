const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const first=document.querySelector("#list .row");
    if(!first)return {ok:false};
    const tags=first.querySelectorAll(".tag");
    const desc=first.querySelector(".desc");
    const time=first.querySelector(".time-col");
    const title=first.querySelector(".title-e, .t-title, .title");
    const M=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
    const out={ok:true};
    if(tags.length){
      const firstTag=tags[0];
      const tagR=M(firstTag);
      const descR=desc?M(desc):null;
      const titleR=title?M(title):null;
      out.title=titleR?{...titleR,txt:(title.textContent||"").trim().slice(0,30)}:null;
      out.firstTag={...tagR, txt:firstTag.textContent.trim().slice(0,20)};
      out.desc=descR?{...descR,txt:(desc.textContent||"").trim().slice(0,30)}:null;
      // Are tag and desc on the same line?
      out.sameLine=descR && Math.abs(descR.y - tagR.y) < 2;
      // Horizontal gap: desc left - tag right
      out.hGap=descR?+(descR.x - (tagR.x+tagR.w)).toFixed(1):null;
      // Vertical gap: desc top - tag bottom (if on different lines)
      out.vGap=descR && !out.sameLine ? +(descR.y - (tagR.y+tagR.h)).toFixed(1) : null;
      // Are they overlapping?
      out.overlap=descR && !(descR.x >= tagR.x+tagR.w || (descR.x+descR.w) <= tagR.x);
    }
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
