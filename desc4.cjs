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
      // Check if desc is a grid item that got its own row
      const descCS=getComputedStyle(desc);
      out.descGrid={d:descCS.display,fs:descCS.flexDirection};
      // Row wrapper flex?
      const rowCS=getComputedStyle(first);
      out.rowFlex={d:rowCS.display,wrap:rowCS.flexWrap,align:rowCS.alignItems};
      // Are they on same baseline? (time, tag, title)
      out.sameBaseline=titleR && tagR && Math.abs(titleR.y-tagR.y)<1 && Math.abs(tagR.y-timeR.y)<1;
    }
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
