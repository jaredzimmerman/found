const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(3000);
  const r = await p.evaluate(()=>{
    const top=document.querySelector(".fbar-top");
    const brand=top.querySelector(".brand"), bb=brand.querySelector("b");
    const liveCS=getComputedStyle(bb);
    const probe=document.createElement("div");
    probe.style.cssText="position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap";
    const clone=brand.cloneNode(true);
    clone.style.cssText="width:auto;max-width:none;opacity:1;position:static";
    probe.appendChild(clone); document.body.appendChild(probe);
    const cb=clone.querySelector("b");
    const cloneCS=getComputedStyle(cb);
    const out={
      live:{size:liveCS.fontSize,ls:liveCS.letterSpacing,disp:liveCS.display,ff:liveCS.fontFamily.slice(0,20)},
      clone:{size:cloneCS.fontSize,ls:cloneCS.letterSpacing,disp:cloneCS.display,ff:cloneCS.fontFamily.slice(0,20)},
      liveW:+bb.getBoundingClientRect().width.toFixed(1),
      cloneW:+cb.getBoundingClientRect().width.toFixed(1),
      cloneParentDisplay:getComputedStyle(clone).display,
    };
    // Range measure of the live text — the direct method
    const rg=document.createRange(); rg.selectNodeContents(bb);
    out.liveRangeW=+rg.getBoundingClientRect().width.toFixed(1);
    probe.remove();
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
