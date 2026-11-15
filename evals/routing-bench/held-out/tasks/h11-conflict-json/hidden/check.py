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

t = read("out.json"); item("out.json exists", t is not None)
try:
    d = json.loads(t or "")
except Exception:
    d = None
item("parses as a JSON object", isinstance(d, dict))
d = d if isinstance(d, dict) else {}
item("exactly the keys TIMEOUT_MS, RETRY_CAP, MAX_WORKERS, PORT", set(d) == {"TIMEOUT_MS", "RETRY_CAP", "MAX_WORKERS", "PORT"})
item("every value is an integer", bool(d) and all(isinstance(v, int) and not isinstance(v, bool) for v in d.values()))
item("conflicts keep the incoming side (TIMEOUT_MS 5000, PORT 9090)", d.get("TIMEOUT_MS") == 5000 and d.get("PORT") == 9090)
item("duplicate keys keep the last value (MAX_WORKERS 16)", d.get("MAX_WORKERS") == 16)
item("RETRY_CAP is 3", d.get("RETRY_CAP") == 3)
item("no conflict marker text in the file", t is not None and not re.search(r"<<<<<<<|=======|>>>>>>>", t))
done()
