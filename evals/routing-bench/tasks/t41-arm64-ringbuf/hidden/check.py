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

a = answer_text(); src = read("src/lib.rs") or ""
item("explains x86 TSO / strong store ordering", anyof(a, r"\bTSO\b", r"total store order", r"x86[^.]*(strong|stronger|does not reorder|doesn't reorder)"))
item("explains ARM64 weak ordering / reordering", has(a, r"(weak|relax|reorder)"))
item("Release on the producer's tail store", has(a + src, r"Release"))
item("Acquire on the consumer's tail load", has(a + src, r"Acquire"))
item("SeqCst not needed", anyof(a, r"SeqCst[^.]*(not|unnecessary|isn't|overkill|no need|avoid)", r"(not|no need|unnecessary|avoid)[^.]*SeqCst"))
item("src/lib.rs exists", bool(src.strip()))
item("uses Ordering::Release in code", has(src, r"Ordering::Release|Release\)"))
item("uses Ordering::Acquire in code", has(src, r"Ordering::Acquire|Acquire\)"))
item("UnsafeCell<MaybeUninit<T>> slots", has(src, r"UnsafeCell", r"MaybeUninit"))
r = subprocess.run(["cargo", "build", "--quiet", "--offline"], capture_output=True, text=True, timeout=600)
item("cargo build passes", r.returncode == 0)

done()
