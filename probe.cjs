const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(3000);
  const r = await p.evaluate(()=>{
    const top=document.querySelector(".fbar-top");
    const brand=top.querySelector(".brand"), bb=brand.querySelector("b");
    const csb=getComputedStyle(bb);
    // 1. what does the CURRENT measureBrand clone technique return?
    const probe=document.createElement("div");
    probe.style.cssText="position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap";
    const clone=brand.cloneNode(true);
    clone.style.cssText="width:auto;max-width:none;opacity:1;position:static";
    probe.appendChild(clone); document.body.appendChild(probe);
    const cloneW=Math.ceil(clone.getBoundingClientRect().width);
    const cloneB=Math.ceil(clone.querySelector("b").getBoundingClientRect().width);
    probe.remove();
    // 2. what does the LIVE <b> need?
    const liveB=Math.ceil(bb.getBoundingClientRect().width);
    // 3. font actually used?
    return {
      varFull: getComputedStyle(top).getPropertyValue("--brand-w-full").trim(),
      liveB, cloneW, cloneB,
      bFont: csb.fontFamily, bSize: csb.fontSize, bWeight: csb.fontWeight,
      bLS: csb.letterSpacing,
      fontsReady: document.fonts.status,
      playfairLoaded: document.fonts.check('900 22px "Playfair Display"'),
      brandBox: +brand.getBoundingClientRect().width.toFixed(1),
    };
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
