# hd-py-streaming-stats (refactor, Python): notes for the advisor, never shown to a model

## What the task is

`logstats/`: a log analytics CLI that reads a whole file (`readlines`), parses every line into a list, sorts it by timestamp and
only then counts. The prompt asks for one streaming pass (stdin when there is no file argument or `-`, several files as one log),
memory independent of the number of lines (16 MiB `tracemalloc` peak on 2 million lines, 2,000 users, 300 paths), and a report
identical character for character. The report layout, the tie rule of the top paths, the session rule (more than 1800 s,
exactly 1800 continues) and the out-of-order tolerance (a line may be up to 60 s older than the newest line before it) are in
`docs/OUTPUT.md` and `README.md`; the prompt mentions none of those details.

## The traps

1. **Sessions need order, and the log is only nearly ordered.** The seed sorts everything, so out-of-order lines are invisible to
   it. A one-pass rewrite that keeps "last timestamp per user" counts a session too many when a late line lands inside a 1830 s
   gap (`f07`: 0, 1830, then 1790 for the same user: sorted gaps are 1790 and 40, one session; naive gives two). The fix is a
   small buffer that holds lines until no later line can be older than them (the reference's `Sessionizer`: a heap, release
   when `ts < newest - 60`), so memory is the lines of the last minute plus one record per user.
2. **Top paths ties by name.** `Counter.most_common(10)` breaks ties by first-seen order; the rule is ascending path (`f10`: 14
   paths with 3 requests, in non-alphabetical order of appearance, including `/é`, `/B`, `/_`, `/~`).
3. **First and last timestamp** are min and max, not first and last seen (`f07`, `f08`, `f09`, `f12`).
4. **Everything else is order independent** and can be added up on arrival; storing records "to be safe" breaks the memory bound
   (a per-user list of timestamps is 70 MB on the 2M stream, over four times the limit).
5. **Decoding and line ends.** Bad UTF-8 becomes U+FFFD (`f14`), CRLF (`f13`, `f27`), blank vs malformed vs tabs (`f15`, `f16`).
   Stdin has to be read as bytes (or as a text stream with replacement), and `sys.stdin.buffer` must not be closed by the code.
6. **Several files** are one stream in the order given, mixed with `-` (`test_files_and_standard_input_can_be_mixed`), and a file
   that cannot be opened ends the run with exit 2, nothing on stdout, the message `logstats: cannot open NAME: REASON`.

## Why a small model should fail

It rewrites `analyze` to accumulate and keeps the old `count_sessions` idea per user (trap 1), or `most_common` (trap 2), or both;
the 20 visible tests (in-order logs, golden output, ties that coincide with insertion order, a gap of exactly 1800 s) stay green.
If it sorts a list of records to stay safe it fails the memory test.

## Oracle

`hidden/tests/tests/seed_logstats/` is a copy of the seed package: the output "equal to the seed's" is literally the seed's output
on the same bytes (generated at test time into a temp file; no stored expected files, so nothing to drift).
- 30 fixtures built by seeded generators (`f01` to `f20` hand-made edge cases; `f21` to `f30` from `random.Random(20261117)`: 600
  to 6000 lines, jitter up to 60 s, jumps of 1790 to 1815 s between lines so gaps fall on both sides of 1800, one to 300 users,
  3 to 30 paths, malformed and blank lines, CRLF, Unicode users and paths). Every fixture obeys the 60 s rule (generated as
  `t - j` with `t` non-decreasing and `j <= 60`; hand-made ones checked by hand).
- Each fixture is run twice: from a file (`test_a_file_gives_the_seeds_output`, passes on the seed: pass-to-pass) and from
  standard input (`test_standard_input_gives_the_seeds_output`: fail-to-pass, the seed has no stdin).
- Memory: `streamgen.LogSource` yields 2,000,000 lines (ten per second, 2,000 users, 300 paths, every line 0 to 60 s older than the
  newest) chunk by chunk through a `TextIOWrapper` standing in for `sys.stdin`; `tracemalloc` peak must stay under 16 MiB and
  the report must show the exact counts (`lines`, `requests`, `4xx`, `5xx`, `users: 2000`). A second test does the same for a 300,000
  line file named on the command line.

## Decisions I had to make

- The log format, the exact report text, the tolerance semantics ("a line may be up to 60 seconds older than the newest line before
  it") and the session rule are mine, written into README and docs/OUTPUT.md before the tests.
- Tolerance and memory are the stated contract of the prompt: 16 MiB at ten lines a second. A solution that holds a fixed number of
  lines instead of a time window would still pass here but is not the design (it would break at a higher rate); the README does
  not promise a rate.
- `TOLERANCE = 59` in the reference behaves exactly like 60 (a released line is at least 60 s behind the newest and no later line
  can be older), so the hidden tests cannot and need not tell them apart.
- No stored expected outputs: the oracle is the seed code itself.
- The hidden check is slow (about 2 to 3 minutes on the reference, mostly the 2M-line `tracemalloc` run: tracing costs about 7x),
  so `hidden/spec.json` sets `timeoutSec: 900`. DESIGN asks for 2 million lines, so I kept it.

## Mutation check (by hand, offline, memory tests skipped)

Put into the reference one at a time, each is caught: no reordering buffer (19 hidden tests fail, including f07), tolerance 30
instead of 60 (9, the near-1800 random fixtures), `gap >= 1800` (16, f06 and the random ones), top paths ties by first seen
instead of by name (11, f10 and the others with ties), first/last timestamp by arrival instead of min/max (15). `TOLERANCE = 59`
is not caught, on purpose (see above: it is the same behaviour).

## Notes for the harness

- Parametrized test ids must not contain blanks: `grade.ts` reads ids with `\S+` and would cut them (the visible `test_malformed_lines`
  ids are therefore names, not the log lines).
- Time: about 2.5 minutes per hidden run on the reference on an idle Mac (the 2M-line `tracemalloc` test is most of it), and the
  full `validate-task` (seed plus three reference runs) took 17 minutes while the machine was at load average 60 (other sessions).
