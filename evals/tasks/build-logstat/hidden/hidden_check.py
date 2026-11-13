"""Hidden battery for logstat.py: only what the prompt states. Prints SCORE passed/total."""
import json, math, subprocess, sys, time

def run(stdin, *args, timeout=30):
    p = subprocess.run([sys.executable, "logstat.py", *args], input=stdin, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout, p.stderr

def js(stdin, *args):
    code, out, err = run(stdin, "--json", *args)
    return code, json.loads(out), err

def line(**k): return json.dumps(k)
results = []
def case(name, fn):
    try:
        ok = bool(fn())
    except Exception as e:  # a crash of the tool or unusable output is a failed case
        ok = False; name += f" [{type(e).__name__}: {str(e)[:80]}]"
    results.append(ok); print(("PASS " if ok else "FAIL ") + name)

def approx(a, b): return a is not None and abs(a - b) < 1e-3

basic = "\n".join([
    line(ts="t", level="INFO", service="api", msg="m", latency_ms=10),
    line(ts="t", level="ERROR", service="api", msg="m", latency_ms=30),
    line(ts="t", level="INFO", service="api", msg="m", latency_ms=20),
    line(ts="t", level="INFO", service="db", msg="m", latency_ms=5),
]) + "\n"
def t_basic():
    c, d, _ = js(basic); s = d["services"]
    return c == 0 and s["api"]["count"] == 3 and s["api"]["errors"] == 1 and approx(s["api"]["error_rate"], 1/3) and s["db"]["count"] == 1 and s["db"]["errors"] == 0 and d["skipped"] == 0
case("counts and error rate by service", t_basic)
case("p95 nearest rank, small", lambda: approx(js(basic)[1]["services"]["api"]["p95_ms"], 30))
hundred = "\n".join(line(level="INFO", service="s", latency_ms=i) for i in range(1, 101))
case("p95 nearest rank, 100 values", lambda: approx(js(hundred)[1]["services"]["s"]["p95_ms"], 95))
twenty = "\n".join(line(level="INFO", service="s", latency_ms=i * 10) for i in range(1, 21))
case("p95 nearest rank, 20 values", lambda: approx(js(twenty)[1]["services"]["s"]["p95_ms"], 190))
case("p95 single value", lambda: approx(js(line(level="INFO", service="s", latency_ms=7.5))[1]["services"]["s"]["p95_ms"], 7.5))
def t_empty():
    c, d, _ = js("")
    return c == 0 and d["services"] == {} and d["skipped"] == 0
case("empty input", t_empty)
case("empty input, table mode exits 0", lambda: run("")[0] == 0)
def t_broken():
    c, d, _ = js("not json\n{broken\n" + basic + "[1,2]\n\"str\"\n42\nnull\n")
    return c == 0 and d["skipped"] == 6 and d["services"]["api"]["count"] == 3
case("broken and non-object lines are skipped and counted", t_broken)
def t_blank():
    c, d, _ = js("\n   \n\t\n" + basic + "\n\n")
    return d["skipped"] == 0 and d["services"]["api"]["count"] == 3
case("blank lines are ignored, not counted", t_blank)
def t_missing_service():
    c, d, _ = js("\n".join([line(level="INFO", latency_ms=1), line(level="ERROR", service="", latency_ms=2), line(level="INFO", service=7), line(level="INFO", service=None)]))
    u = d["services"]["unknown"]
    return u["count"] == 4 and u["errors"] == 1
case("missing, empty or non-string service is 'unknown'", t_missing_service)
def t_missing_latency():
    c, d, _ = js("\n".join([line(level="INFO", service="a"), line(level="INFO", service="a", latency_ms="fast"), line(level="INFO", service="a", latency_ms=None), line(level="INFO", service="a", latency_ms=40)]))
    a = d["services"]["a"]
    return a["count"] == 4 and approx(a["p95_ms"], 40)
case("lines without a numeric latency count, but not towards p95", t_missing_latency)
case("no latencies at all gives null p95", lambda: js(line(level="INFO", service="a"))[1]["services"]["a"]["p95_ms"] is None)
def t_levels():
    c, d, _ = js("\n".join([line(level="fatal", service="a"), line(level="Error", service="a"), line(level="warn", service="a"), line(level="info", service="a")]))
    return d["services"]["a"]["errors"] == 2 and d["services"]["a"]["count"] == 4
case("ERROR and FATAL are errors, any case", t_levels)
mixed = "\n".join(line(level=l, service="a", latency_ms=1) for l in ["DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL", "debug", "bogus"]) + "\n" + json.dumps({"service": "a"})
def t_min(level, count):
    def f():
        c, d, _ = js(mixed, "--min-level", level)
        got = d["services"].get("a", {"count": 0})["count"]
        return c == 0 and got == count
    return f
case("--min-level DEBUG keeps everything", t_min("DEBUG", 9))
case("--min-level INFO (unknown and missing levels are INFO)", t_min("INFO", 7))
case("--min-level WARN (WARNING is WARN)", t_min("WARN", 4))
case("--min-level error, lower case", t_min("error", 2))
case("--min-level FATAL", t_min("FATAL", 1))
def t_min_all_out():
    c, d, _ = js(line(level="INFO", service="quiet"), "--min-level", "ERROR")
    return c == 0 and "quiet" not in d["services"]
case("a service with no counted lines is left out", t_min_all_out)
def t_bad_level():
    c, out, err = run(basic, "--min-level", "LOUD")
    return c == 2 and err.strip() != "" and "Traceback" not in err
case("unknown --min-level: message on stderr, status 2", t_bad_level)
def t_odd():
    huge = "1" + "0" * 400
    odd = "\n".join([
        '{"level":"INFO","service":"a","latency_ms":' + huge + '}',
        '{"level":"INFO","service":"a","latency_ms":1e999}',
        line(level={"x": 1}, service="a", latency_ms=[1]),
        line(level="INFO", service="a", latency_ms=True),
        line(level="INFO", service="a", latency_ms=-5),
        "{" * 3000,
        '{"level":"INFO","service":"a","latency_ms":12,"nest":' + "[" * 200 + "]" * 200 + "}",
    ])
    c, out, err = run(odd, "--json")
    d = json.loads(out)
    return c == 0 and "Traceback" not in err and d["services"]["a"]["count"] >= 5
case("odd but valid JSON values do not crash it", t_odd)
def t_table():
    c, out, err = run(basic)
    low = out.lower()
    return c == 0 and "api" in out and "db" in out and "Traceback" not in err and ("33" in out) and ("30" in out)
case("the table names each service, its error rate and p95", t_table)
def t_large():
    big = "\n".join(line(level="ERROR" if i % 10 == 0 else "INFO", service=f"s{i % 7}", latency_ms=i % 500) for i in range(200_000))
    t = time.time(); c, d, _ = js(big); secs = time.time() - t
    return c == 0 and sum(v["count"] for v in d["services"].values()) == 200_000 and secs < 8
case("200,000 lines in a few seconds", t_large)
# Removed 2026-11-13: "output piped into head does not print a traceback" (the prompt does not ask for it).
def t_unicode():
    c, d, _ = js(line(level="INFO", service="café-日本", latency_ms=3) + "\n")
    return d["services"]["café-日本"]["count"] == 1
case("non-ASCII service names", t_unicode)
import glob, os
case("a test script is included", lambda: any(("test" in os.path.basename(f).lower()) for f in glob.glob("**/*", recursive=True) if os.path.isfile(f) and "hidden" not in f and ".venv" not in f))

print(f"SCORE {sum(results)}/{len(results)}")
sys.exit(0 if all(results) else 1)
