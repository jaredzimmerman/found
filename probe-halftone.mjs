
import { chromium } from "playwright-core";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--disable-setuid-sandbox"]});
const p = await b.newPage({viewport:{width:1440,height:1000}});
await p.goto("https://pinkpages.indigokarasu.com/?cb="+Date.now(),{waitUntil:"networkidle",timeout:60000});
await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(1200);
const r = await p.evaluate(()=>{
  const img=document.querySelector(".figure img");
  const cs=getComputedStyle(img);
  // does the dot grid overlay actually exist and paint?
  const fig=document.querySelector(".figure");
  const after=getComputedStyle(fig,"::after");
  return {
    imgFilter: cs.filter,
    imgTransform: cs.transform,
    dotGrid: { content: after.content, position: after.position, mixBlend: after.mixBlendMode, opacity: after.opacity, bg: after.backgroundImage.slice(0,60) },
    dotGridIsPainted: after.content !== "none" && after.backgroundImage !== "none",
    dotGridPresentInDom: !!fig.querySelector("::after"),
    // the fallback only fires if the engine lacks mix-blend-mode
    supportsMultiply: CSS.supports("mix-blend-mode","multiply"),
    supportsFilter: CSS.supports("filter","grayscale(1)"),
  };
});
console.log(JSON.stringify(r,null,2));
await b.close();
