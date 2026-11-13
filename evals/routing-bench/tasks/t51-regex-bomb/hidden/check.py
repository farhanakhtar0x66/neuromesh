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

pat = (read("regex.txt") or "").strip()
item("regex.txt has one regex", bool(pat) and "\n" not in pat)
def ok(s):
    if not pat:
        return 3
    r = subprocess.run(["perl", "-e", 'my $p=$ENV{P}; $p =~ s{^/(.*)/[a-z]*$}{$1}s; my $r = eval { $ENV{S} =~ /$p/ ? 1 : 0 }; exit(defined $r ? ($r ? 0 : 1) : 2)'], env={**os.environ, "P": pat, "S": s}, capture_output=True, text=True, timeout=20)
    return r.returncode
for s in ["[({()})]", "(1+2)*[3-{4/5}]", "a+b", "{[()]}()", "f(x)[i]{k}", ""]:
    item(f"accepts {s!r}", ok(s) == 0)
for s in ["[(])", "(", "())", "{[}]", "(1+2]", "((a)"]:
    item(f"rejects {s!r}", ok(s) == 1)

done()
