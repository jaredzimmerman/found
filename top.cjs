const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}, deviceScaleFactor:2});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  // top of page: masthead + header + first rows
  await p.screenshot({path:"top-scrolled.png", clip:{x:0,y:0,width:1185,height:400}});
  // scrolled: sticky header over content
  await p.evaluate(()=>window.scrollTo(0,1400));
  await p.waitForTimeout(1600);
  await p.screenshot({path:"top-sticky.png", clip:{x:0,y:0,width:1185,height:400}});
  const errs=[];
  p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
  console.log("errors:",errs.length);
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
