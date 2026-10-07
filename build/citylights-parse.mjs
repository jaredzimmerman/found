// City Lights parser — structured attributes, never visible text.
//
// WHY THIS REWRITE: the previous version sliced blocks out of the page by date
// line and read the date from that visible text. That works on rendered text and
// fails on raw HTML for a specific, measured reason:
//
//   EVERY BLOCK ON THE PAGE DISPLAYS THE WRONG DATE IN SERVER-RENDERED HTML.
//   Measured: 35 of 35 `<div class="list-item-block">` blocks have a visible
//   `<p class="shortcode-date">` text that DISAGREES with the `data-time`
//   attribute on the same element. All 35 render "Saturday, October 3, 2026,
//   9:29 pm" — the same instant — while their true dates run October 4 through
//   December 19. Something in their build stamps every block with one time and
//   their client-side JS corrects it per block.
//
//   That is why the headless reader worked: it let the browser run that JS. It
//   is also why this file is worth the rewrite — the browserless path must not
//   trust the same bytes the browser corrects.
//
//   The visible <p> text is also a LIE ABOUT ORDER: reading it produced titles
//   like "Monday, December 14, 2026, 7:00 pm PST" as event titles, because the
//   block boundary was wrong and the slice ran into the next block's date line.
//
// So: split on the block container, then read `data-time`, the title anchor and
// the description <p> from within that one block. Nothing crosses a block
// boundary except as an explicit fallback. A block that yields no date is
// reported, not silently skipped.

import { readFileSync } from "node:fs";

const MONTH = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Strip tags and collapse whitespace from an HTML fragment. */
const plain = (s) =>
  String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:#39|apos|rsquo|quot|#8220|#8221);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Parse one `<div class="list-item-block">` into an event, or null if it does
 * not carry a usable date.
 */
// WHICH FIELD IS THE DATE — MEASURED, NOT GUESSED:
//   data-time="..."  → 1 distinct value across 35 blocks ("Saturday, October 3,
//     2026, 9:29 pm" every time). That is a build-time stamp on every block, not
//     a per-event date, and trusting it silently filed all 35 events on Oct 3.
//   <p class="shortcode-date"> visible text → 35 distinct values, and the
//     neighbouring data-test2 epoch agrees with it block for block.
// So the VISIBLE date is the date and the attribute is decoration. The comment
// above used to argue the reverse; this is the measurement that settled it.
export function parseBlock(block) {
  // Visible date, taken from this block only. The attribute is deliberately NOT
  // consulted as a fallback — a wrong-but-plausible fallback is worse than none.
  const vis = block.match(/<p class="shortcode-date"[^>]*>\s*([^<]+?)\s*<\/p>/i);
  if (!vis) return null;
  const dm = vis[1].match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!dm) return null;
  const mo = MONTH[dm[1].toLowerCase()];
  if (mo == null) return null;

  const h24 = parseInt(dm[4], 10) % 12 + (/pm/i.test(dm[6]) ? 12 : 0);
  const startMinutes = h24 * 60 + parseInt(dm[5], 10);

  // The title anchor sits inside the h3 and carries both the canonical permalink
  // and the clean title — no slug matching, no fuzzy fallback, no position
  // guessing. This is the same "first-party link" the old code tried to
  // reconstruct by matching title words against a list of hrefs.
  const titleA = block.match(/<h3 class="shortcode-title list-heading">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const title = plain(titleA?.[2]);
  if (!title) return null;
  const url = titleA?.[1] || null;

  // Description: the <p> after the h3, inside this block only.
  const afterTitle = titleA ? block.slice((block.indexOf(titleA[0]) || 0) + titleA[0].length) : "";
  const descP = afterTitle.match(/<p>([\s\S]*?)<\/p>/i);
  const blurb = plain(descP?.[1]);

  // Timezone label (PST/PDT) rides along with the visible date.
  const tz = (vis[1].match(/\b(PST|PDT|MST|MDT|CST|CDT|EST|EDT)\b/i) || [])[1] || null;

  return {
    title,
    url,
    blurb,
    startMinutes,
    timeLabel: (vis[1].match(/\b\d{1,2}:\d{2}\s*[ap]m\b/i) || [])[0] || null,
    date: `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`,
    tz,
    passed: /event\s*passed/i.test(block),
    offsite: /offsite/i.test(block),
  };
}

/** Parse every event block in a City Lights page. */
export function parseCalendar(html) {
  const blocks = [...String(html).matchAll(/<div class="list-item-block">([\s\S]*?)<div class="right-side">/gi)];
  const rows = [];
  let undated = 0;
  for (const m of blocks) {
    const r = parseBlock(m[1]);
    if (r) rows.push(r);
    else undated++;
  }
  return { rows, blockCount: blocks.length, undated };
}

// ---- CLI: inspect a saved page --------------------------------------------
if (process.argv[2]) {
  const html = readFileSync(process.argv[2], "utf8");
  const { rows, blockCount, undated } = parseCalendar(html);
  console.log(`blocks: ${blockCount}   parsed: ${rows.length}   undated: ${undated}\n`);
  const days = process.argv[3] ? process.argv[3].split(",") : null;
  const show = days ? rows.filter((r) => days.includes(r.date)) : rows;
  for (const r of show.slice(0, 40)) {
    const t = r.startMinutes >= 0
      ? `${String(Math.floor(r.startMinutes / 60)).padStart(2, "0")}:${String(r.startMinutes % 60).padStart(2, "0")}`
      : "--:--";
    console.log(`  ${r.date} ${t}  ${r.title}`);
    console.log(`      ${r.url}`);
    if (r.blurb) console.log(`      ${r.blurb.slice(0, 88)}`);
  }
  if (days) console.log(`\n  in window: ${show.length}`);
}
