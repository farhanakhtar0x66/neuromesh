import json, os, subprocess, sys, tempfile

from kvstore import KVStore

d = tempfile.mkdtemp()
path = os.path.join(d, "db.json")
s = KVStore(path)
assert s.get("a") is None and s.get("a", 5) == 5
s.set("b", "2")
s.set("a", "1")
assert s.keys() == ["a", "b"]
assert json.load(open(path)) == {"a": "1", "b": "2"}
assert KVStore(path).get("a") == "1"
assert s.delete("a") is True and s.delete("a") is False
assert KVStore(path).keys() == ["b"]
assert [f for f in os.listdir(d)] == ["db.json"], os.listdir(d)

def cli(*args):
    return subprocess.run([sys.executable, "kvstore.py", os.path.join(d, "cli.json"), *args], capture_output=True, text=True)

assert cli("set", "name", "ana").returncode == 0
r = cli("get", "name"); assert r.returncode == 0 and r.stdout.strip() == "ana", r
r = cli("get", "nope"); assert r.returncode == 1 and r.stderr.strip() == "not found: nope", r
cli("set", "city", "oslo")
r = cli("keys"); assert r.stdout.split() == ["city", "name"], r
assert cli("delete", "city").returncode == 0
assert cli("delete", "city").returncode == 1
assert cli("frobnicate").returncode == 2
assert cli().returncode == 2 or subprocess.run([sys.executable, "kvstore.py"], capture_output=True).returncode == 2
print("hidden check passed")
