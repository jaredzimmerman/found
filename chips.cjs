const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const row=[...document.querySelectorAll("#list .row")].find(r=>r.querySelector(".chip"));
    const time=row.querySelector(".time-col"), chip=row.querySelector(".chip");
    const chain=[];let e=chip;
    while(e && e!==document.documentElement){
      const s=getComputedStyle(e);
      chain.push({n:String(e.className||e.tagName).slice(0,34),ml:s.marginLeft,pl:s.paddingLeft,pos:s.position,left:s.left,tf:s.transform});
      e=e.parentElement;
    }
    const s=getComputedStyle(chip);
    return {
      rowClass:row.className,
      rowBox:{x:row.getBoundingClientRect().x,w:row.getBoundingClientRect().width},
      timeX:+time.getBoundingClientRect().x.toFixed(1),
      chipClass:chip.className, chipTxt:chip.textContent.trim().slice(0,20),
      chipX:+chip.getBoundingClientRect().x.toFixed(1),
      chipStyle:{ml:s.marginLeft,mr:s.marginRight,pl:s.paddingLeft,pr:s.paddingRight,pos:s.position,left:s.left,tf:s.transform,disp:s.display},
      chain,
    };
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
