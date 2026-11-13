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

t = read("useSearch.js") or read("useSearch.ts") or read("useSearch.jsx") or ""
item("the hook file exists", bool(t.strip()))
item("uses useEffect", has(t, r"useEffect\s*\("))
item("new AbortController() inside the effect", has(t, r"useEffect[\s\S]*new\s+AbortController\s*\("))
item("passes the signal to fetch", has(t, r"fetch\s*\([\s\S]*signal"))
item("ignores AbortError", has(t, r"AbortError"))
item("controller.abort() in the effect's cleanup", has(t, r"return\s*\(\s*\)\s*=>\s*\{?[\s\S]{0,200}\.abort\(\)"))
item("clears the debounce timer in cleanup", has(t, r"clearTimeout\s*\("))

done()
