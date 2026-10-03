const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  // Horizontal overflow is the classic mobile break.
  const ov = await p.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  console.log('mobile overflow check:', JSON.stringify(ov));
  const m = await p.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize);
  console.log('mobile masthead size:', m);
  await p.screenshot({ path: 'mob.png' });
  await b.close();
})();
