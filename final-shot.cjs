const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:700}, deviceScaleFactor:2});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>window.scrollTo(0,1400));
  await p.waitForTimeout(1600);
  await p.screenshot({path:"final-hdr.png",clip:{x:0,y:0,width:1185,height:64}});
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
