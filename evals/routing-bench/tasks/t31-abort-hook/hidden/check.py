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

hook = read("useSearch.js") or read("useSearch.ts") or read("useSearch.jsx") or ""
# The hook may delegate to helper modules it wrote: every JS/TS file of the answer counts for the API items.
code = []
for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if d not in ("node_modules", "hidden", ".git", ".bench")]
    code += [read(os.path.join(root, f)) or "" for f in files if re.search(r"\.(m?[jt]sx?)$", f) and "test" not in f.lower()]
t = "\n".join(code)
item("the hook file exists", bool(hook.strip()))
# A cleanup is returned explicitly (return () => ...) or by an arrow that returns one (useEffect(() => () => ...)).
item("the hook uses useEffect with a cleanup", has(hook, r"useEffect\s*\(") and anyof(hook, r"return\s*\(\s*\)\s*=>", r"useEffect\s*\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>", r"return\s+\w+\s*;?\s*\}\s*,\s*\["))
item("a new AbortController per request", has(t, r"new\s+AbortController\s*\("))
item("passes the signal to fetch", has(t, r"fetch\w*\s*\([\s\S]{0,200}signal"))
item("ignores AbortError", has(t, r"AbortError"))
item("aborts the request on cleanup", has(t, r"\.abort\(\)"))
item("clears the debounce timer", has(t, r"clear(Timeout|Timer)\s*\("))

done()
