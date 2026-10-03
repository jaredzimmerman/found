// Screenshot the provenance label in place, on both themes, desktop + phone.
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";

const DIR = "/root/.hermes/profiles/indigo/cache/scratch/sf-events-v2/shots";
mkdirSync(DIR, { recursive: true });
const URL = "https://pinkpages.indigokarasu.com/?cb=" + Date.now();

const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const shots = [
  { name: "prov-light-desktop", theme: "light", vp: { width: 1440, height: 1000 }, phone: false },
  { name: "prov-dark-desktop", theme: "dark", vp: { width: 1440, height: 1000 }, phone: false },
  { name: "prov-light-phone", theme: "light", vp: null, phone: true },
];

for (const s of shots) {
  const ctx = await b.newContext(s.phone ? { ...devices["Pixel 7"] } : { viewport: s.vp });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await p.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch {}
  }, s.theme);
  await p.reload({ waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.mouse.move(2, 2);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${DIR}/${s.name}.png` });
  console.log("wrote " + s.name);
  await ctx.close();
}
await b.close();
