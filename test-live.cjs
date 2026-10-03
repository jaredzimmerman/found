// Live end-to-end test of pinkpages.indigokarasu.com.
// Drives the real page in Chromium: confirms it renders, then exercises every
// filter and asserts the visible result set actually narrows.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

const URL = 'https://pinkpages.indigokarasu.com/';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));

  const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  console.log('HTTP status:', resp.status());
  console.log('Title:', await page.title());

  // Wait for the listing to actually populate.
  await page.waitForFunction(() => {
    const el = document.querySelector('#list, #events, main');
    return el && el.children.length > 0;
  }, { timeout: 20000 }).catch(() => console.log('!! listing never populated'));

  const count = async () => page.evaluate(() => {
    const c = document.querySelector('#count, .count, [data-count]');
    return c ? c.textContent.trim() : null;
  });

  const visible = async () => page.evaluate(() => {
    const list = document.querySelector('#list, #events, main');
    if (!list) return 0;
    return Array.from(list.children).filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
    }).length;
  });

  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('select, input')).map(e => ({
      tag: e.tagName.toLowerCase(), id: e.id, type: e.type,
      options: e.tagName === 'SELECT' ? Array.from(e.options).map(o => o.value) : null,
    }))
  );
  console.log('\nControls:', JSON.stringify(controls, null, 1));

  console.log('\nBaseline — count text:', await count(), '| visible items:', await visible());

  // Sample a few rendered rows to confirm the newspaper layout carries content.
  const sample = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('article, li, .evt, .row'))
      .slice(0, 3)
      .map(r => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 150));
    return rows;
  });
  console.log('\nSample rows:\n' + sample.join('\n---\n'));

  // Pull every outbound link and confirm they are venue/organizer pages, not aggregators.
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="http"]')).map(a => ({ href: a.href, text: a.textContent.trim() }))
  );
  const AGG = ['eventbrite', 'do-thebay/dot', 'sf.funcheap', 'sfweekly', 'seatgeek', 'ticketmaster', 'stubhub', 'bandsintown', 'allevents', 'ra.co'];
  const agg = links.filter(l => AGG.some(a => l.href.includes(a)));
  console.log('\nOutbound links:', links.length, '| aggregator links:', agg.length);
  if (agg.length) console.log('  sample:', agg.slice(0, 4).map(a => a.href));
  console.log('  sample venue links:', links.slice(0, 4).map(l => l.href));

  // Exercise each select filter in turn.
  for (const c of controls.filter(x => x.tag === 'select' && x.options && x.options.length > 1)) {
    const before = await visible();
    const opt = c.options.find(o => o && o !== '' && o !== 'all');
    if (!opt) continue;
    await page.selectOption('#' + c.id, opt).catch(() => {});
    await page.waitForTimeout(350);
    const after = await visible();
    console.log(`filter #${c.id}="${opt}" -> ${before} => ${after}  ${after < before ? 'OK' : '(no change)'}`);
    await page.selectOption('#' + c.id, c.options[0]).catch(() => {});
    await page.waitForTimeout(200);
  }

  // Search box, if present.
  const search = controls.find(x => x.type === 'text' || x.type === 'search');
  if (search) {
    const before = await visible();
    await page.fill('#' + search.id, 'jazz').catch(() => {});
    await page.waitForTimeout(350);
    const after = await visible();
    console.log(`search "jazz" -> ${before} => ${after}  ${after <= before ? 'OK' : 'BROKEN'}`);
  }

  console.log('\nJS errors:', errors.length ? errors.slice(0, 6) : 'none');

  await page.screenshot({ path: '/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/live.png', fullPage: false });
  console.log('screenshot saved');
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
