const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
(async () => {
  const b = await pw.chromium.launch({executablePath:"/usr/bin/google-chrome-stable",args:["--no-sandbox"]});
  const p = await b.newPage({viewport:{width:1440,height:1000}});
  await p.goto("https://datebook.indigokarasu.com/",{waitUntil:"networkidle",timeout:45000});
  await p.waitForTimeout(2000);
  const r = await p.evaluate(()=>{
    const t=[...document.querySelectorAll("#list .row .time")].find(x=>x.textContent.includes("—"));
    return {html:t.innerHTML,
            kids:[...t.childNodes].map(n=>n.nodeType===3?`TEXT ${JSON.stringify(n.textContent)}`:`EL ${n.className} ${JSON.stringify(n.textContent)}`)};
  });
  console.log(JSON.stringify(r,null,1));
  await b.close();
})().catch(e=>console.error("FATAL",e.message));
