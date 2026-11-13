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

t = read("output.json"); item("output.json exists", t is not None)
try:
    d = json.loads(t or "")
except Exception:
    d = None
item("parses as JSON", d is not None)
item("a list of exactly 3 objects", isinstance(d, list) and len(d) == 3 and all(isinstance(o, dict) for o in d))
objs = d if isinstance(d, list) else []
item("keys are exactly name, role, salary_inr", objs and all(isinstance(o, dict) and set(o) == {"name","role","salary_inr"} for o in objs))
sal = [o.get("salary_inr") for o in objs if isinstance(o, dict)]
item("salary_inr values are integers", sal and all(type(s) is int for s in sal))
item("salaries are 1850000, 1100000, 360000", sorted(sal) == [360000, 1100000, 1850000] if all(type(s) is int for s in sal) else False)
names = {str(o.get("name","")).strip().lower() for o in objs if isinstance(o, dict)}
item("names are Rahul Sharma, Priya Patel, Aman Verma", names == {"rahul sharma","priya patel","aman verma"})

done()
