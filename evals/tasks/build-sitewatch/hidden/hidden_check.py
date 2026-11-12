"""Hidden battery for sitewatch.py, against local sites this script controls. Prints SCORE passed/total."""
import glob, http.server, json, os, shutil, signal, socketserver, subprocess, sys, tempfile, threading, time

work = tempfile.mkdtemp(prefix="sw-")
site = os.path.join(work, "site"); os.makedirs(site)
PAGES = {
    "shop.html": '<html><head><style>p{color:red}</style><script>var x="12:00:01";</script></head><body><div id="shop"><p class="price">£20.00</p><p>In stock</p></div></body></html>',
    "news.html": '<html><body><div id="news"><h2>News</h2><p>Version 1.0 released</p><p>More soon</p></div></body></html>',
}
def put(name, html): open(os.path.join(site, name), "w").write(html)
for k, v in PAGES.items(): put(k, v)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=site, **k)
    def log_message(s, *a): pass
    def do_GET(s):
        if s.path == "/error": s.send_response(500); s.end_headers(); s.wfile.write(b"boom"); return
        if s.path == "/hang": time.sleep(30); return
        super().do_GET()
class T(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True
srv = T(("127.0.0.1", 0), H); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
b = f"http://127.0.0.1:{port}"
cfg = os.path.join(work, "c.json"); db = os.path.join(work, "state.db")
json.dump({"sites": [
    {"name": "shop", "url": f"{b}/shop.html", "pattern": '<p class="price">([^<]+)</p>', "timeout": 5},
    {"name": "news", "url": f"{b}/news.html", "timeout": 5},
    {"name": "refused", "url": "http://127.0.0.1:9/", "timeout": 3},
    {"name": "error500", "url": f"{b}/error", "timeout": 3},
    {"name": "hang", "url": f"{b}/hang", "timeout": 3},
    {"name": "nomatch", "url": f"{b}/news.html", "pattern": "price: (\\d+)", "timeout": 3},
]}, open(cfg, "w"))

CLEAN = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
def sw(*args, env=None, timeout=90, config=cfg):
    t = time.time()
    p = subprocess.run([sys.executable, "sitewatch.py", *args, "--config", config, "--db", db], capture_output=True, text=True, timeout=timeout, env={**CLEAN, **(env or {})})
    return p.returncode, p.stdout, p.stderr, time.time() - t
def lines(out): return [l for l in out.splitlines() if l.strip()]
def line_for(out, name): return next((l for l in lines(out) if l.split()[1:2] and l.split()[1].rstrip(":") == name), "")

results = []
def case(name, fn):
    try: ok = bool(fn())
    except Exception as e: ok = False; name += f" [{type(e).__name__}: {str(e)[:80]}]"
    results.append(ok); print(("PASS " if ok else "FAIL ") + name)

c1, o1, e1, secs1 = sw("check")
case("first check exits 0 with sites down, no traceback", lambda: c1 == 0 and "Traceback" not in o1 + e1)
case("one line per site, in config order", lambda: [l.split()[1].rstrip(":") for l in lines(o1)] == ["shop", "news", "refused", "error500", "hang", "nomatch"])
case("first sight is NEW", lambda: line_for(o1, "shop").startswith("NEW ") and line_for(o1, "news").startswith("NEW "))
case("refused, HTTP 500, hanging and pattern-not-found sites are DOWN with a reason", lambda: all(line_for(o1, n).startswith(f"DOWN {n}:") and len(line_for(o1, n).split(":", 1)[1].strip()) > 0 for n in ["refused", "error500", "hang", "nomatch"]))
case("a hanging site is cut off at its timeout (whole check under 20 s)", lambda: secs1 < 20)

c2, o2, e2, _ = sw("check")
case("no change is UNCHANGED", lambda: line_for(o2, "shop").startswith("UNCHANGED") and line_for(o2, "news").startswith("UNCHANGED"))

put("shop.html", PAGES["shop.html"].replace("£20.00", "£17.50").replace("12:00:01", "12:00:09"))
put("news.html", PAGES["news.html"].replace("Version 1.0", "Version 1.1"))
c3, o3, e3, _ = sw("check")
case("a price change is CHANGED with old and new", lambda: line_for(o3, "shop").startswith("CHANGED shop:") and "£20.00" in line_for(o3, "shop") and "£17.50" in line_for(o3, "shop") and "->" in line_for(o3, "shop"))
case("a text change is CHANGED", lambda: line_for(o3, "news").startswith("CHANGED news:"))

put("shop.html", PAGES["shop.html"].replace("£20.00", "£17.50").replace("12:00:01", "12:44:44").replace("In stock", "Few left"))
c4, o4, _, _ = sw("check")
case("a change outside the pattern is not a change", lambda: line_for(o4, "shop").startswith("UNCHANGED"))

ch, oh, eh, _ = sw("history", "shop")
case("history lists versions oldest first, numbered", lambda: ch == 0 and len(lines(oh)) == 2 and "£20.00" in lines(oh)[0] and "£17.50" in lines(oh)[1] and lines(oh)[0].split()[0].strip(".:#)") == "1" and lines(oh)[1].split()[0].strip(".:#)") == "2")
chn, ohn, _, _ = sw("history", "news")
case("the watched text has no tags, scripts or styles", lambda: "<" not in ohn and "Version 1.0 released" in ohn and "Version 1.1 released" in ohn)
cu, ou, eu, _ = sw("history", "nosuchsite")
case("history of an unknown name: stderr message, status 2", lambda: cu == 2 and eu.strip() != "" and "Traceback" not in eu)
cd_, od, ed, _ = sw("diff", "news")
case("diff shows removed and added lines", lambda: cd_ == 0 and any(l.startswith("-") and "1.0" in l for l in od.splitlines()) and any(l.startswith("+") and "1.1" in l for l in od.splitlines()))
c5, o5, e5, _ = sw("diff", "refused")
case("diff with fewer than two versions says so, status 0", lambda: c5 == 0 and (o5 + e5).strip() != "" and "Traceback" not in o5 + e5)

# The internet is gone: every site refuses.
off = os.path.join(work, "off.json")
json.dump({"sites": [{"name": "shop", "url": "http://127.0.0.1:9/shop.html", "pattern": '<p class="price">([^<]+)</p>', "timeout": 2}, {"name": "news", "url": "http://no-such-host.invalid/news", "timeout": 2}]}, open(off, "w"))
c6, o6, e6, _ = sw("check", config=off)
case("offline: every site DOWN, status 0, no traceback", lambda: c6 == 0 and "Traceback" not in o6 + e6 and all(l.startswith("DOWN ") for l in lines(o6)) and len(lines(o6)) == 2)
c7, o7, _, _ = sw("history", "shop")
case("offline: the saved versions are still there", lambda: len(lines(o7)) == 2 and "£17.50" in o7)

for bad, label in [(os.path.join(work, "missing.json"), "missing"), (cfg + ".bad", "unreadable")]:
    if label == "unreadable": open(bad, "w").write("{nope")
    cb, ob, eb, _ = sw("check", config=bad)
    case(f"a {label} config: stderr message, status 2", lambda cb=cb, eb=eb: cb == 2 and eb.strip() != "" and "Traceback" not in eb)

# run mode: survives a round with sites down, picks up a change, stops on Ctrl-C.
quick = os.path.join(work, "quick.json")
json.dump({"sites": [{"name": "shop", "url": f"{b}/shop.html", "pattern": '<p class="price">([^<]+)</p>', "timeout": 3}, {"name": "refused", "url": "http://127.0.0.1:9/", "timeout": 2}]}, open(quick, "w"))
p = subprocess.Popen([sys.executable, "-u", "sitewatch.py", "run", "--interval", "2", "--config", quick, "--db", db], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=CLEAN)
time.sleep(3.5); put("shop.html", PAGES["shop.html"].replace("£20.00", "£15.00")); time.sleep(9)
alive = p.poll() is None
p.send_signal(signal.SIGINT)
t = time.time()
try: out, _ = p.communicate(timeout=10)
except subprocess.TimeoutExpired: p.kill(); out, _ = p.communicate()
stopped = time.time() - t
case("run keeps going through rounds with a site down", lambda: alive and sum(1 for l in out.splitlines() if l.startswith("DOWN refused")) >= 2)
case("run reports a change on a later round", lambda: any(l.startswith("CHANGED shop:") and "£15.00" in l for l in out.splitlines()))
case("Ctrl-C stops run promptly, status 0 or 130, no traceback", lambda: p.returncode in (0, 130, -2) and stopped < 6 and "Traceback" not in out)
case("tests are included", lambda: any("test" in os.path.basename(f).lower() for f in glob.glob("**/*.py", recursive=True) if "hidden" not in f and ".venv" not in f))

print(f"SCORE {sum(results)}/{len(results)}")
srv.shutdown(); shutil.rmtree(work, ignore_errors=True)
sys.exit(0 if all(results) else 1)
