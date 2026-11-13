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

t = read("output.csv"); item("output.csv exists", t is not None)
lines = [l.strip() for l in (t or "").splitlines() if l.strip()]
item("header is timestamp,pid", bool(lines) and lines[0] == "timestamp,pid")
rows = [tuple(x.strip().strip('"') for x in l.split(",")) for l in lines[1:]]
item("two columns on every row", rows and all(len(r) == 2 for r in rows))
want = {("14209.881045","412"), ("14209.881102","1984"), ("14209.881290","1984"), ("14210.004112","882"), ("14210.119402","519")}
for w in sorted(want):
    item(f"row {w[0]},{w[1]}", w in set(rows))
extra = [r for r in rows if r not in want and not (len(r) == 2 and r[0] == "14209.881021" and r[1] in ("", "-", "N/A", "n/a", "null"))]
item("no wrong rows", bool(rows) and not extra)
item("no duplicate rows", bool(rows) and len(rows) == len(set(rows)))

done()
