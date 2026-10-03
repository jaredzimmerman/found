// Clicking the photograph must do exactly what clicking the title does.
//
// The claim under test, for every card that has an image:
//   1. the image is wrapped in a real <a> (not a div with a click listener)
//   2. that anchor's href is byte-identical to the title's href
//   3. clicking the image navigates to the venue page
//   4. the crop is taken from the centre, not the top edge
//
// (2) is the one that rots silently. Two links built from two code paths
// drift the moment one of them is changed — a tracking parameter added to the
// title but not the photo, a rel attribute, a different normalisation — and
// nothing on the page looks wrong.
const pw = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const URL = "https://datebook.indigokarasu.com/";

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
};

(async () => {
  const b = await pw.chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  await p.waitForTimeout(2500);

  const audit = await p.evaluate(() => {
    const cards = [...document.querySelectorAll("#list .row")];
    const withImg = cards.filter((c) => c.querySelector(".figure img"));
    const link = document.createElement("link"); // unused, keeps lint quiet
    const rows = withImg.map((c) => {
      const fig = c.querySelector(".figure");
      const img = fig.querySelector("img");
      const a = fig.querySelector("a");
      const title = c.querySelector("a.title-e");
      const cs = getComputedStyle(img);
      return {
        hasAnchor: !!a,
        anchorTag: a ? a.tagName : null,
        sameHref: a && title ? a.getAttribute("href") === title.getAttribute("href") : false,
        imgHref: a ? a.getAttribute("href") : null,
        titleHref: title ? title.getAttribute("href") : null,
        sameTarget: a && title ? a.getAttribute("target") === title.getAttribute("target") : false,
        cursor: a ? getComputedStyle(a).cursor : getComputedStyle(fig).cursor,
        objectPosition: cs.objectPosition,
        objectFit: cs.objectFit,
        // Does the image box cover the anchor box exactly? A gap means a strip
        // of paper that looks like part of the picture but is not clickable.
        boxMatches: (() => {
          if (!a) return false;
          const ir = img.getBoundingClientRect(), ar = a.getBoundingClientRect();
          return Math.abs(ir.width - ar.width) < 1 && Math.abs(ir.height - ar.height) < 1;
        })(),
        tabindex: a ? a.getAttribute("tabindex") : null,
        ariaHidden: a ? a.getAttribute("aria-hidden") : null,
      };
    });
    // Every image in the page, checked for a top-biased crop.
    const crops = [...document.querySelectorAll(".figure img")].map((im) => ({
      pos: getComputedStyle(im).position ? getComputedStyle(im).objectPosition : null,
      natW: im.naturalWidth, natH: im.naturalHeight,
      boxW: Math.round(im.getBoundingClientRect().width),
      boxH: Math.round(im.getBoundingClientRect().height),
    }));
    return { cardsWithImages: withImg.length, rows, crops, totalCards: cards.length };
  });

  console.log(`\n== ${audit.cardsWithImages} cards carry a photograph (of ${audit.totalCards}) ==`);
  check("every photograph is wrapped in a real <a>",
    audit.rows.every((r) => r.hasAnchor && r.anchorTag === "A"),
    `${audit.rows.filter((r) => r.hasAnchor).length}/${audit.rows.length}`);
  check("the photo's href is identical to the title's href",
    audit.rows.every((r) => r.sameHref),
    `${audit.rows.filter((r) => r.sameHref).length}/${audit.rows.length} match`);
  const mismatches = audit.rows.filter((r) => !r.sameHref).slice(0, 3);
  for (const m of mismatches) console.log(`        photo ${m.imgHref}\n        title ${m.titleHref}`);
  check("both links open the same way", audit.rows.every((r) => r.sameTarget));
  check("the photograph shows a pointer cursor", audit.rows.every((r) => r.cursor === "pointer"),
    [...new Set(audit.rows.map((r) => r.cursor))].join(", "));
  check("the anchor's box IS the picture (no dead strip)",
    audit.rows.every((r) => r.boxMatches));
  check("the photo is out of the tab order (title is the keyboard path)",
    audit.rows.every((r) => r.tabindex === "-1" && r.ariaHidden === "true"));

  console.log("\n== the crop is centred, not top-biased ==");
  const positions = [...new Set(audit.crops.map((c) => c.pos))];
  check("object-position is the centre on both axes",
    positions.every((p) => p === "50% 50%" || p === "50% 50%"), positions.join(" | "));
  check("object-fit is cover (so the position is what governs)", 
    audit.rows.every((r) => r.objectFit === "cover"));

  console.log("\n== clicking the image navigates to the venue page ==");
  // Click a real photograph and confirm the browser is sent to the href the
  // title would have gone to. A popup target, so the test page survives.
  const first = await p.evaluate(() => {
    const c = [...document.querySelectorAll("#list .row")].find((x) => x.querySelector(".figure a"));
    const a = c.querySelector(".figure a");
    return { href: a.getAttribute("href"), titleHref: c.querySelector("a.title-e").getAttribute("href") };
  });
  const [popup] = await Promise.all([
    p.context().waitForEvent("page", { timeout: 15000 }),
    p.evaluate(() => document.querySelector("#list .row .figure a").click()),
  ]);
  const landed = popup.url();
  await popup.close();
  check("clicking the photo opened a new tab", !!popup);
  check("the photo and the title go to the same place",
    landed.replace(/#$/, "") === first.titleHref.replace(/#$/, ""),
    `photo landed ${landed}\n        title would go ${first.titleHref}`);

  await b.close();
  console.log(fails ? `\n${fails} FAILING` : "\nPASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
