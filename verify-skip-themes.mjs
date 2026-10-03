import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto("https://pinkpages.indigokarasu.com/?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);

const out = {};

// skip link: hidden at rest, visible on focus, and it actually moves focus
out.skip = await p.evaluate(() => {
  const a = document.querySelector("a.skip");
  if (!a) return { present: false };
  const atRest = getComputedStyle(a).transform;
  return { present: true, atRest, href: a.getAttribute("href") };
});
await p.keyboard.press("Tab");
await p.waitForTimeout(200);
out.skip.firstTabStop = await p.evaluate(() => {
  const el = document.activeElement;
  const a = document.querySelector("a.skip");
  return {
    isSkip: el === a,
    visibleOnFocus: a ? getComputedStyle(a).transform : null,
    label: a ? a.textContent.trim() : null,
  };
});
await p.keyboard.press("Enter");
await p.waitForTimeout(400);
out.skip.afterActivate = await p.evaluate(() => ({
  hash: location.hash,
  scrollY: Math.round(window.scrollY),
  focusTag: document.activeElement?.tagName,
  focusId: document.activeElement?.id,
}));

// stability: adding the skip link must not move the page
out.stability = await p.evaluate(() => ({
  titleY: Math.round(document.querySelector(".title-e")?.getBoundingClientRect().top ?? -1),
  barH: Math.round(document.querySelector(".filters")?.getBoundingClientRect().height ?? -1),
  scrollH: Math.round(document.documentElement.scrollHeight),
}));

// themes: each must apply its own --paper
out.themes = {};
for (const t of ["light", "dark", "pink"]) {
  await p.click(`input[name=theme][value=${t}]`, { force: true }).catch(() => {});
  await p.waitForTimeout(350);
  out.themes[t] = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const img = document.querySelector(".figure img");
    return {
      paper: cs.getPropertyValue("--paper").trim(),
      ink: cs.getPropertyValue("--ink").trim(),
      bodyBg: body.backgroundColor,
      dataTheme: document.documentElement.dataset.theme,
      imgFilter: img ? getComputedStyle(img).filter : null,
    };
  });
}
// restore light
await p.click("input[name=theme][value=light]", { force: true }).catch(() => {});

await b.close();
console.log(JSON.stringify(out, null, 2));
