# whattodo72.com build

This repo holds the source for whattodo72.com. The site lists events for the next three days in San Francisco and Washington, D.C.

Production is DreamHost, not this machine. A cron job on DreamHost runs `build-site.sh` several times a day, and that job writes the live site.

There is no GitHub in the deploy loop. The canonical remote is a bare repo on the VPS: `hermes:/root/git/whattodo72-site.git`.

## Tests

To run the offline tests, use `bash tests/run-all.sh`. It runs `node --check` on every build/*.mjs, `bash -n` on every shell script, the build/test-*.mjs tests, and the import-completeness gate.
To check the docs, use `bash tests/check-docs.sh`. It checks that the docs exist and state the required facts.

## Where to read more

- docs/ARCHITECTURE.md: data flow, build stages, hosts, file list.
- docs/AGENTS.md: operating rules for agents.
- .ladder/PLAN.md: the planned changes and their contracts.
