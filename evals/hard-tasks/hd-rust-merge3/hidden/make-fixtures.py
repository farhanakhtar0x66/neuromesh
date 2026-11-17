#!/usr/bin/env python3
"""Builder's tool for hd-rust-merge3 (not part of the check; no model is called).

Makes hidden/tests/tests/hd_merge3_data/cases.in: three-way merge cases whose expected output is what
`git merge-file -p -L ours -L base -L theirs [--diff3]` prints, kept only where the task's rules decide the output.

How "the rules decide" is checked: every candidate is also run through the reference solution's binary; a (case, style)
pair is kept only if git and the reference print the same text and report the same number of conflicts. What gets
dropped is where git's extra heuristics (zealous conflict refinement, alnum simplification) go beyond the rules.

Run from the repository root:  python3 evals/hard-tasks/hd-rust-merge3/hidden/make-fixtures.py
Needs git and cargo. Seeded: the output is identical on every run.
"""
import os, random, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASK = HERE.parent
OUT = HERE / "tests" / "tests" / "hd_merge3_data" / "cases.in"
WORDS = ["alpha", "bravo", "cedar", "delta", "ember", "fjord", "gamma", "harbor", "iris", "juno", "karst", "lumen",
         "marsh", "nylon", "opal", "pylon", "quartz", "rivet", "sable", "tundra"]
rng = random.Random(20261117)
counter = [0]


def fresh(side, k):
    out = []
    for _ in range(k):
        counter[0] += 1
        out.append(f"{side} {counter[0]:03} {rng.choice(WORDS)}\n")
    return out


def base_lines(n):
    return [f"line {i + 1:02} {rng.choice(WORDS)}\n" for i in range(n)]


def apply(base, hunks):
    """hunks: list of (start, end, lines), non-touching, sorted."""
    out, pos = [], 0
    for s, e, new in hunks:
        out += base[pos:s] + new
        pos = e
    return out + base[pos:]


def valid(hunks, n):
    for s, e, new in hunks:
        if not (0 <= s <= e <= n) or (s == e and not new):
            return False
    # same side hunks need an unchanged line between them
    for (s1, e1, _), (s2, e2, _) in zip(hunks, hunks[1:]):
        if s2 <= e1:
            return False
    return True


def rand_hunks(side, n, count, avoid=()):
    for _ in range(40):
        hs, pos = [], rng.randint(0, 2)
        for _ in range(count):
            if pos > n:
                break
            s = pos + rng.randint(0, 3)
            if s > n:
                break
            kind = rng.choice(["rep", "rep", "ins", "del"])
            if kind == "ins":
                e, new = s, fresh(side, rng.randint(1, 3))
            elif kind == "del":
                e, new = min(n, s + rng.randint(1, 3)), []
                if e == s:
                    continue
            else:
                e, new = min(n, s + rng.randint(1, 3)), fresh(side, rng.randint(1, 3))
                if e == s:
                    continue
            hs.append((s, e, new))
            pos = e + 1
        if hs and valid(hs, n):
            return hs
    return []


def ok_with(hunks, extra, n):
    allh = sorted(hunks + [extra], key=lambda h: (h[0], h[1]))
    return valid(allh, n), allh


def gen(category):
    """Returns (base, ours, theirs) as lists of lines, or None when this draw is not usable."""
    n = rng.randint(12, 24)
    base = base_lines(n)
    if category == "empty-base":
        k = rng.choice(["both-same", "both-diff", "ours-only"])
        if k == "both-same":
            x = fresh("same", rng.randint(1, 3)); return [], x, list(x)
        if k == "both-diff":
            return [], fresh("ours", rng.randint(1, 3)), fresh("theirs", rng.randint(1, 3))
        return [], fresh("ours", rng.randint(1, 3)), []
    if category == "emptied":
        k = rng.choice(["ours-empties", "both-empty", "empties-vs-edit"])
        if k == "ours-empties":
            return base, [], apply(base, rand_hunks("theirs", n, 1))
        if k == "both-empty":
            return base, [], []
        return base, [], apply(base, [(2, 4, fresh("theirs", 1))])
    oh = rand_hunks("ours", n, rng.randint(1, 3))
    if not oh:
        return None
    th = []
    h = rng.choice(oh)
    s, e, new = h
    if category == "disjoint":
        th = rand_hunks("theirs", n, rng.randint(1, 3))
        # make every theirs hunk strictly separated from ours: at least one unchanged line between
        for ts, te, _ in th:
            for os_, oe, _ in oh:
                if not (te < os_ or oe < ts):
                    return None
    elif category == "one-sided":
        th = []
    elif category == "same-range":
        th = [(s, e, fresh("theirs", rng.randint(0 if e > s else 1, 3)))]
    elif category == "identical":
        th = [h] + [x for x in rand_hunks("theirs", n, 2) if x[0] > e + 1]
        # keep only theirs extras that do not touch any ours hunk
        th = [h] + [x for x in th[1:] if all(x[1] < o[0] or o[1] < x[0] for o in oh)]
        if not valid(sorted(th, key=lambda x: x[0]), n):
            return None
        th = sorted(th, key=lambda x: x[0])
    elif category == "overlap":
        if e - s < 1 and s + 2 > n:
            return None
        ts = max(0, s + rng.randint(-1, 1)); te = min(n, max(e, ts + 1) + rng.randint(0, 2))
        if te <= ts or (ts, te) == (s, e) or te == ts:
            return None
        th = [(ts, te, fresh("theirs", rng.randint(0, 2) or 1))]
    elif category == "touch-after":
        if e >= n:
            return None
        te = min(n, e + rng.randint(1, 2))
        th = [(e, te, fresh("theirs", rng.randint(0, 2)))]
        if th[0][0] == th[0][1] and not th[0][2]:
            return None
    elif category == "touch-before":
        if s == 0:
            return None
        ts = max(0, s - rng.randint(1, 2))
        th = [(ts, s, fresh("theirs", rng.randint(0, 2)))]
    elif category == "same-insert-point":
        p = rng.randint(0, n)
        oh = [(p, p, fresh("ours", rng.randint(1, 2)))]
        th = [(p, p, fresh("theirs", rng.randint(1, 2)))]
    elif category == "same-insert-identical":
        p = rng.randint(0, n)
        x = fresh("same", rng.randint(1, 2))
        oh = [(p, p, x)]
        th = [(p, p, list(x))]
    elif category == "insert-next-to-edit":
        p = rng.randint(1, n - 2)
        oh = [(p, p, fresh("ours", rng.randint(1, 2)))]
        th = [(p, p + rng.randint(1, 2), fresh("theirs", rng.randint(0, 2)))] if rng.random() < 0.5 else [(p - 1, p, fresh("theirs", rng.randint(0, 2)))]
        if th[0][1] <= th[0][0]:
            return None
    elif category == "delete-vs-edit":
        s = rng.randint(1, n - 5)
        oh = [(s, s + rng.randint(2, 4), [])]
        th = [(s + 1, s + 2, fresh("theirs", 1))]
    elif category == "chain":
        s = rng.randint(1, n - 8)
        oh = [(s, s + 1, fresh("ours", 1)), (s + 3, s + 4, fresh("ours", 1))]
        th = [(s + 1, s + 3, fresh("theirs", rng.randint(1, 2)))]
        if rng.random() < 0.5:
            th.append((s + 5, s + 6, fresh("theirs", 1)))
    elif category == "edges":
        k = rng.choice(["first", "last", "append", "prepend"])
        if k == "first":
            oh = [(0, 1, fresh("ours", 1))]; th = [(0, 2, fresh("theirs", 1))]
        elif k == "last":
            oh = [(n - 1, n, fresh("ours", 1))]; th = [(n - 1, n, fresh("theirs", 1))]
        elif k == "append":
            oh = [(n, n, fresh("ours", 2))]; th = [(n, n, fresh("theirs", 1))]
        else:
            oh = [(0, 0, fresh("ours", 1))]; th = [(0, 0, fresh("theirs", 2))]
    elif category == "many":
        n = rng.randint(24, 40)
        base = base_lines(n)
        oh, th = [], []
        pos = 1
        while pos + 3 < n:
            if rng.random() < 0.6:
                oh.append((pos, pos + 1, fresh("ours", 1)))
                if rng.random() < 0.7:
                    th.append((pos, pos + 1, fresh("theirs", 1)))
            else:
                (oh if rng.random() < 0.5 else th).append((pos, pos + 2, fresh("x", 1)))
            pos += 3
    else:
        raise SystemExit(category)
    oh = sorted(oh, key=lambda x: x[0]); th = sorted(th, key=lambda x: x[0])
    if not valid(oh, len(base)) or (th and not valid(th, len(base))):
        return None
    return base, apply(base, oh), apply(base, th)


PLAN = [("disjoint", 7), ("one-sided", 4), ("same-range", 7), ("identical", 6), ("overlap", 8), ("touch-after", 7),
        ("touch-before", 5), ("same-insert-point", 4), ("same-insert-identical", 3), ("insert-next-to-edit", 5),
        ("delete-vs-edit", 4), ("chain", 6), ("edges", 6), ("many", 5), ("empty-base", 4), ("emptied", 4)]
CANDIDATES_PER_CASE = 12


def git_merge(d, style):
    args = ["git", "merge-file", "-p", "-L", "ours", "-L", "base", "-L", "theirs"] + (["--diff3"] if style == "diff3" else [])
    r = subprocess.run(args + [d / "ours", d / "base", d / "theirs"], capture_output=True, text=True)
    if r.returncode < 0 or r.returncode > 127:
        raise SystemExit(f"git merge-file failed: {r.stderr}")
    return r.stdout, r.returncode


def ref_merge(binary, d, style):
    args = [str(binary), "merge"] + (["--diff3"] if style == "diff3" else []) + [str(d / "base"), str(d / "ours"), str(d / "theirs")]
    r = subprocess.run(args, capture_output=True, text=True)
    return r.stdout, r.returncode


def rs(text):
    assert '"#' not in text
    return f'r#"{text}"#'


def main():
    work = Path(tempfile.mkdtemp(prefix="hd-merge3-fixtures-"))
    try:
        ref = work / "ref"
        shutil.copytree(TASK / "seed", ref)
        shutil.copytree(TASK / "reference" / "files", ref, dirs_exist_ok=True)
        subprocess.run(["cargo", "build", "--offline", "--quiet"], cwd=ref, check=True)
        binary = ref / "target" / "debug" / "textdiff"
        lines_out, dropped, kept_pairs, idx = [], {}, 0, 0
        for category, quota in PLAN:
            made = 0
            attempts = 0
            while made < quota and attempts < 400:
                attempts += 1
                g = gen(category)
                if g is None:
                    continue
                base, ours, theirs = g
                d = work / f"case{idx}"
                d.mkdir(exist_ok=True)
                for name, content in (("base", base), ("ours", ours), ("theirs", theirs)):
                    (d / name).write_text("".join(content))
                if base == ours == theirs:
                    continue
                keep = []
                for style in ("merge", "diff3"):
                    want, wc = git_merge(d, style)
                    got, gc = ref_merge(binary, d, style)
                    if (want, wc) == (got, gc):
                        keep.append((style, want, wc))
                    else:
                        dropped[(category, style)] = dropped.get((category, style), 0) + 1
                        if os.environ.get("SHOW_DROPPED"):
                            print(f"--- dropped {category} {style}\nbase:{''.join(base)}\nours:{''.join(ours)}\ntheirs:{''.join(theirs)}\ngit ({wc}):\n{want}\nreference ({gc}):\n{got}")
                if not keep:
                    continue
                idx += 1
                made += 1
                for style, want, wc in keep:
                    kept_pairs += 1
                    name = f"hd_{style}_c{idx:03}_{category.replace('-', '_')}"
                    lines_out.append(f"{style}_case!({name}, {rs(''.join(base))}, {rs(''.join(ours))}, {rs(''.join(theirs))}, {rs(want)}, {wc});\n")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text("// Generated by hidden/make-fixtures.py from `git merge-file -p`. Do not edit.\n" + "".join(lines_out))
        print(f"{idx} cases, {kept_pairs} (case, style) pairs kept; dropped where git and the rules differ: {dropped}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
