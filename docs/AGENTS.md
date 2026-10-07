# Operating rules for agents (whattodo72.com)

## What runs in production

- Production is DreamHost, user `indigokarasu`, tree `~/whattodo72.com/`.
- DreamHost cron runs `build-site.sh`, which runs `build/fetch.mjs` and the later stages. That is the production scraper.
- Live code in this repo: everything under `build/`, including `build/scrapers/` and `build/templates/` (imported by `build/fetch.mjs`), plus `build-site.sh` and `run-levels.sh`.
- Not used by production: the top-level `scrape.mjs`, `scrapers/` and `templates/` of the old clone at `/root/projects/fog-found/` on the VPS. Do not edit them, and do not treat them as the source of truth. They are not the same files as `build/scrapers/` and `build/templates/` in this repo.
- The source of truth is this repo. Edit files here.

## How to change and deploy

- Make changes in this repo. Run the offline tests before anything else. `bash tests/run-all.sh` is the offline runner (`node --check`, `bash -n`, `build/test-*.mjs`, import-completeness gate). `bash tests/check-docs.sh` is the docs check.
- `ops/`: `ops/deploy.sh` is the only way to put code on DreamHost: commit, push, then `bash ops/deploy.sh` (preflight with node 18, dry run against the live sources, swap under the build lock; `--rollback` undoes it, `--status` shows what is live). Never copy or edit files on DreamHost by hand. `ops/watchdog.py` runs on the VPS and alerts on failed or stale builds.
- What happens today: `build-site.sh` publishes to `/test/` and then promotes to the live site in the same run, with no check in between. Nothing is verified on `/test/` before it goes live. A check-before-promote step (`STAGE_ONLY`) is planned in `.ladder/PLAN.md` (C8).
- Never edit generated files such as `build/events.json` by hand. They are rebuilt on every run and are not in git.
- Do not put any password or key in this repo, in a log, or in a chat message.

## Things that look like bugs but are not

- The 3-day window is intentional. Do not widen or narrow it to make a feed look bigger.
- Headless Chrome does not run on DreamHost. City Lights is handled in plain node on purpose.
- DreamHost runs node 18, on purpose. Do not switch the runtime to node 22.

## Where to read more

- docs/ARCHITECTURE.md for the data flow and stage list.
- .ladder/PLAN.md for the contracts in flight.
