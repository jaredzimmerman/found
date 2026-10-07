# Architecture (as it is at HEAD)

This describes the build as it runs today. Planned changes are listed at the end.

## Data flow

    sources (web pages, JSON, RSS, hand-kept venue modules)
      -> build/fetch.mjs            writes build/events.json
      -> build-site.sh validation   (inline check, weak; see Planned)
      -> /test/ (publish)           ~/whattodo72.com/test/
      -> live docroot (promote)     ~/whattodo72.com/

The Washington feed follows its own path: build/dc-fetch.mjs writes build/dc-events.json, which is validated and promoted alongside the SF feed.

## Stages of build-site.sh

Verified against the header and stage comments in build-site.sh.

- 0. Import completeness: `node test-imports.mjs`. Refuses to build an incomplete tree.
- 1. Fetch: `node fetch.mjs > build/.fetch.log`. Writes build/events.json. Any non-zero exit aborts the run and the live feed is left untouched.
- 2. Levels: `bash run-levels.sh build` writes build/image-levels.json (artwork tone measurement).
- 2b. Washington feed: `node build/dc-fetch.mjs`, which needs no browser.
- 3. Validate: `validate_feed`, an inline `node -e` check.
- 4. Publish to /test: `publish_feed` and `publish_static`, staged to temp names then moved into place.
- 5. Promote to the live docroot, verified byte-identical per file.
- 6. Read back the public URLs and compare the live feed with this build.
- 7. Check referenced assets (`check_assets`) for /test and live.

## Host topology

- The Mac holds this repo. It cannot reach DreamHost directly.
- Mac -> `ssh hermes` (VPS) -> `ssh dh-backup` (DreamHost).
- Production is DreamHost, user `indigokarasu`, tree `~/whattodo72.com/`. The test tree is `~/whattodo72.com/test/`. build-site.sh sets BUILD to `$ROOT/test/build`, so the build directory on DreamHost is `~/whattodo72.com/test/build`.
- Cron on DreamHost: `12 0,7,13,19 * * *`, running `build-site.sh` and logging to `test/logs/build.log`. The crontab line does not name a time zone. PLAN.md says America/Los_Angeles; that is not verified from the tree or the host.
- The runtime is DreamHost's system node 18 (v18.19.1). Node 22 is not used there because it crashes with SIGTRAP on this kernel (see the header of build-site.sh).
- Headless Chrome does not run on DreamHost. City Lights is fetched and parsed in plain node (sucuri.mjs, citylights-parse.mjs).
- No GitHub is involved in the deploy loop.

## File inventory (build/)

- fetch.mjs: main scraper. Runs each source in `main()` in turn and writes events.json.
- shared.mjs: parts of the pipeline that are not San Francisco specific, plus shared helpers.
- hoods.mjs: neighborhood resolution for San Francisco events.
- hoods-core.mjs: city-agnostic neighborhood resolution.
- dc-hoods.mjs: neighborhood resolution for Washington, D.C.
- title-clean.mjs: title and description cleaning for San Francisco.
- title-clean-core.mjs: city-agnostic body of the title cleaner.
- dc-title-clean.mjs: title and description cleaning for Washington.
- dc-fetch.mjs: Washington, D.C. feed fetcher, writes dc-events.json.
- foopee.mjs: The List (foopee.com) concert guide source.
- sfstation.mjs: SF Station (Transbay Terminal) calendar source.
- manual-venues.mjs: hand-kept parsers for four venues, exported as centerForTheBook, workshopSF, clayroom and scrap (line 892).
- citylights-parse.mjs: City Lights parser, reads structured attributes.
- sucuri.mjs: solves the Sucuri JavaScript interstitial without a browser.
- scrapers/registry.mjs: maps a site to a scraping configuration (`registerSource`, `getSources`, `scrapeSource`).
- scrapers/api.mjs, dom.mjs, jsonld.mjs, rss.mjs: generic strategies (JSON API, HTML DOM, JSON-LD, RSS/Atom).
- templates/index.mjs: per-site templates that map a site's data onto the event shape (Luma, Decentered, Workshop SF, Valkyries).
- venue-catalog.json: venue catalog data. Read by build/fetch.mjs (line 34). No other .mjs or .sh file in the tree reads it.
- bats_parse.py: Python helper with its own usage line. No .mjs or .sh file in the tree references it.
- test-*.mjs: fixture tests for individual parsers. test-imports.mjs is the import-completeness gate.
- index.html: the public page.
- prices-resolved.json: table of box-office links a browser confirmed dead; read by fetch.mjs (line 293) from build/. A second copy sits at the repo root (the old test/ root). fetch.mjs also reads build/prices.json (price overrides, line 279); that file is not in the tree, and the read is guarded, so the feed builds without it.

Outside build/, at the repo root: build-site.sh, run-levels.sh, pinkpages-levels.orig, prices-resolved.json, .htaccess.

## Generated versus source (rule C1)

Deployed from git: build/* source, build-site.sh, run-levels.sh, pinkpages-levels.orig, prices-resolved.json, .htaccess.

Never in git and never overwritten by a deploy: build/events.json, build/dc-events.json, build/image-levels.json, build/.* (dotfiles), logs/, .build.lock, build.prev-*. .gitignore encodes this. Do not edit generated files by hand.

## Deploying

`ops/deploy.sh` (with `ops/lib.sh`) is the only way code reaches DreamHost. It runs on the Mac and reaches DreamHost through `ssh hermes` then `ssh dh-backup`; no GitHub, and no password is read or printed.

    bash ops/deploy.sh             stage, preflight, dry run, swap
    bash ops/deploy.sh --check     stage, preflight, dry run; never swaps
    bash ops/deploy.sh --rollback  swap build/ with the newest build.prev-*
    bash ops/deploy.sh --status    deployed sha vs HEAD, last 3 history lines
    bash ops/deploy.sh --selftest  offline proof against a simulated remote

Steps of a deploy:

- 0. Refuse (exit 2) unless the git tree is clean and HEAD is on a remote branch (`git branch -r --contains HEAD`).
- 1. Stage: `git archive HEAD` is unpacked into `~/whattodo72.com/test/.deploy/<sha>/`.
- 2. Preflight (exit 3), with DreamHost's node 18: `node --check` every `build/**/*.mjs`, `bash -n` every `*.sh`, `bash tests/run-all.sh`.
- 3. Dry run (exit 4): a sandbox ROOT under `.deploy/<sha>/sandbox` gets the staged tree plus a copy of the live generated state and `logs/history.jsonl`, then `DRY_RUN=1 ROOT=<sandbox> SITE_URL=https://whattodo72.com bash build-site.sh` runs against the real sources (about 4 minutes). `--skip-dry-run` is refused unless `--i-know` is also given.
- 4. Swap (exit 5), holding the build lock (`flock -w 900 test/.build.lock`, the lock build-site.sh takes): `build` becomes `build.prev-<utc>` with the old top-level scripts saved in `build.prev-<utc>/_scripts/`; the staged `build` moves in; generated state is copied across (events.json, dc-events.json, image-levels.json and every `build/.*` dotfile except `.deployed-sha`); build-site.sh, run-levels.sh, pinkpages-levels.orig, prices-resolved.json and .htaccess are installed by write-temp-then-`mv`, so a running build-site.sh keeps reading its old file; `build/.deployed-sha` is written; the newest 5 `build.prev-*` are kept; the staging dir is removed. If any part of the swap fails it is undone in reverse order and the output says whether that completed.

Any failure before step 4 leaves prod exactly as it was: the staging dir is removed and nothing else is written. `--rollback` uses the same lock and swaps `build` with the newest `build.prev-*`, restoring that tree's saved scripts and carrying the current generated state; running it again swaps forward. Files in the live `build/` that are neither in the commit nor generated state are not carried; the deploy names them, and they stay in `build.prev-<utc>`.

DreamHost's node 18 sometimes fails to start a thread (`pthread_create: Resource temporarily unavailable`) and then aborts or hangs. A preflight or dry-run step that failed that way is retried twice, 15 s apart, and the output says so.

## Planned in this branch

Contracts C2 to C11, by name only. See .ladder/PLAN.md for the full text.

- C2 Source report
- C3 Floors
- C4 Validator
- C5 History and status
- C6 Lock and limits
- C7 HTTP helper
- C8 Modes of build-site.sh
- C9 Deploy
- C10 Replay harness
- C11 Alerts
