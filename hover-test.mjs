// Real-pointer hover test.
//
// A synthetic `mouseover` dispatch does NOT trigger CSS :hover, and reading the
// rule's source only proves intent. This drives an actual mouse with Playwright
// so the used style is the browser's own answer to "is this underlined right
// now".
import { chromium } from "playwright-core";

const URL = `https://pinkpages.indigokarasu.com/?cb=${Date.now()}`;
// The bundled chromium for this playwright-core version is not downloaded
// (it wants build 1243; the cache has 1234), so use the system Chrome. A
// mismatch in build number is fine for a hover test — :hover is not new.
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(URL, { waitUntil: "networkidle" });
await p.waitForSelector(".title-e", { timeout: 20000 });

const dec = (s) =>
  p.evaluate(
    (sel) => {
      const e = document.querySelector(sel);
      if (!e) return "MISSING";
      const c = getComputedStyle(e);
      return `${c.textDecorationLine}|${c.textDecorationThickness}|w${c.fontWeight}`;
    },
    s,
  );

const out = {};

// Rest: park the pointer over empty chrome, well away from any listing.
await p.mouse.move(4, 4);
out.rest_title = await dec(".title-e");
out.rest_venue = await dec(".venue");

// On the title, by real pointer.
const t = await p.locator(".title-e").first().boundingBox();
await p.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
out.hoverTitle_title = await dec(".title-e");
out.hoverTitle_venue = await dec(".venue");
out.titleText = (await p.locator(".title-e").first().innerText()).slice(0, 40);

// On the venue, by real pointer.
const v = await p.locator(".venue").first().boundingBox();
await p.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
out.hoverVenue_title = await dec(".title-e");
out.hoverVenue_venue = await dec(".venue");
out.venueText = (await p.locator(".venue").first().innerText()).slice(0, 40);

// The `.row:hover .title-e` fallback: pointer on the row but off the title.
await p.mouse.move(4, 4);
const d = await p.locator(".row .desc").first().boundingBox();
if (d) {
  await p.mouse.move(d.x + 2, d.y + d.height / 2);
  out.hoverDesc_title = await dec(".title-e");
}

// Crowd-wide resting check, so one sample cannot hide a bad row.
// The pointer MUST be parked away first: the previous step left it on a .desc,
// and `.row:hover .title-e` would then legitimately underline that row's title
// and read as a failure here. Parking first is the whole point of the word
// "rest".
await p.mouse.move(4, 4);
await p.waitForTimeout(150);
out.allTitlesUnderlinedAtRest = await p.evaluate(() => {
  window.scrollTo(0, 0);
  return [...document.querySelectorAll(".title-e")].filter(
    (e) => getComputedStyle(e).textDecorationLine !== "none",
  ).length;
});
// Same discipline for the venue, which also has a hover-only underline.
out.allVenuesUnderlinedAtRest = await p.evaluate(
  () =>
    [...document.querySelectorAll(".venue")].filter(
      (e) => getComputedStyle(e).textDecorationLine !== "none",
    ).length,
);
out.titleCount = await p.locator(".title-e").count();
out.venuesNotBold = await p.evaluate(
  () =>
    [...document.querySelectorAll(".venue")].filter(
      (e) => getComputedStyle(e).fontWeight !== "700",
    ).length,
);

console.log(JSON.stringify(out, null, 2));
await b.close();
