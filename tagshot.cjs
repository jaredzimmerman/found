const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}, deviceScaleFactor:3});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const clip = await p.evaluate(()=>{
    const row=[...document.querySelectorAll("#list .row")].find(r=>r.querySelector(".desc")&&r.querySelector(".tag"));
    const d=row.querySelector(".desc").getBoundingClientRect();
    const t=row.querySelector(".tag").getBoundingClientRect();
    // one full chip block, with air above and below
    row.scrollIntoView({block:"center"});
    return null;
  });
  await p.waitForTimeout(800);
  const c2 = await p.evaluate(()=>{
    const row=[...document.querySelectorAll("#list .row")].find(r=>r.querySelector(".desc")&&r.querySelector(".tag"));
    const d=row.querySelector(".desc").getBoundingClientRect();
    const t=row.querySelector(".tag").getBoundingClientRect();
    const top=Math.min(d.top,t.top)-18, bot=Math.max(d.bottom,t.bottom)+18;
    return {x:0,y:top,width:640,height:Math.min(bot-top, 700)};
  });
  await p.screenshot({path:"tag-spacing.png", clip:c2});
  console.log("clip",JSON.stringify(c2));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
