import os, re, sys, json
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
import signal
sys.path.insert(0, os.getcwd())
sys.setrecursionlimit(5000)
signal.alarm(30)
try:
    from resolver import resolve
except Exception as e:
    resolve = None
    print("import failed:", e)

def attempt(fn):
    try:
        return bool(fn())
    except BaseException as e:
        print("  raised", type(e).__name__, e)
        return False

def reg(**pkgs):
    return pkgs

def t_caret():
    r = {
        "A": {"1.2.2": {}, "1.2.3": {}, "1.9.9": {}, "1.10.0": {}, "2.0.0": {}},
        "B": {"0.2.2": {}, "0.2.3": {}, "0.2.9": {}, "0.3.0": {}},
        "C": {"0.0.2": {}, "0.0.3": {}, "0.0.4": {}},
    }
    a = resolve({"A": "^1.2.3"}, r) == {"A": "1.10.0"}
    b = resolve({"B": "^0.2.3"}, r) == {"B": "0.2.9"}
    c = resolve({"C": "^0.0.3"}, r) == {"C": "0.0.3"}
    d = resolve({"A": ">=1.2.3,<1.10.0,!=1.9.9"}, r) == {"A": "1.2.3"}
    e = resolve({"A": "<=1.9.9", "B": ">0.2.3"}, r) == {"A": "1.9.9", "B": "0.3.0"}
    return a and b and c and d and e

def t_diamond():
    r = {
        "A": {"2.0.0": {"C": "^2.0.0"}, "1.5.0": {"C": "^1.2.0"}, "1.0.0": {"C": "^1.0.0"}},
        "B": {"1.0.0": {"C": "^1.0.0"}},
        "C": {"2.0.0": {}, "1.8.0": {}, "1.2.0": {}, "1.1.0": {}, "1.0.0": {}},
    }
    return resolve({"A": ">=1.0.0", "B": ">=1.0.0"}, r) == {"A": "1.5.0", "B": "1.0.0", "C": "1.8.0"}

def t_prune():
    r = {
        "A": {"2.0.0": {"D": ">=1.0.0"}, "1.0.0": {}},
        "D": {"1.0.0": {}},
        "Z": {"1.0.0": {"A": "<2.0.0"}},
    }
    got = resolve({"A": ">=1.0.0", "Z": ">=1.0.0"}, r)
    return got == {"A": "1.0.0", "Z": "1.0.0"} and "D" not in got

def t_cycle():
    r = {
        "A": {"1.0.0": {"B": "^1.0.0"}},
        "B": {"1.0.0": {"A": "^1.0.0"}},
    }
    one = resolve({"A": "^1.0.0"}, r) == {"A": "1.0.0", "B": "1.0.0"}
    r3 = {
        "A": {"1.0.0": {"B": ">=1.0.0"}},
        "B": {"1.0.0": {"C": ">=1.0.0"}},
        "C": {"1.0.0": {"A": ">=1.0.0", "C": ">=1.0.0"}},
    }
    three = resolve({"A": ">=1.0.0"}, r3) == {"A": "1.0.0", "B": "1.0.0", "C": "1.0.0"}
    return one and three

def t_none():
    r = {
        "A": {"1.0.0": {"B": "^2.0.0"}},
        "B": {"1.0.0": {}, "1.5.0": {}},
        "X": {"1.0.0": {}},
    }
    a = resolve({"A": "^1.0.0"}, r) is None
    b = resolve({"A": ">=2.0.0"}, r) is None
    c = resolve({"X": "!=1.0.0"}, r) is None
    d = resolve({"Nope": ">=1.0.0"}, r) is None
    e = resolve({"A": "^1.0.0", "X": "==1.0.0"}, {**r, "A": {"1.0.0": {}}}) == {"A": "1.0.0", "X": "1.0.0"}
    return a and b and c and d and e

item("resolver module imports", resolve is not None)
item("caret rules for ^1.2.3, ^0.2.3, ^0.0.3 and numeric (not text) version order", resolve and attempt(t_caret))
item("a diamond conflict backtracks A from 2.0.0 to 1.5.0 and picks C 1.8.0", resolve and attempt(t_diamond))
item("backtracking drops packages only the abandoned version needed", resolve and attempt(t_prune))
item("cyclic dependencies terminate", resolve and attempt(t_cycle))
item("an unsatisfiable graph returns None", resolve and attempt(t_none))
done()
