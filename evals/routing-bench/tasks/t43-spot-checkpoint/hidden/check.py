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

a = answer_text(); item("ANSWER.md exists", bool(a.strip()))
item("Young/Daly checkpoint interval", anyof(a, r"young", r"daly"))
item("square-root optimum sqrt(2*delta/lambda)", anyof(a, r"sqrt", r"√", r"\\sqrt"))
item("uses the eviction rates as failure rates", has(a, r"(lambda|λ|rate)") and has(a, r"0\.05", r"0\.15", r"0\.3"))
item("checkpoint cost includes I/O and compute time", has(a, r"0\.10|\$0\.1\b", r"12\s*min|0\.2\s*h"))
item("instance selection policy", has(a, r"(select|choose|pick|polic)"))
s = read("sim.py"); item("sim.py exists", s is not None)
try:
    # The Python the engine built and checked the work with (uv picks the newest python3), not the system's 3.9.
    import shutil
    py = os.environ.get("BENCH_PYTHON") or next((c for c in ["/opt/homebrew/bin/python3", shutil.which("python3")] if c and os.path.exists(c)), sys.executable)
    r = subprocess.run([py, "sim.py"], capture_output=True, text=True, timeout=120)
    item("sim.py runs to completion", r.returncode == 0)
    item("sim.py prints results", len(r.stdout.strip()) > 0)
except Exception:
    item("sim.py runs to completion", False); item("sim.py prints results", False)

done()
