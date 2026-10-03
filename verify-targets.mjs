// Proves the tap-target change did what it claimed, and — the part that
// matters — that it changed NOTHING visible.
//
// The claim in the CSS is: padding and an equal negative margin grow the hit
// area while leaving text position and line rhythm untouched. That is a
// falsifiable claim about geometry, so it is measured, not asserted.
//
// Method: capture the geometry of every row's title, meta line and row box
// BEFORE the change, then AFTER, and diff. If any y-coordinate moved, the
// negative margin is wrong and the whole page's rhythm shifted.
import { chromium } from "playwright-core";

const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const probe = async () => {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await p.mouse.move(2, 2);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);

  const g = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".row")].slice(0, 40).map((r, i) => {
      const t = r.querySelector(".title-e");
      const v = r.querySelector(".venue");
      const g1 = r.querySelector(".tag");
      const rect = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        i,
        row: rect(r),
        title: rect(t),
        venueBox: rect(v),
        venueTextY: v ? Math.round(v.getBoundingClientRect().y + parseFloat(getComputedStyle(v).paddingTop)) : null,
        tagBox: rect(g1),
      };
    });
    const targets = [...document.querySelectorAll(".venue, .tag")]
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ cls: e.className, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }));
    return {
      rows,
      under24: targets.filter((t) => t.w < 24 || t.h < 24).length,
      totalTargets: targets.length,
      minH: Math.min(...targets.map((t) => t.h)),
      pageH: document.documentElement.scrollHeight,
      rowTops: rows.map((r) => r.row?.y),
    };
  });
  await p.close();
  return g;
};

// BEFORE: strip the padding/margin by re-declaring them to 0 in-page, which is
// exactly the pre-change geometry, measured on the same feed in the same
// session. This avoids comparing two different days of data.
const before = await probe();
const beforeSmall = {
  under24: before.under24,
  minH: before.minH,
  rowTops: before.rowTops,
  pageH: before.pageH,
  venueH: before.rows.find((r) => r.venueBox)?.venueBox?.h,
};

// Now re-measure with the rule neutralised, to get a true BEFORE on the same DOM.
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await p.mouse.move(2, 2);
await p.evaluate(() => document.fonts.ready);
await p.addStyleTag({
  content: ".venue,.tag{padding:0 !important;margin:0 !important}",
});
await p.waitForTimeout(800);
const neutralised = await p.evaluate(() => {
  const rows = [...document.querySelectorAll(".row")].slice(0, 40).map((r) => {
    const rect = (e) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return { row: rect(r), title: rect(r.querySelector(".title-e")), venueBox: rect(r.querySelector(".venue")) };
  });
  const t = [...document.querySelectorAll(".venue, .tag")].filter((e) => e.offsetParent !== null).map((e) => {
    const b = e.getBoundingClientRect();
    return { cls: e.className, w: Math.round(b.width), h: Math.round(b.height) };
  });
  return {
    under24: t.filter((x) => x.w < 24 || x.h < 24).length,
    minH: Math.min(...t.map((x) => x.h)),
    rows,
    pageH: document.documentElement.scrollHeight,
  };
});
await p.close();

const after = before; // same measurement pass, rule live
const nowRows = after.rows;
const oldRows = neutralised.rows;

// Compare: text y positions must be IDENTICAL. Row boxes may differ by the
// padding if the negative margin failed to cancel it — that is the tell.
const textShift = [];
for (let i = 0; i < Math.min(nowRows.length, oldRows.length); i++) {
  const a = nowRows[i], o = oldRows[i];
  if (a.title && o.title && a.title.y !== o.title.y) textShift.push({ i, liveY: a.title.y, neutralY: o.title.y, delta: a.title.y - o.title.y });
  if (a.venueBox && o.venueBox && a.venueBox.y !== o.venueBox.y) textShift.push({ i, what: "venue", liveY: a.venueBox.y, neutralY: o.venueBox.y, delta: a.venueBox.y - o.venueBox.y });
}

const out = {
  hitArea: {
    before_under24: neutralised.under24,
    before_minH: neutralised.minH,
    after_under24: after.under24,
    after_minH: after.minH,
    total: after.totalTargets,
    grew: after.minH > neutralised.minH,
    nowCompliant: after.under24 === 0,
  },
  layoutStability: {
    textShiftCount: textShift.length,
    textShifts: textShift.slice(0, 8),
    pageHeight_before: neutralised.pageH,
    pageHeight_after: after.pageH,
    pageHeightDelta: after.pageH - neutralised.pageH,
  },
  sampleBoxes: {
    neutralised: oldRows.find((r) => r.venueBox)?.venueBox,
    live: nowRows.find((r) => r.venueBox)?.venueBox,
  },
};

await b.close();
console.log(JSON.stringify(out, null, 2));
