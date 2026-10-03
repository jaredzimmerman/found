const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
const fs = require("fs");

// A test that cannot fail is worse than no test. This deliberately BREAKS the
// live page in a scratch copy — fat dots, a broken image, a dead hover rule —
// and asserts that the corresponding checks in test-masonry.cjs go red.
//
// The page under test is a LOCAL COPY with the CSS mutated, so the live site is
// never touched. Each mutation must turn a specific named check red; if any
// mutation leaves the suite green, that check is decorative and this fails.
const SRC = "/var/www/pinkpages.indigokarasu.com";
const TMP = "/root/.hermes/profiles/indigo/cache/scratch/mutant";
const PORT = 8899;

function readIndex() { return fs.readFileSync(`${SRC}/index.html`, "utf8"); }

function mutateDots(html) {
  // Put the dot radius back to the fat 1.05px the user complained about.
  return html.replace(/--dot-r:\s*0\.7px/g, "--dot-r: 1.05px");
}
function mutateBrokenImage(html) {
  // Force one rendered card image to a URL that cannot resolve to an image.
  // The images are built in JS from the feed, so the mutation has to be in the
  // RENDER path — targeting markup that does not exist means the mutation
  // silently does nothing and the test reports the broken build as green.
  const anchor = '.figure img';
  if (!html.includes(anchor)) return html;
  // Add a rule that swaps every card image to a 404 as soon as it renders.
  return html.replace("</style>",
    `</style>\n<script>document.addEventListener("DOMContentLoaded",()=>{` +
    `const i=document.querySelector(".figure img");if(i){i.removeAttribute("src");` +
    `i.src="http://127.0.0.1:1/__nope__.jpg";}});</script>`);
}
function mutateHover(html) {
  // Revert the card-level hover to image-only: this is the regression the user
  // actually reported. If the suite still passes, the "hover the card's TEXT"
  // check is decorative.
  const re = /\.row:hover img,\s*\n?\s*\.figure:hover img/;
  if (!re.test(html)) return html;
  return html.replace(re, ".figure:hover img");
}
function mutateScreen(html) {
  // Kill the multiply blend that makes the screen a screen.
  if (!html.includes("mix-blend-mode:multiply")) return html;
  return html.replace(/mix-blend-mode:multiply;/, "mix-blend-mode:normal;");
}

const CASES = [
  { name: "fat dots", fn: mutateDots, expect: "the dots are the reduced size that was asked for" },
  { name: "broken image", fn: mutateBrokenImage, expect: "every image is a real, decodable photograph" },
  { name: "dead hover", fn: mutateHover, expect: "hover restores the photograph to full colour" },
  { name: "no screen", fn: mutateScreen, expect: "the screen multiplies over the photo" },
];

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.cpSync(SRC, TMP, { recursive: true });

  const http = require("http");
  const serve = (dir) => new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      const p = rq.url.split("?")[0];
      const f = `${dir}${p === "/" ? "/index.html" : p}`;
      fs.readFile(f, (e, buf) => {
        if (e) { rs.writeHead(404); rs.end("no"); return; }
        rs.writeHead(200, { "content-type": f.endsWith(".css") ? "text/css" : f.endsWith(".js") ? "text/javascript" : "text/html" });
        rs.end(buf);
      });
    }).listen(PORT, () => res(s));
  });

  const { chromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const server = await serve(TMP);
  const URL = `http://127.0.0.1:${PORT}/`;

  let vacuous = 0;
  const { execFileSync } = require("child_process");
  const { chromium: pwChromium } = require("/usr/local/lib/hermes-agent/node_modules/playwright");
  const probe = await pwChromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox"] });
  const probePage = await probe.newPage();

  for (const c of CASES) {
    const base = readIndex();
    const html = c.fn(base);
    if (html === base) {
      console.log(`  ??   ${c.name.padEnd(14)} -> MUTATION DID NOT APPLY (selector no longer matches)`);
      vacuous++;
      continue;
    }
    fs.writeFileSync(`${TMP}/index.html`, html);

    // PROVE the mutant is what the browser will actually load. Without this,
    // a harness that silently serves the pristine copy reports every broken
    // build as green — which is exactly what happened the first time.
    // The wait matters: the feed renders from JS, so probing before the first
    // card exists reads null and the probe itself throws.
    await probePage.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    const hasFigure = await probePage
      .waitForSelector(".figure", { timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    if (!hasFigure) {
      console.log(`  ??   ${c.name.padEnd(14)} -> MUTANT DID NOT RENDER (no .figure); cannot judge`);
      vacuous++;
      continue;
    }
    const served = await probePage.evaluate(() => {
      const a = getComputedStyle(document.querySelector(".figure"), "::after");
      return { blend: a.mixBlendMode, r: getComputedStyle(document.documentElement).getPropertyValue("--dot-r").trim() };
    });
    const expectFat = c.name === "fat dots" ? "1.05" : "0.7";
    const sane = c.name !== "fat dots" || served.r.includes(expectFat);
    if (!sane) {
      console.log(`  ??   ${c.name.padEnd(14)} -> MUTANT NOT SERVED (--dot-r=${served.r}, expected ${expectFat})`);
      vacuous++;
      continue;
    }

    let out = "";
    try {
      out = execFileSync("node", ["test-masonry.cjs", URL], {
        cwd: "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2",
        encoding: "utf8", timeout: 240000,
      });
    } catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
    const red = out.split("\n").filter((l) => /FAIL/.test(l));
    const wentRed = red.some((l) => l.includes(c.expect));
    console.log(`  ${wentRed ? "ok  " : "VACUOUS"} ${c.name.padEnd(14)} -> ${wentRed ? "caught by: " + c.expect : "GREEN (check is decorative!)"}`);
    if (!wentRed) {
      vacuous++;
      console.log("        failing lines were: " + (red.slice(0, 4).join(" | ") || "(none — suite passed)"));
    }
  }

  // The unmutated copy must still be green, or the harness proves nothing.
  fs.writeFileSync(`${TMP}/index.html`, readIndex());
  let clean = "";
  try {
    clean = execFileSync("node", ["test-masonry.cjs", URL], {
      cwd: "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2",
      encoding: "utf8", timeout: 240000,
    });
  } catch (e) { clean = (e.stdout || "") + (e.stderr || ""); }
  const cleanGreen = /ALL PASS/.test(clean);
  console.log(`  ${cleanGreen ? "ok  " : "??  "} control (unmutated) — ${cleanGreen ? "still green" : "NOT GREEN, harness is unreliable"}`);
  if (!cleanGreen) vacuous++;

  await probe.close();
  await b.close();
  server.close();
  console.log(vacuous ? `\n${vacuous} CHECK(S) VACUOUS` : "\nALL MUTATIONS CAUGHT — the checks have teeth");
  process.exit(vacuous ? 1 : 0);
})();
