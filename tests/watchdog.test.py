#!/usr/bin/env python3
"""Offline tests for ops/watchdog.py and ops/install-watchdog.sh. No network, no real sends."""
import argparse
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("watchdog", os.path.join(ROOT, "ops", "watchdog.py"))
wd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wd)

PASS = FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("FAIL " + name)


NOW = "2026-10-07T20:00:00Z"


def hrs(h):  # timestamp h hours before NOW
    from datetime import datetime, timedelta, timezone
    return (datetime(2026, 10, 7, 20, tzinfo=timezone.utc) - timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")


def good_status(**kw):
    s = {"last_attempt": {"ts": hrs(2), "run_id": "r1", "outcome": "published", "stage": "done"},
         "last_success": {"ts": hrs(2), "run_id": "r1", "total": 1500},
         "consecutive_failures": 0,
         "sources": {"dothebay": {"kept": 900, "zero_streak": 0}, "foopee": {"kept": 50, "zero_streak": 5}},
         "deployed_sha": "abc", "feed_generatedAt": hrs(2)}
    s.update(kw)
    return s


def good_feed(h=2):
    return {"generatedAt": hrs(h), "days": ["a", "b", "c"], "events": [{"id": str(i)} for i in range(1500)]}


class Env:
    def __init__(self):
        self.d = tempfile.mkdtemp()
        self.state = os.path.join(self.d, "state.json")
        self.sent = []
        self.ok = True

    def write(self, name, obj):
        p = os.path.join(self.d, name)
        with open(p, "w") as f:
            f.write(obj if isinstance(obj, str) else json.dumps(obj))
        return p

    def run(self, status, feed, now=NOW, dry=False, status_missing=False):
        sp = os.path.join(self.d, "nope.json") if status_missing else self.write("status.json", status)
        fp = self.write("feed.json", feed)
        a = argparse.Namespace(status_file=sp, feed_file=fp, state_file=self.state, now=now, dry_run=dry)
        def deliver(subj, lines):
            self.sent.append((subj, lines))
            return self.ok
        return wd.run(a, deliver)


# 1. healthy: nothing sent, state file created 0600
e = Env()
check("healthy rc", e.run(good_status(), good_feed()) == 0)
check("healthy sends nothing", e.sent == [])
check("state file written", os.path.exists(e.state))
check("state file 0600", stat.S_IMODE(os.stat(e.state).st_mode) == 0o600)

# 2. stale >14h
e = Env()
e.run(good_status(last_success={"ts": hrs(15), "run_id": "r0", "total": 1400}), good_feed())
check("stale sends one", len(e.sent) == 1)
check("stale subject", "no new feed" in e.sent[0][0])
check("stale mentions last count", any("1400" in l for l in e.sent[0][1]))
check("stale mentions served", any("still serving" in l for l in e.sent[0][1]))
check("stale line count 3-6", 3 <= len(e.sent[0][1]) <= 6)

# 3. exactly 14h is not stale
e = Env()
e.run(good_status(last_success={"ts": hrs(14), "run_id": "r0", "total": 1400}), good_feed())
check("14h boundary quiet", e.sent == [])

# 4. null last_success is stale
e = Env()
e.run(good_status(last_success=None), good_feed())
check("null last_success alerts", len(e.sent) == 1)

# 5. cooldown: same condition not resent within 6h, resent after
st = good_status(last_success={"ts": hrs(20), "run_id": "r0", "total": 1400})
e = Env()
e.run(st, good_feed())
e.run(st, good_feed(), now="2026-10-07T22:00:00Z")
check("cooldown suppresses at +2h", len(e.sent) == 1)
e.run(st, good_feed(), now="2026-10-08T01:59:00Z")
check("cooldown suppresses at +5h59", len(e.sent) == 1)
e.run(st, good_feed(), now="2026-10-08T02:00:00Z")
check("resend at +6h", len(e.sent) == 2)

# 6. recovery message once
e.run(good_status(), good_feed(), now="2026-10-08T02:30:00Z")
check("recovery sent", len(e.sent) == 3 and "back to normal" in e.sent[2][0])
e.run(good_status(), good_feed(), now="2026-10-08T03:00:00Z")
check("recovery only once", len(e.sent) == 3)

# 7. rejected: once per run_id
rej = good_status(last_attempt={"ts": hrs(1), "run_id": "r9", "outcome": "rejected", "stage": "validate"},
                  consecutive_failures=1)
e = Env()
e.run(rej, good_feed())
check("rejected alerts", len(e.sent) == 1 and "rejected" in e.sent[0][0])
e.run(rej, good_feed(), now="2026-10-08T03:00:00Z")  # past cooldown, same run_id
check("same run_id not repeated after cooldown", len(e.sent) == 1)
rej2 = good_status(last_attempt={"ts": hrs(1), "run_id": "r10", "outcome": "fatal", "stage": "fetch"},
                   consecutive_failures=2)
e.run(rej2, good_feed(), now="2026-10-08T04:00:00Z")
check("new run_id alerts", len(e.sent) == 2 and "failed" in e.sent[1][0])

# 8. required source zero streak
zs = good_status(); zs["sources"]["dothebay"]["zero_streak"] = 3
e = Env()
e.run(zs, good_feed())
check("required zero_streak 3 alerts", len(e.sent) == 1 and "dothebay" in e.sent[0][0])
zs2 = good_status(); zs2["sources"]["dothebay"]["zero_streak"] = 2
e = Env()
e.run(zs2, good_feed())
check("zero_streak 2 quiet", e.sent == [])
check("optional source zero ignored", good_status()["sources"]["foopee"]["zero_streak"] == 5 and True)
e = Env()
e.run(good_status(), good_feed())
check("optional source streak 5 quiet", e.sent == [])

# 9. public feed stale / unreadable
e = Env()
e.run(good_status(), good_feed(h=15))
check("feed stale alerts", len(e.sent) == 1 and "out of date" in e.sent[0][0])
e = Env()
e.run(good_status(), "{not json")
check("feed bad json alerts", len(e.sent) == 1 and "cannot be read" in e.sent[0][0])
check("feed bad json plain wording", "JSON" in " ".join(e.sent[0][1]))
e = Env()
e.run(good_status(), {"days": []})
check("feed missing generatedAt alerts", len(e.sent) == 1)

# 10. DH unreachable: own condition, no false stale
e = Env()
e.run(None, good_feed(), status_missing=True)
check("unreachable alerts once", len(e.sent) == 1 and "cannot reach" in e.sent[0][0])
check("unreachable no stale noise", all("no new feed" not in s for s, _ in e.sent))
e.run(None, good_feed(), now="2026-10-07T20:30:00Z", status_missing=True)
check("unreachable deduped", len(e.sent) == 1)
e.run(good_status(), good_feed(), now="2026-10-07T21:00:00Z")
check("unreachable recovery", len(e.sent) == 2 and "back to normal" in e.sent[1][0])

# 11. status file corrupt
e = Env()
e.run("garbage", good_feed())
check("status unreadable alerts", len(e.sent) == 1 and "unreadable" in e.sent[0][0])

# 12. dry run sends nothing, writes no state
e = Env()
e.run(good_status(last_success=None), good_feed(), dry=True)
check("dry-run sends nothing", e.sent == [])
check("dry-run writes no state", not os.path.exists(e.state))

# 13. delivery failure: rc 2, cooldown not updated, retried next run
e = Env(); e.ok = False
st = good_status(last_success={"ts": hrs(20), "run_id": "r0", "total": 1400})
check("failed send rc 2", e.run(st, good_feed()) == 2)
e.ok = True
check("retry succeeds rc 0", e.run(st, good_feed(), now="2026-10-07T20:30:00Z") == 0)
check("retry actually sent", len(e.sent) == 2)

# 14. two conditions at once -> two messages; recovery only when all clear
e = Env()
both = good_status(last_success={"ts": hrs(20), "run_id": "r0", "total": 1400})
both["sources"]["dothebay"]["zero_streak"] = 4
e.run(both, good_feed())
check("two conditions two messages", len(e.sent) == 2)
e.run(zs, good_feed(), now="2026-10-07T20:30:00Z")  # stale clears, zero remains
check("partial clear no recovery", len(e.sent) == 2)

# 15. no emoji / non-ascii in messages
allmsg = " ".join(s + " ".join(l) for s, l in e.sent)
check("messages ascii only", all(ord(c) < 128 for c in allmsg))

# 16. timestamp parsing
check("parse Z", wd.parse_ts("2026-10-07T01:02:03Z") is not None)
check("parse offset", wd.parse_ts("2026-10-07T01:02:03-07:00") is not None)
check("parse junk", wd.parse_ts("tomorrow") is None)

# 17. CLI: failing hermes -> exit 2; stub hermes success -> 0; real hermes never called
d = tempfile.mkdtemp()
stub = os.path.join(d, "hermes")
for rc, name in ((1, "bad"), (0, "good")):
    p = os.path.join(d, name)
    with open(p, "w") as f:
        f.write("#!/bin/sh\ncat >/dev/null\nexit %d\n" % rc)
    os.chmod(p, 0o755)
sf = os.path.join(d, "s.json"); ff = os.path.join(d, "f.json")
json.dump(good_status(last_success=None), open(sf, "w")); json.dump(good_feed(), open(ff, "w"))
for name, want in (("bad", 2), ("good", 0)):
    st_path = os.path.join(d, "state-%s.json" % name)
    env = dict(os.environ, WATCHDOG_HERMES=os.path.join(d, name))
    r = subprocess.run([sys.executable, os.path.join(ROOT, "ops", "watchdog.py"), "--status-file", sf,
                        "--feed-file", ff, "--state-file", st_path, "--now", NOW],
                       env=env, capture_output=True, text=True)
    check("cli exit %s with %s hermes" % (want, name), r.returncode == want)
    if name == "bad":
        s = json.load(open(st_path))
        check("failed send leaves no cooldown", s["active"] == {})

# 18. installer with fake crontab
ct = os.path.join(d, "crontab")
store = os.path.join(d, "tab.txt")
open(store, "w").write("0 1 * * * echo hi\n")
with open(ct, "w") as f:
    f.write('#!/bin/sh\nif [ "$1" = "-l" ]; then cat %s; else cat > %s; fi\n' % (store, store))
os.chmod(ct, 0o755)
bk = os.path.join(d, "bk")
ienv = dict(os.environ, CRONTAB_BIN=ct, BACKUP_DIR=bk)
inst = os.path.join(ROOT, "ops", "install-watchdog.sh")
def sh(*a):
    return subprocess.run(["bash", inst] + list(a), env=ienv, capture_output=True, text=True)
check("check before install", "not installed" in sh("--check").stdout)
# install writes /root/.local/state; skip mkdir failure tolerance by only running if writable
if os.access("/root", os.W_OK):
    pass
else:
    # simulate by pre-creating via a patched copy
    src = open(inst).read().replace("mkdir -p /root/.local/state", "mkdir -p %s/state" % d)
    inst = os.path.join(d, "inst.sh"); open(inst, "w").write(src)
r = sh()
check("install ok", r.returncode == 0 and "installed" in r.stdout)
tab = open(store).read()
check("install keeps old entries", "echo hi" in tab)
check("install adds expected line", "*/30 * * * * flock -n /run/whattodo72-watchdog.lock timeout 120 python3 /root/projects/whattodo72-site/ops/watchdog.py >> /root/.local/state/whattodo72-watchdog.log 2>&1" in tab)
check("install made backup", len(os.listdir(bk)) == 1 and os.listdir(bk)[0].startswith("crontab-pre-whattodo72-watchdog-"))
r = sh()
check("install idempotent", "already installed" in r.stdout and open(store).read().count("watchdog.py") == 1)
check("check after install", sh("--check").stdout.strip() == "installed")
sh("--remove")
tab = open(store).read()
check("remove drops entry keeps others", "watchdog.py" not in tab and "echo hi" in tab)
check("check after remove", "not installed" in sh("--check").stdout)

print("%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
