"""Hidden check for 3.1: the hook is RUN, not read.

useSearch.js is loaded with a small stand-in for React's hooks
(hidden/react-shim.js), a fake clock and a scripted API, and put through the
bug from the prompt: type 'react' slowly, change to 're' fast, and let the old
slow answer for 'react' arrive last. Then the leak cases: unmounting
mid-request, unmounting with the debounce timer pending, a burst of keystrokes,
hundreds of rapid changes. The hook is called as useSearch(query, options),
useSearch({query, ...options}), useSearch(query) or with the fetcher as a
positional argument (useSearch(query, fetcher[, delay | options])); the API is reached through
the global fetch or through any of the usual injected-function option names,
each handed an AbortSignal.
"""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)

exists = os.path.isfile("useSearch.js")
item("useSearch.js exists", exists)
out = {"error": "no useSearch.js", "results": {}}
if exists:
    work = tempfile.mkdtemp()
    try:
        for name in os.listdir("."):
            if name in ("hidden", "node_modules") or name.startswith("."):
                continue
            (shutil.copytree if os.path.isdir(name) else shutil.copy)(name, os.path.join(work, name))
        os.makedirs(os.path.join(work, "node_modules", "react"))
        shutil.copy(os.path.join(HERE, "react-shim.js"), os.path.join(work, "node_modules", "react", "index.js"))
        with open(os.path.join(work, "node_modules", "react", "package.json"), "w") as f:
            json.dump({"name": "react", "version": "18.3.1", "type": "module", "main": "index.js", "exports": "./index.js"}, f)
        if not os.path.exists(os.path.join(work, "package.json")):
            with open(os.path.join(work, "package.json"), "w") as f:
                json.dump({"type": "module"}, f)
        r = subprocess.run(["node", os.path.join(HERE, "run_hook.mjs"), work, os.path.join(work, "node_modules", "react", "index.js")],
                           capture_output=True, text=True, timeout=90, cwd=work)
        last = [l for l in r.stdout.splitlines() if l.startswith("RESULT ")]
        out = json.loads(last[-1][7:]) if last else {"error": (r.stderr or "no output")[-300:], "results": {}}
    except subprocess.TimeoutExpired:
        out = {"error": "timeout (the hook or a loop never settled)", "results": {}}
    except FileNotFoundError:
        out = {"error": "node not found", "results": {}}
    finally:
        shutil.rmtree(work, ignore_errors=True)
if out.get("error"):
    print("note:", out["error"])
r = out.get("results", {})
item("the hook loads and runs as a component", exists and "newest_shown" in r)
item("the newest query's results are shown", r.get("newest_shown"))
item("a stale slow response does not overwrite newer results", r.get("stale_dropped") and r.get("newest_shown"))
item("the request is given an AbortSignal", r.get("signal_given"))
item("the earlier request is aborted when the query changes", r.get("earlier_aborted"))
item("an aborted request is not shown as an error", r.get("no_abort_error_shown") and r.get("newest_shown"))
item("unmounting aborts the request in flight", r.get("unmount_aborts_inflight"))
item("unmounting cancels a pending debounce timer", r.get("unmount_cancels_debounce"))
item("no timer is left running after unmount", r.get("no_timers_after_unmount"))
item("no state is set after unmount", r.get("no_state_after_unmount") and r.get("unmount_aborts_inflight") is not None)
item("a burst of keystrokes sends one request (debounce)", r.get("burst_one_request"))
item("re-rendering with the same query sends no new request", r.get("same_query_no_refetch") and r.get("burst_one_request"))
item("hundreds of rapid changes then unmount leave nothing running or in flight", r.get("nothing_left_running"))
done()
