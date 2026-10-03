const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:900}, deviceScaleFactor:2});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>window.scrollTo(0,1400));
  await p.waitForTimeout(1600);
  await p.screenshot({path:"live-strip.png",clip:{x:0,y:0,width:1185,height:105}});
  const r = await p.evaluate(()=>{
    const top=document.querySelector(".fbar-top"), bar=document.querySelector("#bar");
    const M=e=>{const b=e.getBoundingClientRect();return {n:(e.className||e.tagName)+"",x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
    return {bar:M(bar), kids:[...top.children].map(M),
      barBorderBottom:getComputedStyle(bar).borderBottom,
      bodyBg:getComputedStyle(document.body).backgroundColor};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
