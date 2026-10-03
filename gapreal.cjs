const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const out=[];
    [...document.querySelectorAll("#list .row")].slice(0,10).forEach((row,i)=>{
      const desc=row.querySelector(".desc"), tags=row.querySelector(".tags");
      const tag=row.querySelector(".tag");
      if(!desc||!tag) return;
      const d=desc.getBoundingClientRect(), t=tag.getBoundingClientRect(), ts=tags.getBoundingClientRect();
      out.push({
        i,
        tagY:+t.y.toFixed(1), tagB:+(t.y+t.height).toFixed(1),
        tagsY:+ts.y.toFixed(1), tagsB:+(ts.y+ts.height).toFixed(1),
        descY:+d.y.toFixed(1), descB:+(d.y+d.height).toFixed(1),
        gapTagsToDesc:+(d.y-(ts.y+ts.height)).toFixed(1),
        descMB:getComputedStyle(desc).marginTop,
        tagsGap:getComputedStyle(tags).gap,
        tagsMB:getComputedStyle(tags).marginTop+" / "+getComputedStyle(tags).marginBottom,
        tagsDisplay:getComputedStyle(tags).display,
        tagH:+t.height.toFixed(1),
      });
    });
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
