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

t = read("allocate.py"); item("allocate.py exists", t is not None)
try:
    tree = ast.parse(t or ""); ok = True
except Exception:
    tree = None; ok = False
item("parses", ok)
item("uses heapq or bisect", anyof(t, r"import heapq", r"from heapq", r"import bisect", r"from bisect"))
def depth(n, d=0):
    loops = (ast.For, ast.While, ast.AsyncFor)
    best = d
    for c in ast.iter_child_nodes(n):
        best = max(best, depth(c, d + (1 if isinstance(c, loops) else 0)))
    return best
item("no loops nested deeper than 2", tree is not None and depth(tree) <= 2)
item("orders by expiry date (FIFO)", has(t, r"expir"))
item("handles partial quantities across warehouses", has(t, r"min\s*\(", r"warehouse"))
item("returns a dict", has(t, r"return\s+\w+") and anyof(t, r"dict", r"\{\s*\}", r"defaultdict"))

done()
