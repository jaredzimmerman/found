// End-to-end check against the live site, not the local copy. Sold-out
// filtering is asserted against the served JSON rather than the DOM, because a
// filter that hides a row but keeps it in the feed would still mislead.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.row', { timeout: 20000 });

  const rows = () => page.$$eval('.row', (n) => n.length);
  const feed = await page.evaluate(() => fetch('/events.json').then((r) => r.json()));

  console.log('=== live feed ===');
  console.log('events:', feed.events.length, '| generatedAt:', feed.generatedAt);

  // 79 in the feed but 78 on screen is only correct if the difference is
  // exactly the sold-out events. Assert that, rather than assuming it — an
  // unexplained shortfall is a rendering bug and looks identical from outside.
  const rendered = await rows();
  const soldInFeed = feed.events.filter((e) => e.soldOut);
  const expected = feed.events.length - soldInFeed.length;
  console.log('rows rendered:', rendered, '| expected (feed minus sold-out):', expected);
  console.log('difference explained:', rendered === expected ? 'OK' : '*** UNEXPLAINED SHORTFALL ***');
  console.log('sold-out count in feed:', soldInFeed.length);
  if (rendered !== expected) {
    const shown = await page.$$eval('.row', (ns) => ns.map((n) => n.dataset.id || n.textContent.slice(0, 40)));
    const missing = feed.events.filter((e) => !shown.some((s) => s.includes(e.id) || s.includes(e.title.slice(0, 30))));
    console.log('  rows missing from the DOM:', missing.map((e) => `${e.id} ${e.title.slice(0, 34)} soldOut=${e.soldOut}`));
  }

  // --- sold-out must not be visible, and must be in the data to be filtered ---
  const sold = feed.events.filter((e) => e.soldOut);
  console.log('\n=== sold-out ===');
  console.log('in feed:', sold.length, sold.map((e) => e.title.slice(0, 30)));
  const visible = await page.$$eval('.row', (ns) => ns.map((n) => n.textContent));
  const leaked = sold.filter((s) => visible.some((v) => v.includes(s.title.slice(0, 28))));
  console.log('leaking into the list:', leaked.length, leaked.length ? '*** FAIL ***' : 'OK (none shown)');
  if (sold.length) {
    const count = await page.$eval('#n', (n) => n.textContent);
    console.log('header count:', count, '(sold-out excluded, so this should be <', feed.events.length, ')');
  }

  // --- filters ---
  // Playwright's page.evaluate takes ONE argument. Passing the selector and
  // the label separately throws "Too many arguments" — bundle them.
  //
  // The chip label carries its count ("Free19"), so match on prefix, not on
  // equality: an exact match silently found nothing and every number after it
  // was measured against an unfiltered list.
  const click = async (sel, text) => {
    const done = await page.evaluate(({ s, t }) => {
      const want = t.replace(/\d+$/, '').trim();
      const b = [...document.querySelectorAll(s)]
        .find((x) => x.textContent.replace(/\s+/g, ' ').trim().replace(/\d+$/, '').trim() === want);
      if (!b) return false;
      b.click();
      return true;
    }, { s: sel, t: text });
    await page.waitForTimeout(350);
    if (!done) console.log(`  *** chip not found: "${text}" in ${sel}`);
    return done;
  };

  // The reset button is hidden when no filter is active, so a plain click
  // times out. Clear through the same path a person uses when it is visible.
  const reset = async () => {
    const n = await page.evaluate(() => {
      const b = document.querySelector('#reset');
      if (!b) return 0;
      if (b.hidden) return 0;
      b.click();
      return 1;
    });
    if (!n) console.log('  (no filters active — nothing to reset)');
    await page.waitForTimeout(350);
    return n;
  };

  console.log('\n=== filters ===');
  const types = await page.$$eval('#f-type button', (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
  console.log('types:', types.length, '->', types.slice(0, 6).join(' | '));
  const film = types.find((t) => /film|movie/i.test(t));
  await click('#f-type button', film);
  const nFilm = await rows();
  const expectFilm = feed.events.filter((e) => (e.categories || []).some((c) => /film|movie/i.test(c))).length;
  console.log(`"${film}" -> ${nFilm} rows (feed says ${expectFilm}):`, nFilm === expectFilm ? 'OK' : '*** FAIL ***');

  // price
  await reset();
  const prices = await page.$$eval('#f-price button', (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
  console.log('price options:', prices.join(' | '));
  await click('#f-price button', 'Free');
  const nFree = await rows();
  const expectFree = feed.events.filter((e) => e.priceTier === 'free').length;
  console.log(`Free -> ${nFree} rows (feed says ${expectFree}):`, nFree === expectFree ? 'OK' : '*** FAIL ***');

  // venue. This facet is a <select>, not a chip row — querying buttons here
  // found none and the "0 options" reading was my test, not the page.
  await reset();
  const venues = await page.$$eval('#f-venue option', (ns) => ns.map((n) => n.value).filter(Boolean));
  console.log('venue options:', venues.length);
  const target = venues.find((v) => feed.events.filter((e) => e.venue === v).length >= 2) || venues[0];
  await page.selectOption('#f-venue', target);
  await page.waitForTimeout(350);
  const nV = await rows();
  const expectV = feed.events.filter((e) => e.venue === target).length;
  console.log(`"${target}" -> ${nV} rows (feed says ${expectV}):`, nV === expectV ? 'OK' : '*** FAIL ***');

  // the select must show the chosen venue back to the reader
  const shown = await page.$eval('#f-venue', (s) => s.options[s.selectedIndex].textContent);
  console.log('select shows:', shown);

  // AND across facets
  await click('#f-type button', film);
  const nAnd = await rows();
  const expectAnd = feed.events.filter((e) => e.venue === target && (e.categories || []).some((c) => /film|movie/i.test(c))).length;
  console.log(`venue AND type -> ${nAnd} rows (feed says ${expectAnd}):`, nAnd === expectAnd ? 'OK' : '*** FAIL ***');

  // reset
  await reset();
  console.log('after reset ->', await rows(), 'rows (expect', expected, ')');

  // --- every row links somewhere real, over https, to a non-aggregator ---
  // The tier lives on the .dest badge INSIDE the anchor, not on the row.
  // Reading closest('.row').dataset.tier yields undefined and makes every
  // badge check look like a defect.
  const links = await page.$$eval('.row a.title-e', (ns) => ns.map((n) => ({
    href: n.href,
    tier: n.querySelector('.dest')?.dataset.tier || null,
    badge: n.querySelector('.dest')?.textContent?.trim() || null,
  })));
  console.log('\n=== links ===');
  console.log('rows linked:', links.filter((l) => l.href).length, '/', links.length);
  console.log('rows with a tier badge:', links.filter((l) => l.tier).length, '/', links.length);

  // Test the HOSTNAME, never the full URL. An unanchored /dothebay/ matches
  // eventbrite.com/e/123?aff=dothebay, which is the organizer's own page — that
  // false positive cost two rounds of chasing a defect that did not exist.
  const hostOf = (href) => { try { return new URL(href).hostname.toLowerCase(); } catch { return null; } };
  const hosts = new Set(links.map((l) => hostOf(l.href)));
  console.log('distinct hosts:', hosts.size);
  console.log('unparseable urls:', links.filter((l) => !hostOf(l.href)).length);
  const insecure = links.filter((l) => !l.href.startsWith('https://'));
  console.log('non-https links:', insecure.length, insecure.length ? '*** INSECURE ***' : 'OK');

  // Eventbrite is deliberately NOT here: it is a ticketing platform, the same
  // family as Ticketmaster, and is how many small venues sell their own shows.
  // Putting it in this list once threw away the best link for exactly those
  // venues, and treating its own page as an "aggregator link" invents a defect.
  const AGG = /(^|\.)(dothebay\.com|dostuffmedia\.com|universe\.com)$/;
  const aggRows = links.filter((l) => { const h = hostOf(l.href); return h && AGG.test(h); });
  const aggMisbadged = aggRows.filter((l) => l.tier !== 'listing');
  console.log('aggregator-host rows:', aggRows.length, '| misbadged:', aggMisbadged.length,
    aggMisbadged.length ? '*** TIER/BADGE DISAGREE ***' : '(badge agrees with link)');

  // The badge and the destination must never disagree, in either direction.
  const TICKETING = /(^|\.)(ticketmaster\.[a-z.]+|axs\.com|dice\.fm|seetickets\.[a-z.]+|wl\.seetickets\.[a-z.]+|veezi\.com|scuff\.us|eventbrite\.com|evyy\.net)$/;
  const mism = links.filter((l) => {
    const h = hostOf(l.href); if (!h) return false;
    const isTick = TICKETING.test(h), isAgg = AGG.test(h);
    return (isAgg && l.tier !== 'listing') || (isTick && l.tier === 'listing');
  });
  console.log('tier/destination disagreements:', mism.length,
    mism.length ? '*** ' + mism.slice(0, 3).map((m) => m.tier + '->' + hostOf(m.href)).join(', ') : 'OK');

  // A social profile is not a venue page. If any is badged "venue", the badge
  // is lying and the reader hits a login wall instead of a box office.
  const SOCIAL = /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|threads\.net|bsky\.app|linkedin\.com|meetup\.com|youtube\.com)$/;
  const social = links.filter((l) => { const h = hostOf(l.href); return h && SOCIAL.test(h); });
  const socialMisbadged = social.filter((l) => l.tier !== 'listing');
  console.log('social-profile rows:', social.length, '| badged venue:',
    socialMisbadged.length, socialMisbadged.length ? '*** LABELLED VENUE SITE ***' : 'OK (demoted)');
  console.log('  badge breakdown:', JSON.stringify(social.reduce((a, l) => ((a[l.badge] = (a[l.badge] || 0) + 1), a), {})));

  // --- mobile ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('\n=== mobile 390px ===');
  console.log('horizontal overflow:', overflow, overflow <= 1 ? 'OK' : '*** FAIL ***');

  console.log('\nJS errors:', errors.length ? errors : 'none');
  await browser.close();
})();
