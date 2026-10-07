# Replay harness (PLAN C10)

Runs `build/fetch.mjs` and `build/dc-fetch.mjs` offline against HTTP responses
recorded on DreamHost, with time frozen, and compares the output with a golden
file. Use it to prove a change to the scrapers leaves the feed identical.

```
bash tests/replay/run.sh                  # exit 0 = identical to tests/golden/
bash tests/replay/run.sh --out /tmp/r1    # keep normalized output + logs
bash tests/replay/run.sh --only fetch     # or: --only dc
bash tests/replay/run.sh --update-golden  # rewrite the golden (deliberate output change only)
```

Exit codes: 0 identical, 1 output differs (added/removed/changed event ids and
per-field changes are printed), 2 setup error (no fixtures, no golden), 3 a
scraper crashed or requested a URL that was never recorded.

## Files

| file | what |
|---|---|
| `record.sh` | from the Mac: ships `build/` + this dir to a temp dir on DreamHost, records there with node 18, pulls `fixtures/` back, keeps a tarball on the VPS, deletes the temp dir. `--local DIR` is the on-host half. Never touches `~/whattodo72.com`, never runs `build-site.sh`. |
| `record-preload.mjs` | `node --import` hook for recording: wraps `fetch` and `execFileSync("curl")`, freezes `Date` to `$REPLAY_NOW`. |
| `replay-preload.mjs` | `node --import` hook for replay: serves fixtures, throws on a miss, blocks sockets/other child processes, makes `import("playwright")` fail, freezes `Date`, makes short timers instant. |
| `run.sh` | the replay + compare driver. |
| `compare.mjs` | normalizes (drops `generatedAt`) and diffs feeds by event id. |
| `../golden/events.golden.json`, `../golden/dc-events.golden.json` | normalized replay output of the baseline code (tag `prod-baseline-20261007`). |

## Fixtures

`tests/replay/fixtures/` (gitignored). One file per request,
`<sha1(key)>.json`, where key is `"<METHOD> <url>"` for `fetch` and
`"CURL <JSON of curl args>"` for curl (an `-o <file>` path is normalized to
`<OUTFILE>`; the file's bytes are stored in `outFileBase64`). A fetch fixture is
`{key,kind,status,statusText,url,headers,bodyBase64}`, or `{key,kind,error}` when
the request failed on DreamHost (the failure is replayed). `meta.json` holds
`frozenNow`, `recordedAt`, `nodeVersion`, `count` and the record exit codes;
`_fetch.log`, `_dc-fetch.log`, `_recorded-events.json` and
`_recorded-dc-events.json` are what the live-network recording run printed and
wrote. If one URL is fetched twice in a run, the first response is kept.

Restore on a new machine:

```
ssh hermes 'cat /root/backups/whattodo72-fixtures-20261007.tgz' | tar -xz -C tests/replay/
```

Re-record (needed when a change makes the scrapers ask for URLs that were never
recorded, which shows as exit 3 "not in the fixtures"): `bash tests/replay/record.sh`,
then `run.sh --update-golden` on the BASELINE code first, then re-run your change.
A new recording means new data, so the golden must be regenerated from the
unchanged code before it can judge a change.

## Determinism rules

- `new Date()` / `Date()` / `Date.now()` with no arguments return `frozenNow`;
  `new Date(x)` is untouched. Time also stands still during recording, so the
  window days and luma's "now" filter match exactly.
- `TZ=America/Los_Angeles` in both record and replay (`getFullYear()` etc.).
- `REPLAY_FAST=1` (default): `setTimeout` and `timers/promises.setTimeout`
  delays of 5 s or less run at 0 ms; longer delays (request timeouts) are left
  alone, so a timeout cannot win a race against a replayed response.
- Replayed responses resolve in code order, so `Promise.all` batches and the
  final stable sort produce the same order every run.

## What cannot be replayed (stated, not skipped)

- **Playwright / headless Chrome** (City Lights fallback, the second
  playwright source): not installed on DreamHost, so the recording saw
  "Cannot find package 'playwright'" and the replay forces the same failure.
  Those code paths are not exercised by the golden.
- **Timing/ordering of the live network**: the golden is the replay order, not
  whatever order concurrent responses arrived in on the host. Event content is
  the same; ties in the final sort are broken by insertion order.
- **Node version**: the golden was produced on node 22 on the Mac. ICU/Intl
  differences between node 18 (DreamHost) and 22 could in principle change a
  formatted value; the recording run's own output (`_recorded-events.json`,
  node 18, live network) is kept for that check.
- Any request whose response differs on a second fetch of the same URL in one
  run is replayed with the first response.
