// The badge gap is CSS margin, so textContent concatenation will always look
// joined. This captures what a reader actually sees instead of asserting on
// a string that no one ever reads.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });

  // Gap between the end of the title text and the badge, measured in the page.
  const gaps = await page.$$eval('.row', (ns) => ns.slice(0, 6).map((n) => {
    const a = n.querySelector('a.title-e');
    const d = n.querySelector('.dest');
    if (!a || !d) return null;
    const ar = a.getBoundingClientRect(), dr = d.getBoundingClientRect();
    return {
      title: a.childNodes[0].textContent.trim().slice(0, 34),
      badge: d.textContent.trim(),
      gapPx: Math.round(dr.left - (ar.right - dr.width - 8)),
      badgeVisible: dr.width > 0 && dr.height > 0,
    };
  }).filter(Boolean));

  console.log('badge layout (gap is CSS margin, not whitespace):');
  for (const g of gaps) console.log(`  ${String(g.gapPx).padStart(3)}px  "${g.title}" [${g.badge}] visible=${g.badgeVisible}`);

  // A real screenshot so the typography can be judged, not just counted.
  await page.screenshot({ path: '/tmp/pinkpages-live.png', fullPage: false });
  console.log('\nscreenshot -> /tmp/pinkpages-live.png');

  // Narrow viewport: the newspaper columns must not overflow.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await phone.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  const overflow = await phone.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('mobile horizontal overflow:', overflow, overflow <= 0 ? 'px (none)' : 'px *** OVERFLOW ***');
  await phone.screenshot({ path: '/tmp/pinkpages-mobile.png' });
  await browser.close();
  console.log('JS errors:', errs.length ? errs : 'none');
})();
