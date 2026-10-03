// Tests for Omnivore Books. Every string here was copied off the live site on
// 2026-10-02 — the three overlines from real product pages, the 23-title roster
// from products.json, and the poster address. Synthetic fixtures would prove the
// pattern; these prove the contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  omnivoreRows,
  omnivoreSchedule,
  omnivoreOverline,
  OMNIVORE_ADDRESS,
} from "./omnivore-core.mjs";

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").slice(0, 4).join("\n       ")}`);
  }
};

const OCT = ["2026-10-02", "2026-10-03", "2026-10-04"];

console.log("Overline parsing — the three strings read off real product pages");

t("'Tuesday, October 6 at 6:30 pm' -> 2026-10-06 6:30pm", () => {
  const r = omnivoreSchedule("Tuesday, October 6 at 6:30 pm", ["2026-10-06"]);
  assert.equal(r.iso, "2026-10-06");
  assert.equal(r.clock, "6:30pm");
});

t("'Monday, October 5 at 7:00 pm' (the OFF-SITE template)", () => {
  const r = omnivoreSchedule("Monday, October 5 at 7:00 pm", ["2026-10-05"]);
  assert.equal(r.iso, "2026-10-05");
  assert.equal(r.clock, "7:00pm");
});

t("'Thursday, October 8 at 6:30 pm'", () => {
  const r = omnivoreSchedule("Thursday, October 8 at 6:30 pm", ["2026-10-08"]);
  assert.equal(r.iso, "2026-10-08");
  assert.equal(r.clock, "6:30pm");
});

t("uppercase rendered text still parses (CSS text-transform only)", () => {
  const r = omnivoreSchedule("TUESDAY, OCTOBER 6 AT 6:30 PM", ["2026-10-06"]);
  assert.equal(r.iso, "2026-10-06");
});

t("a date with no clock is still an event (Time TBA, not dropped)", () => {
  const r = omnivoreSchedule("Saturday, November 14", ["2026-11-14"]);
  assert.equal(r.iso, "2026-11-14");
  assert.equal(r.clock, "");
});

t("no weekday prefix is required", () => {
  assert.equal(omnivoreSchedule("October 20 at 5:00 pm", ["2026-10-20"]).iso, "2026-10-20");
});

t("prose that merely mentions a date is not a schedule", () => {
  assert.equal(omnivoreSchedule("Our book club meets on October 2nd.", OCT), null);
  assert.equal(omnivoreSchedule("Check out fall releases!", OCT), null);
});

t("a day number that cannot exist is rejected", () => {
  assert.equal(omnivoreSchedule("Tuesday, October 47 at 6:30 pm", ["2026-10-47"]), null);
});

t("a date outside the window resolves to null, never to a wrong year", () => {
  // December listing seen during an October window: there is no correct ISO
  // inside the window, so it must not borrow October's year.
  assert.equal(omnivoreSchedule("Thursday, December 10 at 6:00 pm", OCT), null);
});

t("a January listing in a January window resolves to the window's year", () => {
  assert.equal(
    omnivoreSchedule("Thursday, January 15 at 6:00 pm", ["2027-01-15"]).iso,
    "2027-01-15");
});

console.log("\nOverline extraction — the pinned element");

const PAGE = `<div class="product-form--block--overline">Tuesday, October 6 at 6:30 pm</div>`;

t("reads the overline div", () => {
  assert.equal(omnivoreOverline(PAGE), "Tuesday, October 6 at 6:30 pm");
});

t("survives nested tags inside the div", () => {
  const p = '<div class="product-form--block--overline">Tuesday, <span>October 6</span> at 6:30 pm</div>';
  assert.equal(omnivoreOverline(p), "Tuesday, October 6 at 6:30 pm");
});

t("a page without one returns null, not ''", () => {
  assert.equal(omnivoreOverline("<div>nothing here</div>"), null);
  assert.equal(omnivoreOverline(""), null);
});

console.log("\nRoster — products.json");

t("every real product produces a row", () => {
  const cache = JSON.parse(readFileSync("/tmp/omnivore-cache.json", "utf8"));
  const rows = omnivoreRows(cache.products);
  assert.equal(rows.length, cache.products.length);
  assert.equal(rows.length, 23);
});

t("no row loses its title", () => {
  const cache = JSON.parse(readFileSync("/tmp/omnivore-cache.json", "utf8"));
  for (const r of omnivoreRows(cache.products)) {
    assert.ok(r.title && r.title.length > 8, `empty title: ${JSON.stringify(r)}`);
    assert.ok(!/^OFF-SITE/i.test(r.title), "marker left without its asterisk");
  }
});

t("the bullet separator becomes an em dash, not a doubled space", () => {
  const rows = omnivoreRows([{ id: 1, title: "Ada Author Talk  •  A Book", handle: "h" }]);
  assert.equal(rows[0].title, "Ada Author Talk — A Book");
});

t("price 0.00 is free, and is NOT confused with missing", () => {
  const rows = omnivoreRows([{ id: 1, title: "T", handle: "h",
    variants: [{ price: "0.00", available: true }] }]);
  assert.equal(rows[0].price, 0);
  assert.equal(rows[0].priceTier, "free");
});

t("a paid variant maps to paid", () => {
  const rows = omnivoreRows([{ id: 1, title: "T", handle: "h",
    variants: [{ price: "25.00", available: true }] }]);
  assert.equal(rows[0].price, 25);
  assert.equal(rows[0].priceTier, "paid");
});

t("an absent variant is unknown, never free", () => {
  const rows = omnivoreRows([{ id: 1, title: "T", handle: "h", variants: [] }]);
  assert.equal(rows[0].price, null);
  assert.equal(rows[0].priceTier, "unknown");
});

t("*OFF-SITE* is flagged so venue and address are not applied", () => {
  const rows = omnivoreRows([{ id: 1, handle: "h",
    title: "*OFF-SITE* Lebnani Supper Club at Reem's Mission" }]);
  assert.equal(rows[0].offSite, true);
  const on = omnivoreRows([{ id: 2, handle: "h", title: "Jancis Robinson Book Signing" }]);
  assert.equal(on[0].offSite, false);
});

t("published_at is carried but never used as a date", () => {
  const rows = omnivoreRows([{ id: 1, title: "T", handle: "h",
    published_at: "2026-03-11T00:00:00-07:00" }]);
  assert.equal(rows[0].publishedAt.slice(0, 10), "2026-03-11");
  assert.equal(rows[0].overline, null, "the event date is never back-filled");
});

console.log("\nAddress");
t("is the street address read off the poster image", () => {
  assert.match(OMNIVORE_ADDRESS, /^3885a Cesar Chavez St, San Francisco, CA/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
