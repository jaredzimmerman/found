import json, re, urllib.request

EM = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️⃣‍]")

def report(label, data):
    ev = data["events"]
    emo = [e for e in ev if EM.search(json.dumps(e, ensure_ascii=False))]
    pres = [e["title"] for e in ev
            if re.search(r"presents", (e.get("description") or "")[:40], re.I)]
    hood = sum(1 for e in ev if e.get("neighborhood"))
    priced = sum(1 for e in ev if e.get("priceLabel"))
    img = sum(1 for e in ev if e.get("image"))
    orphan = sum(1 for e in ev if e.get("neighborhood") in ("Washington", "San Francisco"))
    print(f"{label}: {len(ev)} events | emoji={len(emo)} | presents-openers={len(pres)} {pres}")
    print(f"    hoods={hood}/{len(ev)} (fallback-city={orphan}) | "
          f"priceLabel={priced}/{len(ev)} | image={img}/{len(ev)} | "
          f"desc={sum(1 for e in ev if e.get('description'))}/{len(ev)} | "
          f"addr={sum(1 for e in ev if e.get('address'))}/{len(ev)}")

for path, label in [("events.json", "SF"), ("dc-events.json", "DC")]:
    report(label, json.load(open(path)))

# Both feeds must also satisfy the shared invariants the page enforces.
for path in ["events.json", "dc-events.json"]:
    d = json.load(open(path))
    ev = d["events"]
    assert all(e["url"] for e in ev), f"{path}: row missing url"
    assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["date"]) for e in ev), f"{path}: bad date"
    assert all(e.get("categories") and 1 <= len(e["categories"]) <= 2 for e in ev), f"{path}: bad cats"
    seen, dupes = set(), 0
    for e in ev:
        k = (e["date"], e["title"].lower(), (e.get("venue") or "").lower())
        if k in seen: dupes += 1
        seen.add(k)
    print(f"{path}: url/date/cats OK, exact dupes={dupes}")