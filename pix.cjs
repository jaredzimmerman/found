const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:900}, deviceScaleFactor:2});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>window.scrollTo(0,1400));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(()=>{
    const br=document.querySelector(".fbar-top .brand").getBoundingClientRect();
    const reset=document.querySelector("#reset");
    return {
      clip:{x:Math.floor(br.x)-4,y:Math.floor(br.y)-4,width:Math.ceil(br.width)+8,height:Math.ceil(br.height)+8},
      brandW:+br.width.toFixed(1),
      reset:{hiddenAttr:reset.hasAttribute("hidden"),display:getComputedStyle(reset).display,w:+reset.getBoundingClientRect().width.toFixed(1)},
    };
  });
  await p.screenshot({path:"brand-crop.png", clip:r.clip});
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
