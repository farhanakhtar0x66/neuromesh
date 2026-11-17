# hd-rust-regex-linear (advisor only, never shown to a model)

Rust, new program, group D. Seed: crate skeleton `linre` (315 lines: the public API in `src/lib.rs` with a
literal-only stand-in behind it, a 100-line README that is the whole specification, 10 visible tests of which 6 need
the engine and are `#[ignore]`d). The check (`cargo test --offline` on the seed) passes because the literal stand-in
passes the 4 active tests. Hidden: 453 tests (405 fail on the seed, 48 pass on it by accident, e.g. literal
patterns and error positions the stand-in happens to give).

## Traps

1. A backtracking matcher is correct and exponential: `(a*)*b`, `(a|aa)*c`, `(x+x+)+y`, `^(a+)+$`, `(a?){30}a{30}`
   on 30,000 characters (or 30 for the counted one) never finish. 14 timed tests; any backtracker fails ~7 of them
   and is probably killed by the grader's 600 s limit on the first one (the hidden tests do not run them with a
   watchdog; `cargo test` runs them in parallel threads and the slow ones hold the run until the grade timeout).
2. A plain Thompson NFA without priorities gets `is_match` and the span right for many patterns but not leftmost-first
   (`a|ab` on `ab`, lazy quantifiers, group spans): 78 tests fail if the Pike VM does not cut lower priorities at a
   match, 10 if lazy is treated as greedy, 13 if captures are not carried per thread.
3. Quadratic search: trying every start position separately is quadratic on `a*b` over a million `a`s and on
   `a*b|c` over 200,000 characters (two timed tests).
4. `find_iter` after an empty match: the README states Python's rule (an empty match right after a non-empty one is
   allowed; after an empty match at p the next search may not return an empty match at p). Without the rule an
   iterator that does not advance never ends; the tests use `take(len + 1)` so it fails instead of hanging (78 tests
   fail, none hangs).
5. Details a reader of the README must get: `$` is only the end of the text, `.` excludes only `\n`, `\w \d \s` are
   ASCII only, positions are bytes while matching is by chars, a group keeps its last span even if a later iteration
   of an enclosing repetition does not use it, the exact error position of 11 kinds of mistake (53 tests).
6. Recursion depth and stack: a 300-deep nested group, a 1000-long `(?:a?){1000}` chain, a 4,000-character literal
   pattern and 1,000,000-character texts.

## What is deliberately not tested (the README says so)

Repetitions whose body can match the empty string: captures inside them, and odd extents such as `(|a)+` on `aaa`
(Python gives `0..0`, a Pike VM `0..3`; both are defensible). The generator never puts such a body in a random
pattern; the 32 `nullable` cases are ones where Python and the reference agree and are compared on the overall match
and `find_iter` only. Patterns using Python-only syntax were never generated (lookaround, flags, possessive).

## How the oracle was made

    python3 evals/hard-tasks/hd-rust-regex-linear/hidden/make-fixtures.py     # writes hidden/tests/tests/hd_regex_data/cases.in
    node evals/hard-tasks/hd-rust-regex-linear/hidden/make-spec.ts            # writes hidden/spec.json (405 fail-to-pass, 48 pass-to-pass)
    node evals/validate-task.ts evals/hard-tasks/hd-rust-regex-linear

Python 3.15.2 `re` with `re.ASCII`; `$` becomes `\Z`; offsets are converted from characters to bytes. 382 cases from
a seeded generator (`random.Random(20261117)`): 190 random patterns from a small grammar over `a b c` (classes,
escapes, anchors, groups, alternation, all quantifiers incl. lazy and counted; every repeated body non-nullable),
130 curated patterns (dates, IPs, quoted strings, `a|ab|abc`, lazy vs greedy, anchors in odd places, captures in
repetitions), 32 nullable-body cases, 20 `find_iter` empty-match cases, 10 non-ASCII cases. Each case checks
`is_match`, `find`, `captures` (all groups, except nullable-body cases) and `find_iter`. Texts include `\n`.
Errors (53) come from the README table, not from Python (Python is more lenient or uses other positions).
While building, 2 candidates disagreed between Python and the reference (`(|a)+`, `(a??)*`, both nullable-body
corners): they were dropped and the README sentence on this corner was widened. No other candidate disagreed.

## Fairness audit

- Every expected value is decided by a sentence of `seed/README.md`; the unspecified corner is excluded above.
- `Regex` is not required to be `Debug` or `Clone` (the tests use `.err().unwrap()` and `match`); `Match` and `Error`
  are used with `==`/`Debug` as the skeleton derives them.
- Timing: each limit is 10 times the slowest of six runs of the reference with all tests running at once (optimised
  build, `[profile.test] opt-level = 3` in the seed's `Cargo.toml`), with a floor of 400 ms so that a busy machine does
  not fail a linear engine. The floor is above 10x for the tests where the reference needs under 40 ms (that is more
  lenient than the design's rule, deliberately). Reference times in ms (worst of six): `(a*)*b` 69, `(a|aa)*c` 69,
  `(x+x+)+y` 72, `^(a+)+$` 61, `(a?){30}a{30}` 0.5, `(.*){6}x` 56, `((a*)*)*b` 45, `(a*)*(b*)*c` 16, captures 17,
  `a*b` over 1M chars 404, find_iter counts 212, `a*b|c` over 200k 139, 300 alternatives 592, deep nesting and long
  chains 490.

## Timing of the whole check

`node hidden/grade.ts` on the reference: 7 s including the optimised compile; the tests alone 0.6 s.

## Sizes

Reference 723 lines in 4 files (`lib.rs` 130, `parse.rs` 310, `compile.rs` 130, `vm.rs` 150): slightly above the
design's 150 to 700, which is natural for a new program.
