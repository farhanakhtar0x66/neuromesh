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

t = read("schedule.md"); item("schedule.md exists", t is not None)
lines = [l.strip() for l in (t or "").splitlines() if l.strip()]
table = [l for l in lines if l.startswith("|")]
cells = lambda l: [c.strip() for c in l.strip().strip("|").split("|")]
rows = [cells(l) for l in table]
sep = [r for r in rows if r and all(re.fullmatch(r":?-{3,}:?", c) for c in r)]
body = [r for r in rows[1:] if r not in sep]
item("header is Component | Owner | Target_Date", bool(rows) and [c.lower() for c in rows[0]] == ["component", "owner", "target_date"])
item("a separator row and exactly three data rows", len(sep) == 1 and len(body) == 3 and all(len(r) == 3 for r in body))
item("sorted by date: 2026-11-18, 2026-11-21, 2026-11-25", [r[2] for r in body] == ["2026-11-18", "2026-11-21", "2026-11-25"])
item("owners follow the dates: Aarav, Meera, Kabir", [r[1] for r in body] == ["Aarav", "Meera", "Kabir"])
item("components are oauth, sqlite and websocket work", len(body) == 3 and "oauth" in body[0][0].lower() and "sqlite" in body[1][0].lower() and "websocket" in body[2][0].lower())
item("no code block and no design prose", t is not None and "```" not in t and len(lines) == len(table))
done()
