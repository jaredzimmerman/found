// Full verification of the deployed site, including the new link-tier filter.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const r = await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  console.log('HTTP', r.status(), '|', await page.title());
  await page.waitForTimeout(1000);

  const rows = () => page.evaluate(() => document.querySelectorAll('#list a[href^="http"]').length);
  const clickChip = async (label) => {
    for (const b of await page.$$('button.chip')) {
      if ((await b.textContent()).trim().replace(/\d+$/, '').trim() === label) { await b.click(); await page.waitForTimeout(320); return true; }
    }
    return false;
  };
  const reset = async () => { const b = await page.$('#reset'); if (b) { await b.click(); await page.waitForTimeout(320); } };

  console.log('\ngroups:', await page.evaluate(() =>
    Array.from(document.querySelectorAll('.chips')).map(c => c.id + ' = ' + Array.from(c.querySelectorAll('button.chip')).map(b => b.textContent.trim()).join('/')).join('\n         ')));

  console.log('\n-- price --');
  console.log('baseline        ', await rows());
  await clickChip('Free');  console.log('Free            ', await rows()); await reset();
  await clickChip('Paid');  console.log('Paid            ', await rows()); await reset();
  await clickChip('Price not listed'); console.log('Not listed      ', await rows()); await reset();

  console.log('\n-- link tier --');
  await clickChip('Venue site'); console.log('Venue site only ', await rows()); await reset();
  await clickChip('Box office'); console.log('Box office only ', await rows()); await reset();
  await clickChip('Listing page'); console.log('Listing only    ', await rows()); await reset();

  console.log('\n-- type multi-select union --');
  await clickChip('Comedy'); const a = await rows();
  await clickChip('Film & Movies'); const b = await rows();
  console.log(`Comedy=${a} then +Film=${b}`, b > a ? '(union OK)' : '(WRONG)');
  await reset(); console.log('after reset     ', await rows());

  console.log('\n-- AND across facets --');
  await clickChip('wednesday'); const d = await rows();
  await clickChip('Concerts & Music'); const dt = await rows();
  console.log(`wednesday=${d} AND concerts=${dt}`, dt < d ? '(AND OK)' : '(WRONG)');
  await reset();

  console.log('\n-- venue + search --');
  await page.selectOption('#f-venue', 'The Warfield').catch(() => console.log('no such venue'));
  await page.waitForTimeout(300);
  console.log('venue=Warfield  ', await rows()); await reset();
  await page.fill('#f-q', 'jazz'); await page.waitForTimeout(350);
  console.log('search "jazz"   ', await rows()); await reset();

  console.log('\n-- empty state --');
  await page.fill('#f-q', 'qqzzxx'); await page.waitForTimeout(350);
  console.log('rows', await rows(), '|', (await page.evaluate(() => document.querySelector('#list').innerText.replace(/\s+/g,' ').trim().slice(0,90))));
  await reset();

  console.log('\n-- link labels rendered --');
  console.log(await page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('.dest'));
    const c = {}; d.forEach(x => c[x.dataset.tier] = (c[x.dataset.tier]||0)+1);
    return c;
  }));
  console.log('footer:', await page.evaluate(() => document.querySelector('#src').textContent));

  console.log('\n-- data integrity --');
  console.log(await page.evaluate(async () => {
    const d = await (await fetch('events.json')).json();
    return { total: d.events.length, soldOut: d.events.filter(e => e.soldOut === true).length, counts: d.counts };
  }));

  console.log('\nJS errors:', errors.length ? errors.slice(0,5) : 'none');
  await page.screenshot({ path: 'verify.png' });
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
