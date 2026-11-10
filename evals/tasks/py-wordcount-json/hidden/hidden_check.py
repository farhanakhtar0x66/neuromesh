import json, os, subprocess, sys, tempfile

with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
    f.write("alpha beta\ngamma\n")
    path = f.name
try:
    out = subprocess.run([sys.executable, "wordcount.py", "--json", path], capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    assert data == {"lines": 2, "words": 3, "chars": 17}, data
    plain = subprocess.run([sys.executable, "wordcount.py", path], capture_output=True, text=True, check=True).stdout
    assert plain.strip() == "2 lines, 3 words, 17 chars", plain
finally:
    os.unlink(path)
print("hidden check passed")
