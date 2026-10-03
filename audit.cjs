const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1185,height:820}, deviceScaleFactor:1});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2500);
  await p.evaluate(()=>window.scrollTo(0,1400));
  await p.waitForTimeout(1500);

  const r = await p.evaluate(()=>{
    const out={};
    const vis=el=>{const s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&el.getBoundingClientRect().height>0;};
    const box=el=>{const b=el.getBoundingClientRect();const s=getComputedStyle(el);
      return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),
              cy:+(b.y+b.height/2).toFixed(1),fs:s.fontSize,ff:s.fontFamily.split(",")[0].replace(/"/g,""),fw:s.fontWeight,color:s.color};};

    // 1. every event row: do time / title / price share a sane baseline?
    const rows=[...document.querySelectorAll("#list .row")].slice(0,12);
    out.rowCount=document.querySelectorAll("#list .row").length;
    out.rows=rows.slice(0,6).map(rw=>{
      const timeCol=rw.querySelector(".time-col"), title=rw.querySelector(".title,.t-title,a"),
            price=rw.querySelector(".price,.time-price");
      return {
        time: timeCol&&box(timeCol),
        title: title&&box(title),
        price: price&&box(price),
        chips: [...rw.querySelectorAll(".chip,.tag")].map(c=>box(c)).slice(0,3),
      };
    });
    // 2. anything overflowing the viewport horizontally?
    const wide=[...document.querySelectorAll("#list *,.fbar-top *")].filter(el=>{
      const b=el.getBoundingClientRect();
      return vis(el) && (b.right>innerWidth+1 || b.left<-1);
    }).slice(0,8).map(el=>({n:el.className||el.tagName, ...box(el)}));
    out.overflowing=wide;
    // 3. clipped text (scrollWidth > clientWidth)
    const clipped=[...document.querySelectorAll("#list .row *")].filter(el=>{
      if(!vis(el))return false;
      return el.scrollWidth>el.clientWidth+2 && getComputedStyle(el).overflow!=="visible";
    }).slice(0,10).map(el=>({n:el.className||el.tagName,txt:(el.textContent||"").trim().slice(0,30),sw:el.scrollWidth,cw:el.clientWidth}));
    out.clipped=clipped;
    // 4. day headings
    out.days=[...document.querySelectorAll(".day-head,.dayh,.day-title,.daybreak")].slice(0,6).map(el=>({n:el.className,txt:el.textContent.trim().slice(0,30),...box(el)}));
    // 5. price text values — is anything still the literal word "TICKETED"?
    const prices=[...document.querySelectorAll("#list .price,#list .time-price")].slice(0,20).map(e=>e.textContent.trim());
    out.prices=[...new Set(prices)].slice(0,14);
    out.soldOut=[...document.querySelectorAll("#list *")].filter(e=>/sold out|sold-out/i.test(e.className||"")).length;
    return out;
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
