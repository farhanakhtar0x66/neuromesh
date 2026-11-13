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

t = read("app.py"); item("app.py exists", t is not None)
try:
    tree = ast.parse(t or ""); ok = True
except Exception:
    tree = None; ok = False
item("ast.parse passes", ok)
item("imports hmac", has(t, r"(?m)^\s*(import hmac|from hmac import)"))
item("uses hmac.compare_digest", has(t, r"compare_digest\s*\("))
item("reads the raw body with await request.body()", has(t, r"await\s+\w+\.body\(\)"))
item("HMAC with SHA-256", has(t, r"sha256"))
item("reads the X-Signature header", has(t, r"x-signature"))
item("secret from the environment", anyof(t, r"os\.environ", r"os\.getenv", r"getenv\(", r"BaseSettings"))
item("POST /webhooks/payment route", has(t, r"\.post\(\s*['\"]/webhooks/payment['\"]"))
item("returns 400 when invalid", anyof(t, r"status_code\s*=\s*400", r"HTTP_400", r"\b400\b"))

done()
