// Authoritative check of the rendered newspaper styling: real computed CSS and
// real text, rather than trusting an image model to read type.
const { chromium } = require('/usr/local/lib/hermes-agent/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  await page.goto('https://pinkpages.indigokarasu.com/', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  const r = await page.evaluate(() => {
    const g = el => el ? getComputedStyle(el) : null;
    const body = g(document.body);
    const h1 = document.querySelector('h1');
    const rules = Array.from(document.querySelectorAll('hr, .rule, [class*="rule"]'))
      .slice(0, 6).map(el => ({ cls: el.className, border: g(el).borderBottomWidth + ' ' + g(el).borderBottomStyle, color: g(el).borderBottomColor }));

    return {
      bg: body.backgroundColor,
      color: body.color,
      fontFamily: body.fontFamily,
      masthead: h1 ? { text: h1.textContent.trim(), size: g(h1).fontSize, family: g(h1).fontFamily, weight: g(h1).fontWeight, transform: g(h1).textTransform, letterSpacing: g(h1).letterSpacing } : null,
      rules,
      chipGroups: Array.from(document.querySelectorAll('.chips')).map(c => ({
        id: c.id,
        label: c.previousElementSibling ? c.previousElementSibling.textContent.trim() : null,
        chips: Array.from(c.querySelectorAll('button.chip')).map(b => b.textContent.trim()),
      })),
      firstRow: (() => {
        const a = document.querySelector('#list a[href^="http"]');
        if (!a) return null;
        const row = a.closest('.row') || a.parentElement.parentElement;
        return { time: row.querySelector('time,.t,.time') ? row.querySelector('time,.t,.time').textContent.trim() : null, text: row.innerText.replace(/\s+/g,' ').trim().slice(0,110) };
      })(),
    };
  });

  console.log('BODY  bg:', r.bg, '| text:', r.color, '| family:', r.fontFamily);
  console.log('MASTHEAD:', JSON.stringify(r.masthead, null, 1));
  console.log('RULES:', JSON.stringify(r.rules));
  console.log('\nCHIP GROUPS:');
  r.chipGroups.forEach(g => console.log('  ' + g.id + ' [' + g.label + ']: ' + g.chips.join(' | ')));
  console.log('\nFIRST ROW:', JSON.stringify(r.firstRow));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
