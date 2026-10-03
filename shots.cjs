// Capture the masthead and the first listing rows at readable resolution.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: 'shot-full.png', fullPage: true });

  // Masthead + filter bar only.
  const bar = await page.$('#bar') || await page.$('header');
  if (bar) await bar.screenshot({ path: 'shot-bar.png' });

  // The first day section in full.
  const day = await page.$('#list section.day');
  if (day) await day.screenshot({ path: 'shot-day.png' });

  // Mobile rendering — the layout must not break.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shot-mobile.png' });

  console.log('captured: shot-full.png, shot-bar.png, shot-day.png, shot-mobile.png');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
