
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
  await p.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  const out = await p.evaluate(() => {
    const t = (s) => (document.querySelector(s)?.innerText || '').replace(/\n+/g, ' | ').trim();
    const rows = [...document.querySelectorAll('.row')].slice(0, 4).map((n) =>
      (n.innerText || '').replace(/\n+/g, ' ~ ').trim().slice(0, 120));
    const heads = [...document.querySelectorAll('h1, h2, .mast, .tagline, .dayhead, h3')].slice(0, 10)
      .map((n) => n.tagName + ': ' + n.innerText.replace(/\n+/g, ' ').trim().slice(0, 70));
    return { title: document.title, heads, mast: t('header'), rows, foot: t('footer') };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
