"""Hidden check for 3.2: the refactor is RUN, not read.

allocate.py is called on generated orders and warehouse batches and compared
with a plain FIFO-by-expiry allocation (hidden/run_alloc.py explains how it
stays tolerant about the data and return formats, which the prompt leaves
open), then timed on 30,000 orders against 30,000 batches, which a 4-level
nested loop cannot do. The prompt's two structural demands (heapq or bisect;
no loop nested more than two deep) are still checked from the source.
"""
import ast, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)
def read(path):
    try:
        return open(path, encoding="utf-8").read()
    except Exception:
        return None
def anyof(text, *patterns):
    return any(re.search(p, text or "", re.I | re.S) for p in patterns)

t = read("allocate.py")
item("allocate.py exists", t is not None)
try:
    tree = ast.parse(t or ""); ok = True
except Exception:
    tree = None; ok = False
item("parses", ok)
item("uses heapq or bisect", anyof(t, r"import heapq", r"from heapq", r"import bisect", r"from bisect"))
def depth(n, d=0):
    best = d
    for c in ast.iter_child_nodes(n):
        best = max(best, depth(c, d + (1 if isinstance(c, (ast.For, ast.While, ast.AsyncFor)) else 0)))
    return best
item("no loops nested deeper than 2", tree is not None and depth(tree) <= 2)

out = {"error": "no allocate.py", "checks": {}, "notes": []}
if tree is not None:
    work = tempfile.mkdtemp()
    try:
        for name in os.listdir("."):
            if name == "hidden" or name.startswith("."):
                continue
            (shutil.copytree if os.path.isdir(name) else shutil.copy)(name, os.path.join(work, name))
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "run_alloc.py"), work], capture_output=True, text=True, timeout=120, cwd=work)
        last = [l for l in r.stdout.splitlines() if l.startswith("{")]
        out = json.loads(last[-1]) if last else {"error": (r.stderr or "no output")[-300:], "checks": {}, "notes": []}
    except subprocess.TimeoutExpired:
        out = {"error": "timeout: allocate did not finish", "checks": {}, "notes": []}
    finally:
        shutil.rmtree(work, ignore_errors=True)
if out.get("error"):
    print("note:", out["error"])
for n in out.get("notes", [])[:3]:
    print("note:", n)
c = out.get("checks", {})
item("allocate runs on orders and batches", c.get("runs"))
item("returns a dict", c.get("returns_dict"))
item("ships from the earliest expiry first, whatever the list order", c.get("fifo_order"))
item("splits an order across batches and warehouses in expiry order", c.get("split_across_batches"))
item("matches a plain FIFO allocation on 25 random cases", c.get("random_cases"))
item("ships what there is when stock runs out, never more", c.get("stock_runs_out"))
item("leaves its inputs unchanged", c.get("inputs_untouched"))
item("handles 30,000 orders against 30,000 batches in under 10 s", c.get("scales"))
done()
