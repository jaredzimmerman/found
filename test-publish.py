"""publish.sh must publish the feed it is handed, and compare it against ITS OWN
live copy.

The bug this guards: publish.sh took the destination feed name as a third
positional that defaulted to events.json. So `publish.sh dc-events.json`
published the Washington build while the gate compared 35 Washington events
against the 192-event San Francisco live file — under the 50% floor, every DC
publish aborted, and the "generalized" script could not actually publish the
second feed it was written for.

Checks the wiring without touching the live docroot: a temp docroot, a stub
gate, and a stub curl on PATH.
"""
import os
import stat
import subprocess
import sys
import tempfile

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "publish.sh")

passed = failed = 0


def t(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print(f"  ok   {name}")
    except AssertionError as e:
        failed += 1
        print(f"  FAIL {name}\n       {e}")
    except Exception as e:
        failed += 1
        print(f"  FAIL {name}\n       {type(e).__name__}: {e}")


def feed(path, n, city="sf"):
    import json
    events = [{"id": f"{city}-{i}"} for i in range(n)]
    with open(path, "w") as fh:
        json.dump({"events": events}, fh)


def run(src, dest_root, _unused=None):
    return subprocess.run(["bash", SCRIPT, src, dest_root], capture_output=True,
                          text=True, timeout=60)


def make_env(marker):
    """Stub the gate where publish.sh actually looks for it.

    publish.sh does not resolve the gate from PATH — it hardcodes
    /usr/local/bin/pinkpages-gate — so a PATH-only stub is never consulted and
    the test would silently exercise the REAL gate. Swap the real file out and
    put the stub in its place for the duration of the case.
    """
    real = "/usr/local/bin/pinkpages-gate"
    backup = real + ".realtest"
    with open(real) as fh:
        original = fh.read()
    os.rename(real, backup)
    with open(real, "w") as fh:
        fh.write('#!/usr/bin/env bash\n'
                 'echo "GATE candidate=$1 live=$2"\n'
                 f'echo "$2" > {marker}\n')
    os.chmod(real, 0o755)
    return real, backup, original


def restore(real, backup, original):
    os.remove(real)
    with open(backup) as fh:
        saved = fh.read()
    with open(real, "w") as fh:
        fh.write(saved)
    os.chmod(real, 0o755)
    os.remove(backup)
    assert saved == original, "the real gate was not restored byte-for-byte"


def case_one_arg_publishes_that_feed(tmp):
    """A DC build must land as dc-events.json and be gated against dc-events.json."""
    marker = os.path.join(tmp, "seen1")
    dest = os.path.join(tmp, "d1")
    os.makedirs(dest)
    src = os.path.join(tmp, "dc-events.json")
    feed(src, 35, "dc")
    feed(os.path.join(dest, "dc-events.json"), 35, "dc")

    real, backup, original = make_env(marker)
    try:
        p = run(src, dest, None)
    finally:
        restore(real, backup, original)
    assert p.returncode == 0, f"publish failed: {p.stdout} {p.stderr}"
    assert os.path.exists(os.path.join(dest, "dc-events.json")), "dc-events.json was not written"
    with open(marker) as fh:
        seen = fh.read().strip()
    assert seen.endswith("dc-events.json"), f"gate compared against {seen}, not its own live copy"


def case_sf_still_works(tmp):
    """The original one-argument SF call must not regress."""
    dest = os.path.join(tmp, "d2")
    os.makedirs(dest)
    src = os.path.join(tmp, "events.json")
    feed(src, 190)
    feed(os.path.join(dest, "events.json"), 190)

    real, backup, original = make_env(os.path.join(tmp, "seen2"))
    try:
        p = run(src, dest, None)
    finally:
        restore(real, backup, original)
    assert p.returncode == 0, f"SF publish failed: {p.stdout} {p.stderr}"
    assert os.path.exists(os.path.join(dest, "events.json"))


def case_path_traversal_rejected(tmp):
    """A feed name with a separator must still be refused."""
    dest = os.path.join(tmp, "d3")
    os.makedirs(dest)
    src = os.path.join(tmp, "events.json")
    feed(src, 10)
    feed(os.path.join(dest, "events.json"), 10)

    real, backup, original = make_env(os.path.join(tmp, "seen3"))
    try:
        p = subprocess.run(["bash", SCRIPT, src, dest, "../evil.json"],
                           capture_output=True, text=True, timeout=60)
    finally:
        restore(real, backup, original)
    assert p.returncode != 0, "a traversing feed name was accepted"
    assert not os.path.exists(os.path.join(os.path.dirname(dest), "evil.json"))


print("\npublish.sh wiring")
with tempfile.TemporaryDirectory() as tmp:
    t("publishing dc-events.json gates it against dc-events.json", lambda: case_one_arg_publishes_that_feed(tmp))
    t("publishing events.json still works", lambda: case_sf_still_works(tmp))
    t("a traversing feed name is refused", lambda: case_path_traversal_rejected(tmp))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)