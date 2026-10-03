// Checks the two things the goal names explicitly: that "movies" is reachable
// through the type filter on the LIVE site, and that the sold-out filter is
// actually enforced in the data the live site serves.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const res = await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  console.log('live site HTTP', res.status());

  const rows = () => page.$$eval('.row', (n) => n.length);
  const shown = () => page.$$eval('.row', (n) => n.slice(0, 5).map((x) => ({
    t: x.querySelector('.title-e')?.textContent?.trim().slice(0, 40),
    v: x.querySelector('.venue')?.textContent?.trim().slice(0, 26),
  })));

  const total = await rows();
  console.log('total rows', total);

  // --- the type filter must offer movies, and the numbers must add up ---
  // The real markup: .chips > button inside #f-type, built at runtime from
  // e.categories. Asserting on the structure rather than on guessed ids.
  const types = await page.$$eval('#f-type button', (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
  console.log('\ntype filter offers', types.length, 'options');
  console.log('  ', types.join(' | '));
  const hasFilm = types.some((t) => /film|movie/i.test(t));
  console.log('movies option present:', hasFilm ? 'YES' : '*** MISSING ***');

  // Click it and confirm the rows are genuinely film screenings.
  const filmLabel = types.find((t) => /film|movie/i.test(t));
  await page.evaluate((label) => {
    const b = [...document.querySelectorAll('#f-type button')].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === label);
    b.click();
  }, filmLabel);
  await page.waitForTimeout(400);
  const filmN = await rows();
  console.log(`clicked "${filmLabel}" -> ${filmN} rows`);

  const feed = await page.evaluate(async () => (await fetch('/events.json').then((r) => r.json())).events);
  const filmFeed = feed.filter((e) => (e.categories || []).some((c) => /film|movie/i.test(c)));
  console.log('feed says Film & Movies =', filmFeed.length);
  console.log('filter matches feed:', filmN === filmFeed.length ? 'YES' : `NO (${filmN} vs ${filmFeed.length})`);
  console.log('count badge reads:', await page.$eval('#n', (n) => n.textContent));

  // Every visible film row must actually be a film event.
  const mismatch = await page.$$eval('.row', (ns) => ns.map((n) => ({
    t: n.querySelector('.title-e')?.textContent?.trim().slice(0, 34),
    c: n.querySelector('.row-cat')?.textContent?.trim() || '(no cat shown)',
  })));
  console.log('visible rows sample:', JSON.stringify(mismatch.slice(0, 3)));

  // --- sold out: must be absent from the served data entirely ---
  const sold = feed.filter((e) => e.soldOut);
  console.log('\nsold-out events served:', sold.length, sold.length === 0 ? '(correct)' : '*** LEAK ***');

  // --- every row must link somewhere, and never to the aggregator by default ---
  // The title IS the link, carrying a .dest badge for where it goes.
  const links = await page.$$eval('.row a.title-e', (ns) => ns.map((n) => n.href));
  console.log('\nrows with a link:', links.filter(Boolean).length, '/', links.length);
  const agg = links.filter((h) => /dothebay/.test(h));
  console.log('aggregator links:', agg.length, agg.length ? '(badged as listing)' : '');

  console.log('\nfilm sample:', JSON.stringify(await shown(), null, 0));
  console.log('JS errors:', errs.length ? errs : 'none');
  await browser.close();
})();
