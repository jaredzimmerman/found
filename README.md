# whattodo72.com build

This repo holds the source for whattodo72.com, a three-day listing of events in San Francisco (and Washington, D.C.). The live site is served from DreamHost, where a cron job runs `build-site.sh` several times a day. Production is DreamHost, not this machine and not any other host.

There is no GitHub in the deploy loop. The canonical remote for this work is a bare repo on the VPS at `hermes:/root/git/whattodo72-site.git`.

To run the offline tests: `bash tests/run-all.sh` (the runner is added by T03 in the scraper-hardening branch; it is not at HEAD yet).

Architecture and stage list: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Operating rules for agents: [docs/AGENTS.md](docs/AGENTS.md). Build plan and contracts: [.ladder/PLAN.md](.ladder/PLAN.md).
