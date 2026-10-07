# Operating rules for agents (whattodo72.com)

## What runs in production

- Production is DreamHost, user `indigokarasu`, tree `~/whattodo72.com/`.
- DreamHost cron runs `build-site.sh`, which runs `build/fetch.mjs` and the later stages. That is the production scraper.
- `scrape.mjs`, `scrapers/` and `templates/` in the old VPS clone are not used by production. Do not edit them, and do not treat them as the source of truth.
- The source of truth is this repo. Edit files here.

## How to change and deploy

- Make changes in this repo and run the offline tests (`bash tests/run-all.sh`) before anything else.
- Deploy with `ops/deploy.sh` once it exists. Until then, do not copy files to DreamHost by hand.
- Verify on `https://whattodo72.com/test/` first. Only then promote to the live site.
- Never edit generated files such as `build/events.json` by hand. They are rebuilt on every run and are not in git.
- Do not put any password or key in this repo, in a log, or in a chat message.

## Things that look like bugs but are not

- The 3-day window is intentional. Do not widen or narrow it to make a feed look bigger.
- Headless Chrome does not run on DreamHost. City Lights is handled in plain node on purpose.
- DreamHost runs node 18, on purpose. Do not switch the runtime to node 22.

## Where to read more

- docs/ARCHITECTURE.md for the data flow and stage list.
- .ladder/PLAN.md for the contracts in flight.
