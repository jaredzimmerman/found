#!/usr/bin/env python3
"""whattodo72.com watchdog (contract C11). Runs on the Hermes VPS, outside DreamHost.

Reads logs/status.json from DreamHost over ssh and the public events.json, and
sends a plain-language alert through `hermes send` when the feed is stale or the
build is failing, plus one recovery message. Python 3.9+, stdlib only.

Exit codes: 0 ok, 2 a message could not be delivered (state not updated, so the
next run retries).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone

STALE_HOURS = 14
COOLDOWN_HOURS = 6
ZERO_STREAK_LIMIT = 3
REQUIRED_SOURCES = ["dothebay"]  # C3: only dothebay is required
STATE_DEFAULT = "/root/.local/state/whattodo72-watchdog.json"
FEED_URL = "https://whattodo72.com/events.json"
STATUS_CMD = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "dh-backup",
              "cat ~/whattodo72.com/test/logs/status.json"]
HERMES_CANDIDATES = ["/usr/local/bin/hermes", "/root/.local/bin/hermes"]


def parse_ts(s):
    """ISO 8601 -> aware datetime (naive values are taken as UTC). None if unparseable."""
    if not isinstance(s, str) or not s:
        return None
    try:
        t = s.strip()
        if t.endswith("Z") or t.endswith("z"):
            t = t[:-1] + "+00:00"
        d = datetime.fromisoformat(t)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def age_hours(then, now):
    return (now - then).total_seconds() / 3600.0


def human_since(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def log(msg):
    print("watchdog: " + msg, file=sys.stderr)


# ---------------------------------------------------------------- inputs
def read_status(path):
    """Return (kind, data). kind: ok | unreachable | unreadable."""
    if path:
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            return "unreachable", None
        except OSError:
            return "unreadable", None
    else:
        try:
            p = subprocess.run(STATUS_CMD, capture_output=True, text=True, timeout=40)
        except (subprocess.TimeoutExpired, OSError):
            return "unreachable", None
        if p.returncode == 255:
            return "unreachable", None
        if p.returncode != 0:
            return "unreadable", None
        text = p.stdout
    try:
        data = json.loads(text)
    except ValueError:
        return "unreadable", None
    if not isinstance(data, dict):
        return "unreadable", None
    return "ok", data


def read_feed(path):
    """Return (feed_dict_or_None, problem_text_or_None)."""
    try:
        if path:
            with open(path, "rb") as f:
                raw = f.read()
        else:
            req = urllib.request.Request(FEED_URL, headers={"User-Agent": "whattodo72-watchdog/1"})
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
    except Exception as e:  # network, file, http error
        return None, "the public feed could not be fetched (%s)" % type(e).__name__
    try:
        feed = json.loads(raw.decode("utf-8"))
    except ValueError:
        return None, "the public feed is not valid JSON"
    if not isinstance(feed, dict):
        return None, "the public feed is not valid JSON"
    return feed, None


# ---------------------------------------------------------------- conditions
def feed_count(feed):
    ev = feed.get("events") if isinstance(feed, dict) else None
    return len(ev) if isinstance(ev, list) else None


def served_line(feed, feed_problem, now):
    if feed is None:
        return "The public site could not be read just now (%s)." % (feed_problem or "unknown problem")
    n = feed_count(feed)
    g = parse_ts(feed.get("generatedAt"))
    parts = []
    if n is not None:
        parts.append("%d events" % n)
    if g:
        parts.append("last refreshed %s" % human_since(g))
    return "The public site is still serving %s." % (", ".join(parts) if parts else "an older copy")


def detect(status_kind, status, feed, feed_problem, now):
    """Return list of dicts {key, subject, lines, run_id?} for each active condition."""
    conds = []
    last_good = None
    if status_kind == "ok":
        ls = status.get("last_success")
        if isinstance(ls, dict) and ls.get("total") is not None:
            last_good = "The last good build had %s events." % ls.get("total")
    good_line = last_good or "There is no record of a last good build."
    served = served_line(feed, feed_problem, now)

    if status_kind == "unreachable":
        conds.append({"key": "dh_unreachable",
                      "subject": "whattodo72: cannot reach the build server",
                      "lines": ["The watchdog could not log in to the DreamHost build server.",
                                "It cannot tell whether builds are running until it can.",
                                served]})
    elif status_kind == "unreadable":
        conds.append({"key": "status_unreadable",
                      "subject": "whattodo72: build status file is unreadable",
                      "lines": ["The build server answered, but its status file is missing or damaged.",
                                "It cannot tell whether builds are running.",
                                served]})
    else:
        ls = status.get("last_success")
        ls_ts = parse_ts(ls.get("ts")) if isinstance(ls, dict) else None
        if ls_ts is None or age_hours(ls_ts, now) > STALE_HOURS:
            since = ("since %s" % human_since(ls_ts)) if ls_ts else "(no successful publish is on record)"
            conds.append({"key": "stale",
                          "subject": "whattodo72: no new feed in over %d hours" % STALE_HOURS,
                          "lines": ["The build has not published a new feed %s." % since,
                                    "That is more than %d hours; builds should land every 6 hours." % STALE_HOURS,
                                    good_line, served]})
        la = status.get("last_attempt")
        if isinstance(la, dict) and la.get("outcome") in ("rejected", "fatal"):
            how = ("was stopped by the safety check" if la["outcome"] == "rejected"
                   else "failed with an error")
            at = parse_ts(la.get("ts"))
            conds.append({"key": "build_failed", "run_id": la.get("run_id"),
                          "subject": "whattodo72: the latest build %s" % ("was rejected" if la["outcome"] == "rejected" else "failed"),
                          "lines": ["The latest build %s%s." % (how, (" at %s" % human_since(at)) if at else ""),
                                    "Stage it stopped at: %s." % (la.get("stage") or "unknown"),
                                    "Consecutive failed builds: %s." % status.get("consecutive_failures", "unknown"),
                                    good_line, served]})
        srcs = status.get("sources") if isinstance(status.get("sources"), dict) else {}
        for name in REQUIRED_SOURCES:
            info = srcs.get(name)
            z = info.get("zero_streak") if isinstance(info, dict) else None
            if isinstance(z, int) and z >= ZERO_STREAK_LIMIT:
                conds.append({"key": "source_zero:" + name,
                              "subject": "whattodo72: source %s is returning nothing" % name,
                              "lines": ["The required source '%s' returned no events in the last %d builds." % (name, z),
                                        "Most of the feed comes from it, so the site may be thin or stale soon.",
                                        good_line, served]})

    if feed is None:
        conds.append({"key": "feed_unreadable",
                      "subject": "whattodo72: the public site feed cannot be read",
                      "lines": ["Problem: %s." % feed_problem,
                                "Visitors may be seeing an empty or broken site.",
                                good_line]})
    else:
        g = parse_ts(feed.get("generatedAt"))
        if g is None or age_hours(g, now) > STALE_HOURS:
            when = ("was last refreshed %s" % human_since(g)) if g else "has no readable refresh time"
            conds.append({"key": "feed_stale",
                          "subject": "whattodo72: the public site is out of date",
                          "lines": ["The public feed %s." % when,
                                    "That is more than %d hours old." % STALE_HOURS,
                                    good_line, served]})
    return conds


# ---------------------------------------------------------------- state
def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            s = json.load(f)
        if isinstance(s, dict) and isinstance(s.get("active"), dict):
            s.setdefault("notified_runs", [])
            return s
    except (OSError, ValueError):
        pass
    return {"active": {}, "notified_runs": []}


def save_state(path, state):
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".wd-", dir=d)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=1, sort_keys=True)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- delivery
def find_hermes():
    env = os.environ.get("WATCHDOG_HERMES")
    if env:
        return env
    w = shutil.which("hermes")
    if w:
        return w
    for c in HERMES_CANDIDATES:
        if os.path.exists(c):
            return c
    return "hermes"


def send(subject, lines):
    target = os.environ.get("WATCHDOG_TARGET", "telegram")  # D1: home channel
    cmd = [find_hermes(), "send", "--to", target, "--subject", subject, "--quiet"]
    try:
        p = subprocess.run(cmd, input="\n".join(lines) + "\n", capture_output=True, text=True, timeout=90)
    except (subprocess.TimeoutExpired, OSError) as e:
        log("hermes send failed: %s" % type(e).__name__)
        return False
    if p.returncode != 0:
        log("hermes send exited %d: %s" % (p.returncode, (p.stderr or "").strip()[:300]))
        return False
    return True


# ---------------------------------------------------------------- main
def run(args, deliver=None):
    deliver = deliver or send
    now = parse_ts(args.now) if args.now else datetime.now(timezone.utc)
    if now is None:
        log("bad --now value")
        return 1
    kind, status = read_status(args.status_file)
    feed, feed_problem = read_feed(args.feed_file)
    conds = detect(kind, status, feed, feed_problem, now)
    state = load_state(args.state_file)
    active = state["active"]
    failed = False
    outgoing = []  # (subject, lines, apply_fn)

    present = {c["key"] for c in conds}
    for c in conds:
        key = c["key"]
        prev = active.get(key)
        if prev is None:
            first_seen, last_sent = iso(now), None
        else:
            first_seen, last_sent = prev.get("first_seen", iso(now)), parse_ts(prev.get("last_sent"))
        run_id = c.get("run_id")
        due = last_sent is None or (now - last_sent) >= timedelta(hours=COOLDOWN_HOURS)
        if run_id is not None and run_id in state["notified_runs"]:
            due = False
        lines = list(c["lines"])
        if prev is not None and key not in ("build_failed",):
            lines.insert(1, "First noticed at %s." % human_since(parse_ts(first_seen) or now))

        def apply(key=key, first_seen=first_seen, run_id=run_id):
            active[key] = {"first_seen": first_seen, "last_sent": iso(now)}
            if run_id is not None:
                state["notified_runs"] = (state["notified_runs"] + [run_id])[-50:]
        if due:
            outgoing.append((c["subject"], lines, apply))
        elif prev is None:
            active[key] = {"first_seen": first_seen, "last_sent": None}

    for s, l, apply in outgoing:
        if args.dry_run:
            print("SUBJECT: %s\n%s\n" % (s, "\n".join(l)))
            continue
        if deliver(s, l):
            apply()
        else:
            failed = True

    cleared = [k for k in list(active) if k not in present]
    for k in cleared:
        del active[k]
    if not present and cleared:
        subj = "whattodo72: back to normal"
        body = ["Everything is clear again: builds are fresh and the public site is up to date.",
                served_line(feed, feed_problem, now)]
        if args.dry_run:
            print("SUBJECT: %s\n%s\n" % (subj, "\n".join(body)))
        elif not deliver(subj, body):
            failed = True
            for k in cleared:  # keep so recovery retries
                active[k] = {"first_seen": iso(now), "last_sent": iso(now)}

    if not args.dry_run:
        # Failed sends never call apply(), so their cooldown is untouched and they retry.
        save_state(args.state_file, state)
    return 2 if failed else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="whattodo72 feed watchdog")
    ap.add_argument("--status-file")
    ap.add_argument("--feed-file")
    ap.add_argument("--state-file", default=STATE_DEFAULT)
    ap.add_argument("--now")
    ap.add_argument("--dry-run", action="store_true")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
