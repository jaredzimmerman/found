const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:900}, deviceScaleFactor:4});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  // find a card whose chips wrap
  const idx = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll("#list .row")];
    for(let i=0;i<rows.length;i++){
      const t=rows[i].querySelector(".tags");
      if(!t) continue;
      const cs=[...t.querySelectorAll(".tag")];
      if(cs.length<2) continue;
      const tops=new Set(cs.map(c=>Math.round(c.getBoundingClientRect().top)));
      if(tops.size>1){ rows[i].scrollIntoView({block:"center"}); return i; }
    }
    return -1;
  });
  await p.waitForTimeout(700);
  const clip = await p.evaluate((i)=>{
    const row=document.querySelectorAll("#list .row")[i];
    const t=row.querySelector(".tags").getBoundingClientRect();
    return {x:0,y:Math.max(0,t.top-16),width:1185,height:t.height+32};
  }, idx);
  await p.screenshot({path:"wrap-before.png", clip});
  console.log("row",idx,"clip",JSON.stringify(clip));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
