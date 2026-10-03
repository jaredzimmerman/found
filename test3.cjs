// Verification that each filter behaves as designed, and that the reset button
// truly clears every facet. Type/price chips are intentionally multi-select.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  const rows = () => page.evaluate(() => document.querySelectorAll('#list a[href^="http"]').length);
  const countTxt = () => page.evaluate(() => {
    const c = document.querySelector('#count');
    return c ? c.textContent.trim() : null;
  });
  const clickChip = async (label) => {
    const btns = await page.$$('button.chip');
    for (const b of btns) {
      const t = (await b.textContent()).trim();
      if (t.replace(/\d+$/, '').trim() === label) { await b.click(); await page.waitForTimeout(350); return true; }
    }
    return false;
  };
  const reset = async () => {
    const r = await page.$('#reset');
    if (r) { await r.click(); await page.waitForTimeout(350); return true; }
    return false;
  };

  console.log('BASELINE           rows:', await rows(), '| count:', await countTxt());

  // Price facets — single-select semantics should be clean
  await clickChip('Free');
  console.log('price=Free         rows:', await rows());
  await reset();

  await clickChip('Paid');
  console.log('price=Paid         rows:', await rows());
  await reset();

  console.log('\n--- multi-select on type ---');
  await clickChip('Comedy');
  const c1 = await rows();
  await clickChip('Film & Movies');
  const c2 = await rows();
  console.log('Comedy then Comedy+Film ->', c1, '->', c2, c2 > c1 ? '(union, correct)' : '(WRONG)');
  await reset();
  console.log('after reset         rows:', await rows(), '(expect 74)');

  console.log('\n--- reset truly clears ---');
  await clickChip('Theater & Dance');
  await page.selectOption('#f-venue', 'Roxie Theater').catch(() => {});
  await page.fill('#f-q', 'music');
  await page.waitForTimeout(400);
  console.log('3 filters stacked   rows:', await rows());
  const didReset = await reset();
  console.log('reset clicked:', didReset, '| rows:', await rows(), '| count:', await countTxt());

  console.log('\n--- day + type combined (AND across facets) ---');
  await clickChip('wednesday');
  const dOnly = await rows();
  await clickChip('Concerts & Music');
  const dAndT = await rows();
  console.log('wednesday only:', dOnly, '| wednesday AND Concerts:', dAndT, dAndT < dOnly ? '(AND, correct)' : '(WRONG)');
  await reset();

  console.log('\n--- empty result state ---');
  await page.fill('#f-q', 'zzzznotathing');
  await page.waitForTimeout(400);
  const emptyMsg = await page.evaluate(() => {
    const l = document.querySelector('#list');
    return l ? l.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  });
  console.log('rows:', await rows(), '| message:', emptyMsg);
  await reset();

  console.log('\n--- sold-out must be absent from the data ---');
  const soldOut = await page.evaluate(async () => {
    const d = await (await fetch('events.json')).json();
    return { total: d.events.length, withSoldOutFlag: d.events.filter(e => e.soldOut === true).length };
  });
  console.log('sold-out entries in feed:', JSON.stringify(soldOut));

  console.log('\nJS errors:', errors.length ? errors.slice(0, 5) : 'none');
  await page.screenshot({ path: '/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/final.png', fullPage: false });
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
