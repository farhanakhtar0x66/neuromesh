"""Hidden check for 2.1: the endpoint is RUN, not read.

app.py is imported and sent real webhooks: a body signed with the environment
secret (HMAC-SHA256, hex, in X-Signature) must get 200; a wrong, foreign,
missing or empty signature, or a body changed after signing, must get 400.
The signature is over the raw bytes, so a body with odd whitespace that was
signed as sent must also get 200 (an endpoint that re-serialises the JSON
fails here). FastAPI itself is used if installed; otherwise hidden/fastapi_shim.py
stands in. The secret's variable name is not given in the prompt: any
secret-looking name the app reads holds the test secret.
"""
import json, os, re, shutil, subprocess, sys, tempfile

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

t = read("app.py")
item("app.py exists", t is not None)
out = {"import_error": "no app.py", "route": False, "results": {}}
if t is not None:
    work = tempfile.mkdtemp()
    try:
        for name in os.listdir("."):
            if name == "hidden" or name.startswith("."):
                continue
            (shutil.copytree if os.path.isdir(name) else shutil.copy)(name, os.path.join(work, name))
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "run_app.py"), work], capture_output=True, text=True, timeout=60, cwd=work)
        last = [l for l in r.stdout.splitlines() if l.startswith("{")]
        out = json.loads(last[-1]) if last else {"import_error": (r.stderr or "no output")[-200:], "route": False, "results": {}}
    except subprocess.TimeoutExpired:
        out = {"import_error": "timeout", "route": False, "results": {}}
    finally:
        shutil.rmtree(work, ignore_errors=True)
if out.get("import_error"):
    print("note:", out["import_error"])
res = out.get("results", {})
item("app.py imports and builds an app", t is not None and not out.get("import_error"))
item("POST /webhooks/payment route exists", out.get("route"))
item("a correctly signed webhook gets 200", res.get("valid") == 200)
item("a signature made over the raw body (odd whitespace) gets 200", res.get("valid_odd_whitespace") == 200)
item("a wrong signature gets 400", res.get("wrong_signature") == 400)
item("a signature made with another secret gets 400", res.get("other_secret") == 400)
item("a missing X-Signature header gets 400", res.get("missing_header") == 400)
item("a body changed after signing gets 400", res.get("tampered_body") == 400)
item("an empty signature gets 400", res.get("empty_signature") == 400)
item("compares with hmac.compare_digest", bool(t) and re.search(r"compare_digest\s*\(", t) is not None)
done()
