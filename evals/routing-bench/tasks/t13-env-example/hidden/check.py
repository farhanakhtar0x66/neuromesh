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

t = read(".env.example"); item(".env.example exists", t is not None)
lines = (t or "").splitlines()
body = [l for l in lines if l.strip() and not l.strip().startswith("#")]
for k in ["DATABASE_URL","REDIS_HOST","JWT_SECRET_KEY","RAZORPAY_WEBHOOK_SECRET"]:
    item(f"{k}= line", any(re.match(rf"^{k}=.*$", l) for l in body))
item("every variable line matches ^[A-Z0-9_]+=.*$", body and all(re.match(r"^[A-Z0-9_]+=.*$", l) for l in body))
item("only the 4 variables", sorted(l.split("=")[0] for l in body) == sorted(["DATABASE_URL","REDIS_HOST","JWT_SECRET_KEY","RAZORPAY_WEBHOOK_SECRET"]))
item("a # comment for each (at least 4 comment lines)", sum(1 for l in lines if l.strip().startswith("#")) >= 4)
item("blank: no secret values filled in", all(re.match(r"^[A-Z0-9_]+=(\s*|localhost|\"\"|'')$", l) for l in body))

done()
