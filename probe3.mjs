
import { chromium } from "playwright-core";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--disable-setuid-sandbox"]});
const p = await b.newPage({viewport:{width:1440,height:1000}});
await p.goto("https://pinkpages.indigokarasu.com/?cb="+Date.now(),{waitUntil:"networkidle",timeout:60000});
await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(1000);
const r = await p.evaluate(()=>{
  const t=document.querySelector(".tag");
  const cs=getComputedStyle(t); const bb=t.getBoundingClientRect();
  return {boxH:Math.round(bb.height), fontSize:cs.fontSize, borderWidth:cs.borderWidth,
    padding:cs.padding, margin:cs.margin, boxSizing:cs.boxSizing,
    contentH:Math.round(bb.height-2*parseFloat(cs.borderWidth)-2*parseFloat(cs.paddingTop)),
    boxTop:Math.round(bb.top), boxBottom:Math.round(bb.bottom)};
});
console.log(JSON.stringify(r,null,2));
await b.close();
