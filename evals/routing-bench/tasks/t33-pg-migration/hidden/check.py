import os, re, sys, json, ast, subprocess
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
def answer_text():
    return read("ANSWER.md") or ""
def has(text, *patterns):
    return all(re.search(p, text or "", re.I | re.S) for p in patterns)
def anyof(text, *patterns):
    return any(re.search(p, text or "", re.I | re.S) for p in patterns)

t = answer_text() + "\n" + (read("migration.sql") or "")
item("ANSWER.md exists", bool(answer_text().strip()))
item("adds the new columns", has(t, r"add\s+column"))
item("new columns nullable (no NOT NULL on add)", not re.search(r"add\s+column[^;\n]*not\s+null(?![^;\n]*default)", t, re.I))
item("dual-write: trigger or application", anyof(t, r"create\s+(or\s+replace\s+)?trigger", r"dual[- ]?write"))
item("batched backfill", anyof(t, r"skip\s+locked", r"limit\s+\d+", r"batch", r"where\s+id\s*(>|between)"))
item("read switchover phase", anyof(t, r"switch\w*\s+reads?", r"read\s+from\s+the\s+new", r"cut\s*over", r"read\s+switch"))
drop = re.search(r"drop\s+column", t, re.I); add = re.search(r"add\s+column", t, re.I)
item("drops the old column last (contract)", bool(drop and add and drop.start() > add.start()))
item("expand-contract named or phased", anyof(t, r"expand", r"contract", r"phase"))
item("keeps the old service version working", anyof(t, r"old (service|version|microservice)", r"backward", r"rolling"))

done()
