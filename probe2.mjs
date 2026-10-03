
import { chromium } from "playwright-core";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--disable-setuid-sandbox"]});
const p = await b.newPage({viewport:{width:1440,height:1000}});
await p.goto("https://pinkpages.indigokarasu.com/?cb="+Date.now(),{waitUntil:"networkidle",timeout:60000});
await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(1000);
const r = await p.evaluate(()=>{
  const t=document.querySelector(".tag");
  const cs=getComputedStyle(t);
  const bb=t.getBoundingClientRect();
  // scrollHeight of the text node alone, with no padding, gives the content
  // height the browser computed for this line.
  const probe=document.createElement("span");
  probe.style.cssText="position:absolute;left:-9999px;top:-9999px;font-size:"+cs.fontSize+
    ";font-weight:"+cs.fontWeight+";font-family:"+cs.fontFamily+";letter-spacing:"+cs.letterSpacing+
    ";text-transform:"+cs.textTransform+";white-space:nowrap";
  probe.textContent=t.textContent;
  document.body.appendChild(probe);
  const ph=probe.getBoundingClientRect().height;
  probe.remove();
  // What the tag's OWN line box would be at various line-heights, no padding.
  return {
    boxH:Math.round(bb.height), fontSize:cs.fontSize, fontWeight:cs.fontWeight,
    lineHeight:cs.lineHeight, borderWidth:cs.borderWidth, boxSizing:cs.boxSizing,
    textPx:ph, // intrinsic text height, no line box
    // content height = boxH - 2*border - 2*padding
    contentH:Math.round(bb.height-2*parseFloat(cs.borderWidth)-2*parseFloat(cs.paddingTop)),
  };
});
console.log(JSON.stringify(r,null,2));
await b.close();
