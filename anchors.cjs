const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    // Anchors that still look UNSTYLED: default UA blue, no reset.
    const suspect=[...document.querySelectorAll("a")].map(a=>{
      const s=getComputedStyle(a);
      return {cls:a.className||"(none)", color:s.color, dec:s.textDecorationLine, fs:s.fontSize,
              ff:s.fontFamily.split(",")[0], x:+a.getBoundingClientRect().x.toFixed(1),
              w:+a.getBoundingClientRect().width.toFixed(1), h:+a.getBoundingClientRect().height.toFixed(1),
              txt:(a.textContent||"").trim().replace(/\s+/g," ").slice(0,26)};
    }).filter(a=>a.color==="rgb(0, 0, 238)" || a.ff==="Times" || a.cls==="(none)");
    const uniq={};
    suspect.forEach(s=>{const k=s.cls+"|"+s.ff+"|"+s.color; uniq[k]=(uniq[k]||0)+1;});
    return {total:suspect.length, kinds:uniq, sample:suspect.slice(0,6)};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
