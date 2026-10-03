// Test the entity decoder against real cases, without importing fetch.mjs (that
// module runs main() on import). Extract the function source and eval it.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./fetch.mjs", import.meta.url), "utf8");
// Start at the entity table, not at fromCodePoint: decodeEntities closes over
// HTML_ENTITIES, so slicing from the function alone leaves it undefined.
// The end marker is matched on the export LINE rather than an exact
// `export { decodeEntities }` string: that line also carries `register`, so the
// exact match silently stopped finding the decoder and the test threw before
// running a single case — a test that fails for the wrong reason is worse than
// no test, because it reads as coverage.
const i = src.indexOf("const HTML_ENTITIES");
const j = src.search(/^export \{[^}]*decodeEntities[^}]*\};?\s*$/m);
if (i < 0 || j < 0) throw new Error("could not locate the decoder in fetch.mjs");
const { decodeEntities } = new Function(src.slice(i, j) + "; return { decodeEntities };")();

const cases = [
  ["Beginner&#8217;s Leatherworking", "Beginner’s Leatherworking"],
  ["Pumpkin Painting &#038; Macrame", "Pumpkin Painting & Macrame"],
  ["A &#x2019; quote", "A ’ quote"],
  ["Plain &amp; simple", "Plain & simple"],
  ["Café &nbsp; Bar", "Café   Bar"],
  ["Bad &#999999999; stays", "Bad &#999999999; stays"],
  ["Surrogate &#xD800; stays", "Surrogate &#xD800; stays"],
  ['&lt;tag&gt; &quot;q&quot; &apos;a&apos;', '<tag> "q" \'a\''],
  ["No entities here", "No entities here"],
  ["Already decoded — em dash", "Already decoded — em dash"],
];

let bad = 0;
for (const [input, want] of cases) {
  const got = decodeEntities(input);
  const ok = got === want;
  if (!ok) bad++;
  console.log(
    (ok ? "ok   " : "FAIL ") + JSON.stringify(input) + " -> " + JSON.stringify(got) +
    (ok ? "" : "   want " + JSON.stringify(want))
  );
}
console.log(bad ? `\n${bad} FAILING` : `\nall ${cases.length} decoder cases pass`);
process.exit(bad ? 1 : 0);
