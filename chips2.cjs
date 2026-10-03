const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const row=[...document.querySelectorAll(".row")].find(r=>r.querySelector(".tag"));
    const time=row.querySelector(".time-col"), tag=row.querySelector(".tag");
    const body=row.querySelector(".row-title")||row.querySelector(".title-e");
    const chain=[];let e=tag;
    while(e && e!==document.documentElement){
      const s=getComputedStyle(e);
      chain.push({n:String(e.className||e.tagName).slice(0,30),ml:s.marginLeft,pl:s.paddingLeft,pos:s.position,left:s.left,tf:s.transform.slice(0,20),w:+e.getBoundingClientRect().width.toFixed(1),x:+e.getBoundingClientRect().x.toFixed(1)});
      e=e.parentElement;
    }
    const s=getComputedStyle(tag);
    return {
      rowX:+row.getBoundingClientRect().x.toFixed(1),
      timeX:+time.getBoundingClientRect().x.toFixed(1),
      titleX:+body.getBoundingClientRect().x.toFixed(1),
      tagX:+tag.getBoundingClientRect().x.toFixed(1),
      tagTxt:tag.textContent.trim().slice(0,22),
      tagStyle:{ml:s.marginLeft,pl:s.paddingLeft,pos:s.position,left:s.left,disp:s.display,bt:s.borderTopWidth},
      chain,
    };
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
