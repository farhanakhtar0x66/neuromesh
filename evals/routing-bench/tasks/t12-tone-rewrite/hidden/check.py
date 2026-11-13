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

t = answer_text(); w = len(t.split())
item("ANSWER.md exists and is not empty", w > 0)
item("15 to 120 words", 15 <= w <= 120)
item("mentions the API keys", has(t, r"api\s*keys?"))
item("mentions the DevOps ticket", has(t, r"devops", r"ticket"))
item("mentions the blocked build", has(t, r"build", r"block"))
item("drops the irritation", not anyof(t, r"already told u", r"pissed", r"\blol\b", r"nobody from devops replied"))

done()
