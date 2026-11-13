# The hard task (2026-11-13)

The eight benchmark tasks (`docs/17-benchmark.md`) cannot tell the setups
apart: single Opus, Haiku alone and Opus+Haiku all pass all of them, and Haiku
alone is the cheapest by far. This is one task hard enough to separate them.

## The task

`evals/tasks/hard-py-minidb`: build `minidb`, a SQL database engine in pure
Python whose answers must be exactly SQLite's (joins, grouping, subqueries,
transactions with rollback, constraints, saving to a file, a command line, and
speed limits that need hash joins and working indexes).

The hidden check has 197 cases. Each answer is compared with what the real
SQLite returns for the same statements, so the answer key cannot be wrong, and
a statement SQLite unexpectedly rejects is reported as a fault in the battery.
The package runs in a child process where `sqlite3` cannot be imported. A
stand-in that wraps SQLite scores 197/197 with the block off and 0/197 with it
on. The task passes only at 197/197.

## Runs

| Run | Preset | Hidden | Time | Notes |
| --- | --- | --- | --- | --- |
| `hard-solo-fable-1` | Fable 5.2 high, alone | not finished | cut at 16 min | Killed when the app session ended. One survey call, then about 91,000 thinking tokens with no file written; the 5-hour meter went from 0% to about 30%. |
| `hard-opus-haiku-1` | `factory-opus-haiku` | stopped at 23 min | | Opus's five-task plan was thrown away (limit 4), a second plan turn was cut at the $0.60 budget, and Haiku was left to build everything alone. Stopped by hand. |
| `hard-tiers-1` | `factory-opus-sonnet-haiku` | **197/197, pass** | 49 min | 17 turns; 5-hour meter 58% to 89% (other work ran at the same time, so this is too high). |
| `hard-solo-fable-2` | Fable 5.2 high, alone | pending | | Scheduled for the 14:40 UTC reset. |

## What each run showed, and what was changed

1. **A good plan was discarded** (two-tier run). The spec prompt asked for "2 to
   5 tasks" and the preset's limit was 4. Now the spec is told the limit, and a
   plan up to 12 tasks is kept.
2. **A long think was invisible.** The Claude parser counted thinking only when
   the next message arrived, so the cut Fable turn was recorded as 96 output
   tokens. It now reports usage as the thinking counts arrive.
3. **Three tiers by difficulty** (F78, the owner's idea). In `hard-tiers-1` Opus
   kept only the query executor (11.5 min, 64K output, cut at the $3 budget with
   its work kept), gave the parser, value rules, storage and engine to Sonnet
   (1 to 4 minutes each, one 6-second repair in all), and the command line and
   comparison tests to Haiku.
4. **The review loop was the waste.** Sonnet's review found a real but tiny flaw
   in the number-to-text rule (`CAST(1/3.0 AS TEXT)`, 17th digit), in a file
   Sonnet had built. The fix went to Haiku, the last task's worker: it first
   listed the flaw as a known difference, then took two more turns, 19 minutes
   and 200K output tokens. That loop was 21 of the 49 minutes, and the hidden
   battery does not test it. Now a finding is fixed on the rung that built the
   file it names (F79).

## Open

- The expert budget ($3) was reached at the very end of Opus's one part. Either
  the part should be split, or the budget should follow the plan's size.
- A cut turn's cost is recorded as unknown in the attempt, and a resumed
  session's cost looks cumulative, so the per-model dollar figures of this run
  do not add up to the total. Tokens and time are right.
- Whether the review loop changed the hidden score was not measured (the
  per-turn work folders are removed after applying).
- Fable alone has not finished a run, so there is no bar yet.
