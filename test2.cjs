// Correct end-to-end test: chips are the filters, and events are rows inside
// .day sections. Measures real event counts, not section count.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

const URL = 'https://pinkpages.indigokarasu.com/';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  console.log('HTTP:', resp.status(), '| Title:', await page.title());
  await page.waitForTimeout(1200);

  // Count actual event rows: elements that carry a venue link.
  const countRows = () => page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('#list a[href^="http"]'));
    return links.length;
  });

  const visibleSections = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#list section.day'))
      .filter(s => s.offsetParent !== null).length);

  const countText = () => page.evaluate(() => {
    const c = document.querySelector('#count, .count, [data-count]');
    return c ? c.textContent.trim() : null;
  });

  const rowClass = await page.evaluate(() => {
    const a = document.querySelector('#list a[href^="http"]');
    return a ? a.parentElement.className + ' | parent2: ' + (a.parentElement.parentElement ? a.parentElement.parentElement.className : '') : null;
  });

  console.log('Row container class:', rowClass);
  console.log('Baseline rows:', await countRows(), '| count text:', await countText(), '| visible sections:', await visibleSections());

  // --- Day chips ---
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.chip')).map(b => b.textContent.trim()));
  console.log('\nChips:', chips.length, '->', chips.join(' | '));

  // Click the first day chip (tuesday)
  const dayChips = await page.$$('button.chip');
  if (dayChips[1]) {
    await dayChips[1].click();
    await page.waitForTimeout(400);
    console.log('\n[day filter] rows ->', await countRows(), '| visible sections:', await visibleSections());
    await dayChips[0].click(); await page.waitForTimeout(300);
  }

  // --- Type chips (non-day): find one with a decent count ---
  const typeNames = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.chip')).map(b => b.textContent.trim()));

  for (const label of ['Concerts & Music', 'Film', 'Comedy', 'Art & Exhibits']) {
    const target = typeNames.find(t => t.replace(/[0-9]+$/, '').trim() === label);
    if (!target) { console.log(`[type ${label}] chip not found`); continue; }
    const btns = await page.$$('button.chip');
    for (const b of btns) {
      const txt = (await b.textContent()).trim();
      if (txt.replace(/[0-9]+$/, '').trim() === label) {
        await b.click();
        await page.waitForTimeout(400);
        console.log(`[type ${label}] rows ->`, await countRows());
        break;
      }
    }
    const all = await page.$$('button.chip');
    if (all[0]) { await all[0].click(); await page.waitForTimeout(300); }
  }

  // --- Price chips ---
  const allChips = await page.$$('button.chip');
  const chipList = await page.evaluate(() => Array.from(document.querySelectorAll('button.chip')).map(b => b.textContent.trim()));
  console.log('\nAll chips (incl. price):', chipList.join(' | '));

  // --- Venue select ---
  await page.selectOption('#f-venue', 'The Warfield').catch(() => console.log('venue select failed'));
  await page.waitForTimeout(400);
  console.log('\n[venue=The Warfield] rows ->', await countRows());
  await page.selectOption('#f-venue', '').catch(() => {});
  await page.waitForTimeout(300);

  // --- Search ---
  await page.fill('#f-q', 'jazz');
  await page.waitForTimeout(400);
  console.log('[search "jazz"] rows ->', await countRows());
  await page.fill('#f-q', '');
  await page.waitForTimeout(300);

  // --- Combined ---
  const dayBtns2 = await page.$$('button.chip');
  if (dayBtns2[1]) await dayBtns2[1].click();
  await page.fill('#f-q', 'a');
  await page.waitForTimeout(400);
  console.log('[day + search "a"] rows ->', await countRows());
  const all2 = await page.$$('button.chip');
  if (all2[0]) await all2[0].click();
  await page.fill('#f-q', '');
  await page.waitForTimeout(300);
  console.log('[reset] rows ->', await countRows());

  console.log('\nJS errors:', errors.length ? errors.slice(0, 5) : 'none');
  await page.screenshot({ path: '/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/live.png' });
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
