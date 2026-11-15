import os, re, sys, json
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def read(path):
    try:
        return open(path, encoding="utf-8").read()
    except Exception:
        return None
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)

t = read("out.tsv"); item("out.tsv exists", t is not None)
lines = (t or "").replace("\r\n", "\n").rstrip("\n").split("\n") if t else []
rows = [l.split("\t") for l in lines]
item("six lines, three tab-separated columns each", len(rows) == 6 and all(len(r) == 3 for r in rows))
item("header is TIMESTAMP_UTC, FACILITY_PRI, MESSAGE", bool(rows) and rows[0] == ["TIMESTAMP_UTC", "FACILITY_PRI", "MESSAGE"])
body = rows[1:] if len(rows) == 6 else []
want_ts = ["2026-11-14T08:15:00Z", "2026-11-14T09:00:00Z", "2026-11-14T10:00:00Z", "2026-11-14T10:05:00Z", "2026-11-14T10:45:00Z"]
item("all five timestamps normalised to UTC Z", [r[0] for r in body] == want_ts)
item("sorted oldest first (facility 34, 86, 165, 14, 131)", [r[1].strip() for r in body] == ["34", "86", "165", "14", "131"])
item("messages are the trimmed message text", [r[2] for r in body] == ["deadlock detected", "pam_unix session opened", "Accepted publickey", "Started daily cleanup", "upstream timed out"])
item("no prose or code fences around the table", t is not None and "```" not in t and len(lines) == 6)
done()
