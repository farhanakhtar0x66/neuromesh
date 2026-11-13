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

t = answer_text(); item("ANSWER.md exists", bool(t.strip()))
rows = [l for l in t.splitlines() if l.strip().startswith("|")]
item("a markdown table with a header separator", any(re.match(r"^\s*\|?\s*:?-{3,}", l) for l in rows))
def row(name):
    return " ".join(l for l in rows if re.search(name, l, re.I))
for n in ["siddharth","neha","rohan"]:
    item(f"a row for {n.title()}", row(n) != "")
item("Siddharth's blocker: DB credentials from infra", has(row("siddharth"), r"credential"))
item("Rohan's blocker: iOS build on Xcode 16", has(row("rohan"), r"xcode"))
item("Neha is not flagged as blocked", not has(row("neha"), r"(yes|blocked|🔴|⛔|❌)") or has(row("neha"), r"(none|no blocker|—|-\s*\|)"))
item("a column or marker for blockers", has(t, r"block"))

done()
