#!/usr/bin/env python3
"""Builder's tool for hd-rust-regex-linear (not part of the check; no model is called).

Makes hidden/tests/tests/hd_regex_data/cases.in: (pattern, text) cases whose expected results are what Python's `re`
returns (re.ASCII, `$` written as `\\Z`; byte offsets computed from the character offsets), for is_match, find, captures
and find_iter. Random patterns come from a small grammar (the repeated bodies never match the empty string, so the
capture rules of the README decide the result), plus curated patterns, plus a few where a repeated body can match the
empty string (those are compared on the overall match and find_iter only, never on captures), plus non-ASCII texts.

Run from the repository root:  python3 evals/hard-tasks/hd-rust-regex-linear/hidden/make-fixtures.py
Seeded: the output is identical on every run.
"""
import random, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "tests" / "tests" / "hd_regex_data" / "cases.in"
rng = random.Random(20261117)

# ---- syntax tree: tuples. ('lit', c) ('any',) ('cls', neg, [items]) ('esc', r'\d') ('start',) ('end',)
# ('grp', capturing, node) ('cat', [nodes]) ('alt', [nodes]) ('rep', node, lo, hi|None, greedy)

def nullable(n):
    k = n[0]
    if k in ("lit", "any", "cls", "esc"):
        return False
    if k in ("start", "end"):
        return True
    if k == "grp":
        return nullable(n[2])
    if k == "cat":
        return all(nullable(x) for x in n[1])
    if k == "alt":
        return any(nullable(x) for x in n[1])
    if k == "rep":
        return n[2] == 0 or nullable(n[1])
    raise ValueError(k)

def has_empty_body_rep(n):
    k = n[0]
    if k == "rep":
        return nullable(n[1]) or has_empty_body_rep(n[1])
    if k == "grp":
        return has_empty_body_rep(n[2])
    if k in ("cat", "alt"):
        return any(has_empty_body_rep(x) for x in n[1])
    return False

def render(n, py):
    k = n[0]
    if k == "lit":
        c = n[1]
        return "\\" + c if c in r"\.[](){}*+?|^$-" else c
    if k == "any":
        return "."
    if k == "cls":
        return "[" + ("^" if n[1] else "") + "".join(n[2]) + "]"
    if k == "esc":
        return n[1]
    if k == "start":
        return "^"
    if k == "end":
        return r"\Z" if py else "$"
    if k == "grp":
        return ("(" if n[1] else "(?:") + render(n[2], py) + ")"
    if k == "cat":
        return "".join(render(x, py) if x[0] != "alt" else "(?:" + render(x, py) + ")" for x in n[1])
    if k == "alt":
        return "|".join(render(x, py) for x in n[1])
    if k == "rep":
        body = n[1]
        r = render(body, py)
        if body[0] in ("cat", "alt", "rep", "start", "end"):
            r = "(?:" + r + ")"
        lo, hi = n[2], n[3]
        q = "*" if (lo, hi) == (0, None) else "+" if (lo, hi) == (1, None) else "?" if (lo, hi) == (0, 1) else \
            "{%d}" % lo if lo == hi else "{%d,}" % lo if hi is None else "{%d,%d}" % (lo, hi)
        return r + q + ("" if n[4] else "?")
    raise ValueError(k)

ALPHA = "abc"
CLASS_ITEMS = ["a", "b", "c", "a-b", "b-c", "a-c", r"\d", r"\w", " ", "x-z", "_"]
ESCAPES = [r"\d", r"\w", r"\s", r"\D", r"\W", r"\S"]

def gen_atom(depth, allow_empty_rep):
    r = rng.random()
    if r < 0.45:
        return ("lit", rng.choice(ALPHA))
    if r < 0.52:
        return ("any",)
    if r < 0.62:
        return ("cls", rng.random() < 0.3, rng.sample(CLASS_ITEMS, rng.randint(1, 3)))
    if r < 0.68:
        return ("esc", rng.choice(ESCAPES))
    if r < 0.72:
        return ("start",) if rng.random() < 0.5 else ("end",)
    if depth <= 0:
        return ("lit", rng.choice(ALPHA))
    return ("grp", rng.random() < 0.7, gen_alt(depth - 1, allow_empty_rep))

def gen_piece(depth, allow_empty_rep):
    atom = gen_atom(depth, allow_empty_rep)
    if atom[0] in ("start", "end") or rng.random() > 0.45:
        return atom
    lo, hi = rng.choice([(0, None), (1, None), (0, 1), (2, 2), (1, 3), (0, 2), (2, None), (3, 3), (1, 2)])
    node = ("rep", atom, lo, hi, rng.random() < 0.7)
    if not allow_empty_rep and nullable(atom):
        return atom
    return node

def gen_cat(depth, allow_empty_rep):
    items = [gen_piece(depth, allow_empty_rep) for _ in range(rng.randint(1, 4))]
    return items[0] if len(items) == 1 else ("cat", items)

def gen_alt(depth, allow_empty_rep):
    branches = [gen_cat(depth, allow_empty_rep) for _ in range(rng.choice([1, 1, 1, 2, 2, 3]))]
    if rng.random() < 0.05:
        branches.append(("cat", []))
    return branches[0] if len(branches) == 1 else ("alt", branches)

TEXT_CHARS = "aaaabbbccd 1_\n"

def gen_text():
    return "".join(rng.choice(TEXT_CHARS) for _ in range(rng.randint(0, 14)))

# ---- running Python's re

def byte_off(text, i):
    return len(text[:i].encode())

def expected(pattern_py, text):
    prog = re.compile(pattern_py, re.ASCII)
    m = prog.search(text)
    if m is None:
        find, caps = None, None
    else:
        find = (byte_off(text, m.start()), byte_off(text, m.end()))
        caps = []
        for g in range(prog.groups + 1):
            s, e = m.span(g)
            caps.append(None if s < 0 else (byte_off(text, s), byte_off(text, e)))
    iters = [(byte_off(text, x.start()), byte_off(text, x.end())) for x in prog.finditer(text)]
    return find, caps, iters

def rs_str(s):
    out = []
    for ch in s:
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif ord(ch) < 32:
            out.append("\\u{%x}" % ord(ch))
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'

def rs_span(s):
    return "None" if s is None else "Some((%d, %d))" % s

lines, count = [], [0]

def emit(category, pattern_rs, pattern_py, text, check_caps):
    find, caps, iters = expected(pattern_py, text)
    count[0] += 1
    name = "hd_re_c%03d_%s" % (count[0], category)
    caps_rs = "None" if (caps is None or not check_caps) else "Some(&[" + ", ".join(rs_span(c) for c in caps) + "])"
    lines.append("re_case!(%s, %s, %s, %s, %s, &[%s]);\n" % (
        name, rs_str(pattern_rs), rs_str(text), rs_span(find), caps_rs, ", ".join("(%d, %d)" % i for i in iters)))

def add_ast(category, ast, text, check_caps=True):
    emit(category, render(ast, False), render(ast, True), text, check_caps)

# ---- random cases
seen = set()
made = 0
while made < 190:
    ast = gen_alt(3, False)
    if has_empty_body_rep(ast):
        continue
    text = gen_text()
    key = (render(ast, False), text)
    if key in seen or len(key[0]) > 60:
        continue
    seen.add(key)
    add_ast("random", ast, text)
    made += 1

# ---- curated patterns: (pattern, texts); `$` is spelled as in the README, converted for Python
def curated(category, items, check_caps=True):
    for pattern, texts in items:
        py = re.sub(r"(?<!\\)\$", r"\\Z", pattern)
        for text in texts:
            emit(category, pattern, py, text, check_caps)

curated("curated", [
    (r"a+b", ["xaab", "b", "aaaa", "ab ab"]),
    (r"a|ab|abc", ["abc", "xabc", "bc"]),
    (r"(foo|foobar)baz", ["foobarbaz", "foobaz"]),
    (r"colou?r", ["my color", "colour!", "colouur"]),
    (r"<.+?>", ["a <b> c <d>", "<>", "x"]),
    (r"<.+>", ["a <b> c <d>"]),
    (r"(\d{4})-(\d{2})-(\d{2})", ["on 2026-11-17 ok", "2026-1-1", "12026-11-170"]),
    (r"^(?:[01]\d|2[0-3]):[0-5]\d$", ["23:59", "24:00", "07:5", "x07:50"]),
    (r"(\w+)@(\w+)\.com", ["mail ann@home.com now", "a@b.org", "x_y@z9.com.au"]),
    (r'"([^"]*)"', ['say "hi" and "bye"', '"unclosed', '""']),
    (r"(a+)(b+)", ["aabbb", "bbaa", "xabx"]),
    (r"(a*?)(a*)", ["aaa", "", "b"]),
    (r"(a+?)(a*)", ["aaa", "a"]),
    (r"(a|b)*c", ["ababc", "abab", "c"]),
    (r"(?:(a)|b)*", ["ab", "ba", "bbb"]),
    (r"(a|(b))+", ["ba", "ab", "bb"]),
    (r"^$", ["", "a"]),
    (r"^a*$", ["aaaa", "aab", ""]),
    (r"x{2,3}", ["x", "xx", "xxxx", "xxxxxxx"]),
    (r"x{2,3}?", ["xxxx"]),
    (r"(ab){2}", ["abababab", "ab"]),
    (r"a{0}b", ["b", "ab"]),
    (r"[a-c]+[^a-c]", ["abcd", "abc", "ccx"]),
    (r"[\d.-]+", ["v1.2-3", "...", "x"]),
    (r"[\]\\]+", ["a]\\]b"]),
    (r"\s+", ["a  \t b", "none", "\n"]),
    (r"\S+", ["  hi there"]),
    (r"\W+", ["ab, cd"]),
    (r"\D\d", ["ab1", "12", "a1b2"]),
    (r"a.c", ["abc", "a\nc", "ac"]),
    (r"a[^b]c", ["a\nc", "abc", "axc"]),
    (r"\.\*\+\?", ["a.*+?b"]),
    (r"a\tb\nc", ["a\tb\nc"]),
    (r"(a)(b)?(c)", ["abc", "ac", "xac"]),
    (r"((a)(b))+", ["abab"]),
    (r"(a)|(b)|(c)", ["c", "b", "xa"]),
    (r"()", ["a", ""]),
    (r"a|", ["a", "b", ""]),
    (r"|a", ["a", "b"]),
    (r"(?:)", ["ab"]),
    (r"a??b", ["ab", "b"]),
    (r"a*?", ["aaa"]),
    (r"a+?", ["aaa"]),
    (r"(a{1,2}){2}", ["aaaa", "aaa"]),
    (r"(?:a{2}){3}", ["aaaaaaa"]),
    (r"^(a|b)*$", ["abba", "abc"]),
    (r"(.)\.(.)", ["a.b.c"]),
    (r"\$\^", ["x$^y"]),
    (r"a$", ["aa", "a\n"]),
    (r"^a", ["ba", "a"]),
    (r"a^b", ["a^b", "ab"]),
    (r"a$b", ["ab", "a$b"]),
    (r"(\w+) (\w+)", ["hello world foo"]),
    (r"[a-zA-Z_][a-zA-Z0-9_]*", ["  fn_name2(", "9lives"]),
    (r"(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)", ["ip 192.168.1.255 ok", "999.1.1.1", "1.2.3"]),
    (r"(\d+)(?:\.(\d+))?", ["3.14", "42", "v7.x"]),
    (r"(?:a|b)+?c", ["abababc"]),
    (r"(a*)b|c", ["aab", "c", "aac"]),
])

# nullable repeated bodies: overall match and find_iter only
curated("nullable", [
    (r"(a*)*b", ["aaab", "b", "aaa", "xb"]),
    (r"(a|b*)*c", ["abbac", "c", "ab"]),
    (r"(a?)*", ["aaa", "", "b"]),
    (r"(a*)+", ["aaa", "b", ""]),
    (r"(a*)*", ["baac", ""]),
    (r"(?:a?)*b", ["aab", "b"]),
    (r"(a|aa)*c", ["aaaac", "aaaa"]),
    (r"(a*|b)*c", ["abc", "bbc"]),
    (r"x*", ["axxb", ""]),
    (r"a*", ["baac", "aaa", ""]),
    (r"b*", ["abba", "bbb"]),
    (r"(?:a*)*?b", ["aab"]),
    (r"(^)*a", ["a", "ba"]),
    (r"($)*", ["ab"]),
], check_caps=False)

curated("iter", [
    (r"", ["abc", ""]),
    (r"|a", ["aaa", "ba"]),
    (r"a|", ["aaa", "ba"]),
    (r"a*?", ["baab"]),
    (r"x*|y", ["yxxy"]),
    (r"(?:ab)*", ["ababcab", "c"]),
    (r"\d+", ["1 22 333", "no digits"]),
    (r"\w+", ["the quick  brown_fox 9"]),
    (r"[a-z]*", ["abc DEF ghi"]),
    (r"^a", ["aaa"]),
    (r"a$", ["aaa"]),
    (r"$", ["abc"]),
    (r"^", ["abc"]),
    (r"a{2}", ["aaaaa"]),
    (r"(a)(b)?", ["abaab"]),
])

curated("unicode", [
    (r"é+", ["café é éé"]),
    (r"[à-ü]+", ["naïve café résumé"]),
    (r"caf.", ["café au lait"]),
    (r"\w+", ["naïve café"]),
    (r".", ["éa"]),
    (r"(.)(.)", ["日本語"]),
    (r"[^a]+", ["日本a語"]),
    (r"\s", ["a b c"]),
    (r"..", ["a\U0001F600b"]),
    (r"(\W)", ["a€b"]),
], check_caps=True)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("// Generated by hidden/make-fixtures.py from Python's `re`. Do not edit.\n" + "".join(lines))
print(len(lines), "cases")
