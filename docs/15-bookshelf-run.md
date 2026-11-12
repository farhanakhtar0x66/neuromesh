# Bookshelf: Neuromesh against Opus alone, and what the quota really costs

## The comparison (2026-11-12)

Prompt (the owner's): a terminal app for a personal book collection. It should
search an online API by name and offer the closest match, add books, track what
has been read, take ratings and notes, import and export CSV, handle duplicates
and missing information, work offline, and show a reading dashboard.

| | Neuromesh (`factory-opus-haiku`, plan-first F64 to F68) | Opus 5.5 medium alone (Claude app) |
| --- | --- | --- |
| Claude 5-hour quota (owner's screen) | 27% → 36%: **9 points** | 36% → 41%: **5 points** |
| Estimated API cost | $0.71 shown, plus two Opus turns recorded as unknown | not known (desktop app) |
| Time | 18.4 minutes | a few minutes |
| What it built | Node.js, no dependencies, hand-written terminal UI: 2,145 lines, 1,336 test lines (135 tests), README, CLI | Python with Textual: 1,395 lines, 250 test lines (20 tests), README |

Run records: `~/.neuromesh/projects/bench-1-1a310652/runs/20261112-194409-b757`.
Opus's app: `~/Extra/opus-1/bookshelf`.

### Quality

Both apps got the same probes: a live typo search, the full add, read, rate,
notes and export cycle in a real terminal, two CSV files (the app's own columns,
and Goodreads-style ones with duplicates, a bad rating and a row with no
title), the same book added twice, and search with the network refused. The
scripts are `tui.py`, `nm_tui.py`, `op_tui.py` and `op_check.py` in this
session's scratchpad.

| Probe | Neuromesh | Opus alone |
| --- | --- | --- |
| "the hobit": the closest match | a study guide ("A literature unit for The hobit…") | The Hobbit |
| Add, mark read, rate, notes, export in the TUI | works | works |
| Same book added twice | refused | refused |
| App's own CSV: duplicate, rating 9, no title | merged, warned, skipped | merged, skipped |
| Goodreads-style columns (`Author`, `My Rating`, `Exclusive Shelf`) | not recognised: authors, ratings and shelf lost, **2 duplicate books created** | recognised, duplicates merged |
| A read date from the CSV | kept | replaced with the import day |
| Offline search | library matches, labelled | library matches, labelled, offers to add by hand |
| Dashboard | totals, ratings, top authors | also per year, subjects, decades, recent, incomplete |

Opus's app meets the request better. Neuromesh's has more tests and a CLI, but
it gets two things wrong that the prompt names: the closest match and
duplicates. These are task failures (the spec and the code), not engine
failures.

## Where the quota went

| Turns | Model | Output tokens | Cost (est.) |
| --- | --- | --- | --- |
| Spec and build plan | Opus | 8.5k | $0.22 |
| Splitting the `ui` task | Opus | 6.1k | $0.25 |
| Building `ui.b` itself, twice stopped at the budget | Opus | unknown (recorded as nothing) | unknown |
| 5 builds | Haiku | 155k | $0.15 |
| 7 reviews | Haiku | 45k | $0.06 |
| 2 review fixes, the split request, the scout | Haiku | 21k | $0.03 |

No Haiku call passed 100K prompt tokens (largest 85K). F67 held.

### Haiku is not 40 times cheaper on the subscription

At API prices Haiku costs 1/40 of Opus per token. The quota does not follow
API prices. From the runs so far (readings are whole points and lag one turn):

| Run | Opus output | Haiku output | 5-hour points |
| --- | --- | --- | --- |
| logstat, Opus alone | 6.8k | - | 1 |
| logstat, Neuromesh | 5.5k | 53k | about 2 |
| SiteWatch, Neuromesh | 5.3k | 148k | 6 |
| Bookshelf, Neuromesh | 14.5k + unknown | 220k | 9 |
| Bookshelf, Opus alone | unknown | - | 5 |

Roughly, one point is about 6 to 7 thousand Opus output tokens, or 30 to 40
thousand Haiku output tokens, each with the cache reads around them. So **on
the Claude quota Haiku is about 5 to 7 times cheaper than Opus per token, not
40 times.** Haiku also writes far more for the same program, with its thinking,
its tool calls, and the larger program and test suite the spec asked for: 220k
tokens here. Opus wrote the whole app alone in what used 5 points.

What this means: while Opus and Haiku draw on the same Claude quota, a
Haiku-built program costs about as much quota as Opus building it alone, and
Opus's planning comes on top. The owner's target (about 1% Opus plus 1% worker
where Opus alone uses 3%) needs:
- the worker on a different quota: Luna through Codex, the default worker, uses
  the ChatGPT plan;
- Opus's share well below Opus building alone. Here it was spec, split and a
  stopped build: about 3 points of the 5 that Opus alone used.

This rests on one or two runs per size, and on screen readings of whole
points. The usage log now records the readings for every run (F72), so the
next runs add evidence without screenshots.

## Engine defects found, and fixed

1. **The expert was given a part it could not pay for.** The spec and the split
   used $0.46 of the $0.60 expert budget. Opus's split kept `ui.b` for itself.
   Its first turn was stopped at once: the cache write of a fresh Opus prompt
   is about $0.15. Because the stop counted as a failure, the engine escalated
   to Opus again, and the second turn was also stopped mid-write. The checks
   happened to pass on what it had written. **F69 budget-handoff**: an expert
   part goes to the top worker rung when the budget left cannot pay for one
   expert turn. An expert part stopped at the budget keeps its work, the checks
   decide, and any further turns are the worker's.
2. **Usage of a stopped turn was lost.** Both stopped Opus turns were recorded
   with no usage, so real spending was missing from the cost. **F70 cut-usage**:
   the usage the stream reported is kept, with exact input and cache counts and
   an estimated output, and marked as estimated.
3. **Seven reviews, four of which could not run the program.** Each part had
   its own Haiku tester. The testers for `core`, `data` and `ui.a` each
   reported that the entry point was missing, which was not their part's job,
   and passed. **F71 one-review**: the parts of a planned build merge on their
   own checks. The last part gets the one review, of the whole program, with
   the acceptance runs. In this run that would have saved about 30k Haiku
   output tokens (about 1 point).
4. **The usage log had no quota.** Cost estimates at API prices misjudge a
   subscription run, as above. **F72 quota-log**: each run records each tool's
   5-hour and weekly readings at its first and last turn, and USAGE.md shows
   them.
5. **The final report showed the split worker's "I did not write any ui code"**
   instead of the parts' reports. The TUI now leaves out a task that was split.

Checked with the fake backend (167 tests; the two budget tests fail with F69
and F70 switched off). Not yet tried live.

## Not changed

The closest-match ranking and the Goodreads column names are the model's work
and the spec's. They are not an engine fault. The reviewer did not catch them,
and neither did the 135 tests the workers wrote.

## Next

The same prompt on `factory-opus-luna`, with both quota bars noted before and
after: Claude for Opus, ChatGPT for Luna. That run tests the case where the
worker does not share Opus's quota.
