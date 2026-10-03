// Test: the wordmark appears in the fixed bar ONLY after the masthead scrolls off.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";
let fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

(async () => {
  const b = await pw.chromium.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);

  const probe = () => page.evaluate(() => {
    const bar = document.querySelector("#bar");
    const brand = bar.querySelector(".brand");
    const mh = document.querySelector(".masthead");
    const br = brand.getBoundingClientRect();
    const mr = mh.getBoundingClientRect();
    const search = bar.querySelector(".search-wrap").getBoundingClientRect();
    const wrap = bar.querySelector(".filters-in").getBoundingClientRect();
    return {
      scrolled: bar.classList.contains("scrolled"),
      brandW: br.width,
      brandOpacity: +getComputedStyle(brand).opacity,
      brandLeft: br.left,
      mhBottom: mr.bottom,
      searchLeft: search.left,
      contentLeft: wrap.left + parseFloat(getComputedStyle(bar.querySelector(".filters-in")).paddingLeft),
    };
  });

  console.log("== at the top of the page: no wordmark in the bar ==");
  let g = await probe();
  check("bar is not in the scrolled state", !g.scrolled);
  check("wordmark occupies no width", g.brandW < 1, `${g.brandW.toFixed(1)}px`);
  check("wordmark is invisible", g.brandOpacity < 0.05, `opacity ${g.brandOpacity}`);
  check("search sits flush at the content margin",
    Math.abs(g.searchLeft - g.contentLeft) <= 1,
    `search ${g.searchLeft.toFixed(1)} vs margin ${g.contentLeft.toFixed(1)}`);
  check("the masthead is still on screen", g.mhBottom > 0, `bottom ${g.mhBottom.toFixed(1)}`);

  console.log("\n== after scrolling past the masthead ==");
  await page.evaluate(() => scrollTo(0, 700));
  // Wait out the 320ms slide + 200ms fade.
  await page.waitForTimeout(700);
  g = await probe();
  check("bar is in the scrolled state", g.scrolled);
  check("wordmark has width", g.brandW > 60, `${g.brandW.toFixed(1)}px`);
  check("wordmark is fully opaque", g.brandOpacity > 0.95, `opacity ${g.brandOpacity}`);
  check("the masthead is off screen", g.mhBottom <= 0, `bottom ${g.mhBottom.toFixed(1)}`);
  check("search moved right to make room", g.searchLeft > g.contentLeft + 40,
    `search at ${g.searchLeft.toFixed(1)}, margin at ${g.contentLeft.toFixed(1)}`);
  check("wordmark is left-aligned in the content margin",
    Math.abs(g.brandLeft - g.contentLeft) <= 1,
    `brand ${g.brandLeft.toFixed(1)} vs margin ${g.contentLeft.toFixed(1)}`);

  console.log("\n== the wordmark animates, it does not pop ==");
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(700);
  // Scroll to just past the trigger and sample the width mid-transition.
  await page.evaluate(() => scrollTo(0, 700));
  await page.waitForTimeout(90);
  const mid = await page.evaluate(() =>
    document.querySelector("#bar .brand").getBoundingClientRect().width);
  await page.waitForTimeout(700);
  const end = await page.evaluate(() =>
    document.querySelector("#bar .brand").getBoundingClientRect().width);
  check("width passes through an intermediate value",
    mid > 1 && mid < end, `mid ${mid.toFixed(1)}px, end ${end.toFixed(1)}px`);

  console.log("\n== scrolling back up removes it again ==");
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(700);
  g = await probe();
  check("bar returns to the unscrolled state", !g.scrolled);
  check("wordmark collapses again", g.brandW < 1, `${g.brandW.toFixed(1)}px`);
  check("search returns to the margin", Math.abs(g.searchLeft - g.contentLeft) <= 1,
    `${g.searchLeft.toFixed(1)} vs ${g.contentLeft.toFixed(1)}`);

  await b.close();
  console.log(`\n${fail ? `FAIL ${fail}` : "PASS"}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
