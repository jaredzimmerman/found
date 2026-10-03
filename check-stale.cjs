// The staleness warning has to be proven, not assumed. A feed that is 3 days
// old must say so; a fresh one must not. Serve a doctored events.json from a
// local origin and point the page at it, rather than touching the live data.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');
const http = require('http');
const fs = require('fs');

const REAL = JSON.parse(fs.readFileSync('/var/www/pinkpages.indigokarasu.com/events.json', 'utf8'));
const PAGE = fs.readFileSync('/var/www/pinkpages.indigokarasu.com/index.html', 'utf8');

const ageFor = (hours) => new Date(Date.now() - hours * 36e5).toISOString();

// Serve a feed whose generatedAt is `hours` old, on the real page markup.
const server = http.createServer((req, res) => {
  const h = Number(new URL(req.url, 'http://x').searchParams.get('age') || 0);
  if (req.url.startsWith('/events.json')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...REAL, generatedAt: ageFor(h) }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  }
});

(async () => {
  await new Promise((r) => server.listen(8799, r));
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  for (const [label, hours] of [['fresh (0h)', 0], ['today (7h)', 7], ['stale (30h)', 30], ['very stale (80h)', 80]]) {
    await page.goto(`http://127.0.0.1:8799/?age=${hours}`, { waitUntil: 'networkidle' });
    // The page fetches /events.json itself; intercept and rewrite the stamp.
    await page.route('**/events.json*', async (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...REAL, generatedAt: ageFor(hours) }) });
    });
    await page.goto(`http://127.0.0.1:8799/?age=${hours}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const stamp = await page.$eval('#stamp', (n) => n.textContent.trim());
    const isStale = await page.$eval('#stamp', (n) => n.classList.contains('stale'));
    const rows = await page.$$eval('.row', (n) => n.length);
    console.log(`${label.padEnd(17)} rows=${String(rows).padStart(3)}  stale=${String(isStale).padEnd(5)}  "${stamp}"`);
  }

  console.log('\nJS errors:', errs.length ? errs : 'none');
  await browser.close();
  server.close();
})();
