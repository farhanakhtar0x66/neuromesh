# The hard set: tasks a cheap model alone should fail (design, 2026-11-17)

Batches 2 and 3 do not separate anything: Haiku alone passed 28 of 29 and 8 of 10. Two reasons, both fixable:

1. **The prompts leak the check.** Every batch-3 prompt ends with "Graded by a new test ... It checks that ...": the
   model is told what to test itself on, so "my own test passes" and "the hidden test passes" are the same thing.
2. **The work is one idea deep.** A contract stated in the prompt, a few dozen lines, one file that matters. A small
   model's weakness (stopping when the first plausible fix works, not reading the rules file, not checking the case it
   did not think of) never gets a chance to show.

The hard set is built like the index sites build theirs (several kinds of difficulty, each measured on its own): twelve
tasks in four groups, each task designed around a known way small models fail. It is synthetic (a seed project written
for the task), so it is reported as its own group, never mixed into the real-task resolution rate of
`docs/22-path-to-the-goal.md` phase 1. Its job is to show *whether the cascade adds anything over its own worker* on
work where the worker alone is not enough.

## The rules every task follows (the builder checks each one)

- **Fair.** Every hidden assertion follows from a sentence of the prompt, from a rules/spec file in the seed, or
  from what the seed code already does. Nothing is graded that a careful senior engineer could not get from the
  materials. If a test needs an arbitrary choice (an error text, an order), the spec states it.
- **No leak.** The prompt reads like a real issue or a real spec. It never lists the hidden tests, never names the
  traps ("note the chunk boundary"), never says "graded by". Symptoms are described as a user would report them.
- **A false comfort.** The seed has its own visible tests and a `checks` entry in `task.json` that pass on the seed
  and stay passing after a shallow fix. Haiku's habit is to stop when the visible tests are green; the hidden check
  is wider.
- **Wide hidden checks.** Besides named examples, each task has at least one seeded property test: many generated
  inputs compared with an oracle that lives only in `hidden/` (a brute force, a trusted standard library, or fixtures
  produced by an outside tool at build time). The seed is fixed, so the check is deterministic.
- **Deterministic.** No wall-clock sleeps, no network, no real concurrency races: time is an injected clock, async
  work is driven by promises the test resolves. A time limit is allowed only for complexity checks and is set at
  10 times what the reference needs on the owner's Mac.
- **No dependencies.** Node built-ins, Python standard library plus pytest, Rust std. Runners: `node --test`, `pytest`,
  `cargo test` (what `evals/real-task/grade.ts` understands).
- **Valid.** `node evals/validate-task.ts <task>` passes: fail-to-pass all fail on the seed, everything passes on the
  reference in 3 fresh copies, nothing flips, the project's own check passes on the seed.
- **Sized for an hour.** The reference change is 150 to 700 lines. The seed is a small but real project (300 to 1500
  lines, a README, a docs file where the task needs rules) that has to be read, not a single stub file.

## Folder layout

`evals/hard-tasks/<id>/` has the same shape as a built real task, all committed (there is no source repository to
rebuild it from):

    prompt.md          the issue or spec, as a user would write it
    task.json          kind, language, runner, testCommand, setup, checks, hiddenCheck: "node hidden/grade.ts"
    seed/              the project before the change, with its visible tests
    hidden/tests/      the hidden test files, laid over the workspace by grade.ts
    hidden/spec.json   runner, testCommand, failToPass, passToPass
    hidden/grade.ts    a copy of evals/real-task/grade.ts
    reference/files/   the changed files of the reference solution (and reference/deleted.txt if any)
    NOTES.md           for the advisor only, never shown to a model: the traps, why a small model should fail,
                       how the oracle was made, the reference's time on the check

Ids start `hd-`. `evals/baselines.ts` names the runs after the folder (`hard-tasks` gives `hd-haiku-1`, ...).

## The twelve tasks

Kinds as phase 1 asks: bug 5, feature 3, refactor 2, new program 2. Languages: TypeScript or JavaScript 6, Python 3,
Rust 3. "Why Haiku fails" is the design intent; the first live run measures it.

### Group A: bugs whose cause is not where the symptom is

**hd-py-ledger-cents** (Python, bug). Seed: a small invoicing package (models, discounts, coupons, tax, invoice,
monthly report, CLI) and `docs/BILLING_RULES.md` stating the money rules exactly: Decimal everywhere, line subtotal
rounded half-up to cents, percentage discounts per line before tax and never below zero, fixed coupons spread over
lines in proportion to subtotal by the largest-remainder method so the shares sum exactly, tax per line per
jurisdiction, the report built from the same line values as the invoice. The seed breaks four of these in three files
(floats in the tax helper, half-even in the report, naive coupon rounding, a discount that can go negative). Issue:
"invoice totals and the monthly report disagree by a cent on some customers; one customer got a negative discount line".
Hidden: the reported cases, plus 400 seeded random invoices against a hidden Decimal oracle, plus report == invoices.
Why Haiku fails: it fixes the one rounding call the issue points at and stops; the rules file is never read.

**hd-ts-chunked-csv** (TypeScript, bug). Seed: a streaming CSV reader (RFC 4180, options for delimiter, quote, header
row, BOM) used by an import CLI, with tests that feed whole files. Seed bugs: each Buffer chunk decoded separately (a
multibyte character split across chunks turns to U+FFFD), quote state reset at chunk ends, CRLF split across chunks
gives an empty record, BOM stripped only when it is in a chunk of its own. Issue: "big imports sometimes have garbled
names and broken rows; the same rows imported in a small file are fine". Hidden: 50 fixtures, each fed in 200 seeded
random chunkings, compared with parsing the whole buffer; RFC cases; and an async-iteration test that the first record
is yielded before the source ends (no whole-file buffering).
Why Haiku fails: it fixes the decoding and misses the state machine, or buffers everything.

**hd-rust-free-slots** (Rust, bug). Seed: a scheduling crate: weekly working hours per person, busy intervals,
exceptions (days off, extra hours), buffers before and after meetings, and `free_slots(people, window, min_len)` for a
common free time. Intervals are half-open, minutes since the epoch, a person has a fixed UTC offset. Seed bugs: touching
intervals merged as overlapping, buffers applied after the merge instead of before, exceptions that cross midnight
dropped, unsorted input assumed sorted. Issue: "the finder offers slots that overlap a meeting's buffer and misses
slots after a day off". Hidden: named cases plus 300 seeded random calendars against a minute-grid brute force.
Why Haiku fails: four interacting bugs; fixing two makes the visible tests and the issue's example pass.

**hd-ts-recurrence-dst** (TypeScript, bug). Seed: a reminder scheduler: rules "every N days at HH:MM", "weekly on
these weekdays", "monthly on day D" and "monthly on the last <weekday>", in an IANA time zone, with `until` and
`count`. `docs/RECURRENCE.md` states: a local time that does not exist (spring forward) moves forward by the gap; an
ambiguous one (fall back) takes the earlier instant; day 29 to 31 in a short month means the month's last day; `until`
is an inclusive local date. The seed adds 24 hours in UTC, so it drifts an hour at every change, fires twice on fall-back
days and skips months. Issue: "reminders fire an hour late after the clocks change, twice on one day in November, and
never in February for the 30th". Hidden: rules in America/New_York, Europe/London, Australia/Lord_Howe (30-minute
shift), Asia/Kolkata, America/Santiago, Pacific/Chatham, over three years, checked against an oracle built on
`Temporal.ZonedDateTime` with `disambiguation: "compatible"` (Node 26 has Temporal; the solution may use it too: knowing
the right tool is part of the skill).
Why Haiku fails: offset arithmetic by hand, correct for one zone and wrong at the edges of another.

**hd-js-cache-stampede** (JavaScript, bug). Seed: a memo cache for an API client: TTL, stale-while-revalidate window,
in-flight request sharing, size-bounded LRU, `delete` and `clear`, an injected clock. Seed bugs: concurrent misses
start one load each, a failed load is cached as a value, a background refresh that finishes after `delete` puts the
old value back, LRU order not updated on a stale read, the size counter drifts when a value is replaced. Issue: "under
load the upstream gets hammered, errors stick for the whole TTL, and deleted keys come back". Hidden: deterministic
tests that resolve the loader's promises by hand in chosen orders, plus a seeded random sequence of
get/set/delete/tick/resolve against a reference model.
Why Haiku fails: async interleavings; the fix for one ordering breaks another.

### Group B: features with a long, exact spec

**hd-ts-query-language** (TypeScript, feature, several files). Seed: an issue-tracker library (store, records,
substring search) and a CLI `track list --search <text>`. Add the query language in `docs/QUERY.md` (EBNF given):
bare words, `field:value`, quoted phrases with backslash escapes, `>`/`>=`/`<`/`<=` on dates and numbers, ranges
`a..b`, `AND` `OR` `NOT` and `-`, implicit AND, parentheses, precedence NOT > AND > OR, case rules per field, macros
`is:open` `is:mine`, relative dates `@today-7d` against an injected clock, and `QueryError` with a 1-based column and
the exact messages listed in the spec; the CLI prints the error with a caret under the column. Plain words must keep
the old substring behaviour. Hidden: about 100 queries against a fixed store, every error message and column, CLI
output.
Why Haiku fails: thirty clauses; it gets the grammar's centre and misses precedence, escapes or columns.

**hd-rust-merge3** (Rust, feature). Seed: a text crate with Myers line diff and unified-diff output. Add
`merge3(base, ours, theirs, style)` with conflict markers in git's format (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`,
and `||||||| base` in diff3 style), identical changes on both sides taken once, the result's conflict count, and a
`merge` subcommand in the crate's binary with git's exit codes (number of conflicts, capped at 127). Hidden: 60 cases
whose expected output was produced by `git merge-file -p` (and `--diff3`) at build time, kept only where the spec's
rules decide the output (the builder drops cases where git's heuristics go beyond the spec).
Why Haiku fails: hunk alignment between two diffs against the same base is the whole problem, and it is easy to get
nearly right.

**hd-py-migration-graph** (Python, feature). Seed: a SQLite migration tool with numbered, linear migrations
(`migrate`, `status`). Add migrations that declare `depends_on`, a deterministic topological order (ties by id), merge
heads, `migrate --to <id>`, `rollback <id>` that runs `down()` for it and everything that depends on it in reverse
order, `plan` output in the format the spec shows, a lock row so two runs cannot overlap (a stale lock older than the
configured age is taken over), each migration in its own transaction with the history row written in the same one, and
the errors for cycles, missing dependencies and two heads without a merge. Hidden: scenarios on a temporary database,
including a migration that fails half way.
Why Haiku fails: rollback order, the transaction boundary and the lock are each a separate place to be wrong.

### Group C: refactors that must keep every behaviour

**hd-ts-event-store** (TypeScript, refactor). Seed: an inventory service (stock, reservations, transfers between
warehouses, returns) on mutable maps, with 60 visible tests. Refactor so every change is an appended, frozen event and
the state is a projection of them; add `replay(events)`, `snapshot()` and `restore(snapshot)`, and `history(sku)`.
Every public behaviour, error message and listing order stays the same. Hidden: the 60 tests as pass-to-pass plus 40
more of the same public API, and fail-to-pass properties on 300 seeded random operation sequences: live state equals
replay, equals snapshot plus replay of the tail, failed operations append nothing, events are frozen.
Why Haiku fails: a failed operation that half-applies, or an event that does not carry enough to replay.

**hd-py-streaming-stats** (Python, refactor). Seed: a log analytics CLI that reads a whole file into memory and
prints a report: counts, sums, min and max, the top 10 paths with ties broken by name, and sessions per user (a new
session after 30 minutes idle), plus an error-rate per hour. Make it one streaming pass with memory bounded by the
number of distinct users and paths, reading stdin or files, with byte-identical output. Hidden: output equal to the
seed's on 30 fixtures (including out-of-order lines within the tolerance the README states and malformed lines), and a
`tracemalloc` peak under a stated limit on a generated stream of 2 million lines.
Why Haiku fails: out-of-order lines in the sessionizer and exact tie rules in top-k when it rewrites the pass.

### Group D: new programs with a spec and a complexity bound

**hd-rust-regex-linear** (Rust, new program). Implement a regex crate for a stated subset (literals, `.`, classes
with ranges and negation, `\d \w \s` and their negations, `^ $` meaning start and end of input, groups and
non-capturing groups, alternation, `* + ? {m} {m,} {m,n}` and their lazy forms) with leftmost-first match semantics:
`is_match`, `find`, `captures`, `find_iter`, and a parse error with a position. It must run in time linear in the
input for any pattern. Hidden: about 300 cases whose expected results were produced at build time by Python's `re`
(with `\Z` for `$`), plus pathological patterns such as `(a*)*b` and `(a|aa)*c` on 30,000 characters within the time
limit.
Why Haiku fails: it writes a backtracking matcher (correct, exponential), or a Thompson NFA without capture priorities.

**hd-js-sheet-engine** (JavaScript, new program). A spreadsheet engine as a library: `set(cell, input)`,
`get(cell)`, formulas with numbers, strings, `+ - * / ^`, unary minus, comparisons, `&`, A1 references and ranges,
`SUM AVERAGE MIN MAX COUNT IF ROUND COUNTIF`, error values `#DIV/0! #REF! #VALUE! #NAME? #CIRC!` and how each
propagates, every cell of a cycle shown as `#CIRC!`, and incremental recalculation: after `set`, only the dependents
are recalculated (an `onEvaluate` hook counts them). Hidden: about 150 formula cases, error propagation, cycles made
and broken, evaluation counts, and a 20,000-cell chain within the time limit.
Why Haiku fails: recomputing everything, recursion depth on the chain, or a cycle that leaves stale values when it is
broken.

## How the set is calibrated (live runs, the owner says go)

1. Build and validate all twelve (no model call).
2. One fairness check per task, before any baseline: a fresh Sonnet session that sees only the prompt and the seed
   solves it, and the advisor reads any hidden failure against the rules above. A task nobody can pass from its
   materials is a broken task, not a hard one.
3. `node evals/baselines.ts --suite evals/hard-tasks --only haiku,cascade1`. Target: Haiku alone passes 2 to 5 of
   12. A task Haiku passes is kept only if it is the group's only easy one.
4. Opus alone only with the owner's go (`--only opus --allow-opus`).

## Cheap lever for the real tasks (separate from this set)

The batch-2 and batch-3 prompts can lose their "Graded by ... It checks that ..." paragraph without losing any
contract the tests need (names, messages and formats stay in the contract part). That makes the real tasks follow the
recipe ("the solution left out") and costs no build time: a `prompts-issue/` variant built by `make-batch.ts`, like the
terse one.
