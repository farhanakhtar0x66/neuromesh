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

t = read("test_gst.py"); item("test_gst.py exists", t is not None)
try:
    tree = ast.parse(t or ""); ok = True
except Exception:
    tree = None; ok = False
item("compiles cleanly", ok)
tests = [n for n in ast.walk(tree)] if tree else []
nt = sum(1 for n in tests if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith("test_"))
item("at least 5 tests", nt >= 5)
item("pytest.raises(ValueError) for negative amounts", has(t, r"raises\(\s*ValueError"))
item("pytest.approx or Decimal rounding", anyof(t, r"approx\(", r"Decimal\("))
item("tests zero", anyof(t, r"\(\s*0(\.0)?\s*,", r"amount\s*=\s*0(\.0)?\b", r"zero"))
item("tests interstate and intrastate", has(t, r"True", r"False") and has(t, r"igst", r"cgst", r"sgst"))
item("calls calculate_gst_split", has(t, r"calculate_gst_split\("))

done()
