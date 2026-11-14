"""Hidden check for 2.3: the tests are RUN, not read.

The answer is a test file for a function the prompt does not supply. The check
supplies the function (hidden/gst_impl.py, in three spec-compatible flavours,
because the prompt leaves negatives, input validation and rounding open),
runs the tests with a stand-in for pytest (hidden/shim/pytest.py), and then
runs them against broken copies of the function: each must make the tests fail.
Error-message wording is not graded (`match=` is ignored).
"""
import ast, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gst_impl  # noqa: E402

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

def run(variant, mutant=None):
    work = tempfile.mkdtemp()
    try:
        for f in os.listdir("."):
            if f.endswith(".py") and not f.startswith("test_") or f == "test_gst.py":
                shutil.copy(f, work)
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "run_tests.py"), work, variant, mutant or "-"],
                           capture_output=True, text=True, timeout=60, cwd=work)
        last = [l for l in r.stdout.splitlines() if l.startswith("{")]
        return json.loads(last[-1]) if last else {"collected": 0, "passed": 0, "failed": [], "error": (r.stderr or "no output")[-200:]}
    except subprocess.TimeoutExpired:
        return {"collected": 0, "passed": 0, "failed": [], "error": "timeout"}
    finally:
        shutil.rmtree(work, ignore_errors=True)

t = read("test_gst.py")
item("test_gst.py exists", t is not None)
try:
    tree = ast.parse(t or ""); ok = True
except Exception:
    tree = None; ok = False
item("compiles cleanly", ok)
nt = sum(1 for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test_")) if tree else 0
item("at least 5 tests", nt >= 5)

# best-fitting correct implementation: fewest failing tests. A few tests pinned to
# the answer's own design (error wording, a CLI it also wrote) may fail; more than
# one in ten means the tests do not describe the function the prompt asks for.
best, base = None, None
if t is not None and tree is not None:
    for v in gst_impl.VARIANTS:
        r = run(v)
        if r["collected"] == 0 or r["error"]:
            if base is None:
                base_err = r
            continue
        if base is None or len(r["failed_ids"]) < len(base["failed_ids"]):
            best, base = v, r
        if not r["failed_ids"]:
            break
ok = best is not None and len(base["failed_ids"]) <= 0.1 * base["collected"]
item("the tests run and at least 90% pass against a correct implementation", ok)
if t is not None and tree is not None and not ok:
    why = base_err if best is None else base
    print("note:", (why.get("error") or "; ".join(why.get("failed", [])))[:200])
elif base and base["failed_ids"]:
    print(f"note: {len(base['failed_ids'])} of {base['collected']} tests do not hold on any correct implementation, e.g. {base['failed'][0][:100]}")
for name, why in gst_impl.MUTANTS.items():
    if not ok:
        item(f"the tests catch a broken version: {why}", False)
        continue
    r = run(best, name)
    caught = bool(r["error"]) is False and r["collected"] > 0 and bool(set(r["failed_ids"]) - set(base["failed_ids"]))
    item(f"the tests catch a broken version: {why}", caught)
done()
