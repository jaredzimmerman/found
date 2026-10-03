const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:1000}, deviceScaleFactor:4});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const clip = await p.evaluate(()=>{
    const times=[...document.querySelectorAll("#list .row .time")].slice(0,5);
    const a=times[0].getBoundingClientRect(), z=times[times.length-1].getBoundingClientRect();
    return {x:Math.max(0,a.left-12), y:Math.max(0,a.top-8), width:200, height:Math.round(z.bottom-a.top)+16};
  });
  await p.screenshot({path:"/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/time-after.png", clip});
  console.log("clip", JSON.stringify(clip));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
