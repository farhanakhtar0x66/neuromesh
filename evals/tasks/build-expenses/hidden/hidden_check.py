"""Hidden battery for the expense tracker: only what the prompt states. Prints SCORE passed/total."""
import csv, glob, json, os, re, subprocess, sys, tempfile, datetime

def has_id(out, n): return re.search(rf"(?<![\d.]){n}(?![\d.])", out) is not None

work = tempfile.mkdtemp(prefix="exp-")
def run(*args, file="data.json", cwd=None):
    cmd = [sys.executable, os.path.abspath("expenses.py")]
    if file is not None: cmd += ["--file", os.path.join(work, file)]
    p = subprocess.run(cmd + list(args), capture_output=True, text=True, timeout=30, cwd=cwd or os.getcwd())
    return p.returncode, p.stdout, p.stderr
def listed(*args, file="data.json"): return json.loads(run("list", "--json", *args, file=file)[1])
def totals(by, file="data.json"): return json.loads(run("totals", "--by", by, "--json", file=file)[1])

results = []
def case(name, fn):
    try: ok = bool(fn())
    except Exception as e: ok = False; name += f" [{type(e).__name__}: {str(e)[:80]}]"
    results.append(ok); print(("PASS " if ok else "FAIL ") + name)

def t_add():
    c, out, err = run("add", "12.5", "Food", "--note", "lunch, with \"friends\"", "--date", "2026-03-05")
    return c == 0 and has_id(out, 1) and os.path.exists(os.path.join(work, "data.json"))
case("add creates the file and prints id 1", t_add)
run("add", "3", " Travel ", "--date", "2026-03-01")
run("add", "100.25", "rent", "--date", "2026-04-01", "--note", "line one\nline two")
run("add", "7.00", "food", "--date", "2026-03-05")
def t_list():
    rows = listed()
    return [r["id"] for r in rows] == [2, 1, 4, 3] and rows[1] == {"id": 1, "date": "2026-03-05", "amount": "12.50", "category": "food", "note": "lunch, with \"friends\""}
case("list --json: order, keys, two-decimal amounts, lower-cased category", t_list)
case("category is trimmed", lambda: listed()[0]["category"] == "travel")
case("list --category", lambda: [r["id"] for r in listed("--category", "food")] == [1, 4])
case("list --month", lambda: [r["id"] for r in listed("--month", "2026-04")] == [3])
def t_plain_list():
    c, out, err = run("list")
    return c == 0 and "rent" in out and "100.25" in out and "travel" in out
case("plain list shows the expenses", t_plain_list)
case("totals by category", lambda: totals("category") == {"food": "19.50", "travel": "3.00", "rent": "100.25"})
case("totals by month", lambda: totals("month") == {"2026-03": "22.50", "2026-04": "100.25"})
def t_plain_totals():
    c, out, _ = run("totals", "--by", "category")
    return c == 0 and "19.50" in out and "food" in out
case("plain totals show the sums", t_plain_totals)
def t_exact():
    for _ in range(10): run("add", "0.10", "dimes", "--date", "2026-05-01", file="exact.json")
    run("add", "0.20", "dimes", "--date", "2026-05-01", file="exact.json")
    return totals("category", file="exact.json") == {"dimes": "1.20"}
case("totals are exact (no float drift)", t_exact)
def t_today():
    run("add", "1", "x", file="today.json")
    return listed(file="today.json")[0]["date"] == datetime.date.today().isoformat()
case("the date defaults to today", t_today)
def t_export():
    out_path = os.path.join(work, "out.csv")
    c, out, _ = run("export", out_path)
    rows = list(csv.reader(open(out_path, newline="")))
    return c == 0 and "4" in out and rows[0] == ["id", "date", "amount", "category", "note"] and [r[0] for r in rows[1:]] == ["2", "1", "4", "3"] and rows[2][4] == "lunch, with \"friends\"" and rows[4][4] == "line one\nline two" and rows[2][2] == "12.50"
case("export: header, order, quoting of commas, quotes and line breaks", t_export)
def t_delete():
    c, _, _ = run("delete", "4")
    c2, out, _ = run("add", "1", "misc", "--date", "2026-03-09")
    return c == 0 and [r["id"] for r in listed()] == [2, 1, 5, 3] and has_id(out, 5)
case("delete removes one; ids are never reused", t_delete)
def bad(*args):
    def f():
        before = open(os.path.join(work, "data.json")).read()
        c, out, err = run(*args)
        return c == 2 and err.strip() != "" and "Traceback" not in err and open(os.path.join(work, "data.json")).read() == before
    return f
case("bad amount: letters", bad("add", "abc", "food"))
case("a bad amount prints exactly one line", lambda: len(run("add", "12.345", "food")[2].strip().splitlines()) == 1)
case("bad amount: three decimals", bad("add", "1.234", "food"))
case("bad amount: zero", bad("add", "0", "food"))
case("bad amount: negative", bad("add", "-5", "food"))
case("bad amount: nan", bad("add", "nan", "food"))
case("bad date", bad("add", "5", "food", "--date", "2026-02-30"))
case("empty category", bad("add", "5", "   "))
case("bad month", bad("list", "--month", "2026-13"))
case("unknown id", bad("delete", "999"))
case("id that is not a number", bad("delete", "one"))
case("unknown command", bad("frobnicate"))
case("missing argument", bad("add", "5"))
case("bad --by value", bad("totals", "--by", "weekday"))
def t_corrupt():
    path = os.path.join(work, "corrupt.json"); open(path, "w").write("{not json")
    c, out, err = run("add", "5", "food", file="corrupt.json")
    c2, _, err2 = run("list", file="corrupt.json")
    return c == 1 and c2 == 1 and "Traceback" not in err + err2 and err.strip() != "" and open(path).read() == "{not json"
case("a corrupt data file is reported (status 1) and not overwritten", t_corrupt)
def t_default_file():
    d = tempfile.mkdtemp(prefix="exp-cwd-")
    c, _, _ = run("add", "2", "x", file=None, cwd=d)
    return c == 0 and os.path.exists(os.path.join(d, "expenses.json"))
case("the default file is expenses.json in the current folder", t_default_file)
def t_persist():
    return json.load(open(os.path.join(work, "data.json"))) is not None and len(listed()) == 4
case("the data file is valid JSON and persists", t_persist)
case("no temporary files are left beside the data", lambda: sorted(os.listdir(work)) == sorted(f for f in os.listdir(work) if f.endswith(".json") or f.endswith(".csv")))
def t_empty():
    c, out, _ = run("list", "--json", file="none.json")
    c2, out2, _ = run("totals", "--by", "month", "--json", file="none.json")
    return c == 0 and json.loads(out) == [] and c2 == 0 and json.loads(out2) == {} and not os.path.exists(os.path.join(work, "none.json"))
case("no data yet: empty list and totals, and no file is created", t_empty)
case("tests are included", lambda: any("test" in os.path.basename(f).lower() for f in glob.glob("**/*.py", recursive=True) if "hidden" not in f and ".venv" not in f))

print(f"SCORE {sum(results)}/{len(results)}")
sys.exit(0 if all(results) else 1)
