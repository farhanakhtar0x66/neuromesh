# Small benchmark: logstat, Neuromesh against Opus alone

The first live run after F54 to F63 (2026-11-12). The same prompt went to
Neuromesh (`factory-opus-haiku`) and to Claude Opus 5.5 medium alone in the
Claude desktop app:

> Write a small single-file CLI tool in Python (or Rust/Go) called logstat that
> reads JSONL log lines from stdin (ts, level, service, msg, latency_ms) and
> prints a summary table of request counts, error rates, and p95 latency grouped
> by service. Make sure it handles malformed JSON lines gracefully without
> crashing, supports a --min-level filter, and includes a quick test script that
> pipes in edge-case data (empty input, broken lines, missing fields) and
> verifies the output.

Records: the run in `~/.neuromesh/projects/bench-1-1a310652/runs/20261112-174523-d071`,
the solo session's transcript, and the owner's usage screenshots. Costs are
estimates at API list prices (`src/usage/prices.ts`).

## Usage

| | Opus output tokens | Opus cost (est.) | Haiku cost (est.) | Total (est.) | Minutes | 5-hour quota (owner's screen) |
| --- | --- | --- | --- | --- | --- | --- |
| Opus alone (4 model calls) | 6.8k | $0.43 | - | $0.43 | about 1 | +1% |
| Neuromesh | 5.5k | $0.17 | $0.06 | $0.23 | 4.8 | +1% |

Both moved the 5-hour bar by one point and the weekly bar by none, which is the
screen's resolution: the quota cannot tell these two apart. The estimate can:
Neuromesh used 40% of the Opus cost of Opus alone, and 53% of its total.

Neuromesh, by turn:

| Turn | Model | Output | Cost (est.) | 5-hour reading after |
| --- | --- | --- | --- | --- |
| Scout (F63) | Haiku | 1.5k | $0.003 | 1% |
| Spec and design | Opus | 5.5k | $0.173 | 2% |
| Build | Haiku | 44.8k | $0.041 | 3% |
| Review (with 4 acceptance runs) | Haiku | 6.5k | $0.015 | 3% |

The Opus solo session ran inside the desktop app, whose own context (about
60k tokens, cached) is part of its cost; through a lean harness it would cost
less. That makes the comparison favour Neuromesh somewhat.

## Quality

Both programs were run against one battery of 27 cases written afterwards
(`battery.py` in this session's scratchpad; not seen by either). It scores only
what the prompt implies: counts, error rates and p95 by service, malformed and
hostile input without a crash, `--min-level`, empty and whitespace input,
200k lines in under 5 seconds, and output piped into `head`. Design choices the
prompt leaves open (the missing-service label, a TOTAL row) are not scored.

| | Python 3.15 | Python 3.9 (the Mac's default `python3`) | Own tests | Size |
| --- | --- | --- | --- | --- |
| Neuromesh | 27/27 | 27/27 | 48 pass | 316 lines + 363 test lines + README |
| Opus alone | 26/27 | 25/27 | 11 pass | 151 lines + 172 test lines |

Opus alone crashed with a traceback on a 400-digit integer latency (valid
JSON; `float()` overflows) and, on Python 3.9, on deeply nested JSON
(`RecursionError` is not caught). The prompt asked for exactly this kind of
input to be handled without crashing. Neuromesh's spec named both cases.

Neuromesh's result also has a TOTAL row, the first bad line's number in the
skip message, and a clear message when stdin is a terminal. On a task this
small, the extra is polish rather than function.

## What the new features did

| Feature | In this run |
| --- | --- |
| F63 scout-facts | Ran (10 s, $0.003). Facts were true but generic: no outside data to fetch. |
| F54 work-env | Made `.venv`; nothing to install. |
| F58 acceptance-runs | The spec named 4 runs; all ran and the reviewer judged them first. |
| F57, F59, F56, F60, F61, F62 | Not triggered: the build passed its checks and the review on the first try. |
| F55 worker-network | Not used: Claude Code already has the network. |

One engine defect: two `__pycache__/*.pyc` files (Python 3.12 bytecode) went
into the diff and were applied to `bench-1`. The reviewer flagged them as minor
and the task merged anyway. Fixed the same day: agents, checks and acceptance
runs run with `PYTHONDONTWRITEBYTECODE=1`, and `*.pyc` never enters a diff
(part of F54).

## What it shows

- On a small task Neuromesh gave the better program for about half the
  estimated cost, but took about five times as long.
- The Opus spec turn ($0.17, 5.5k output) is almost the whole of Opus's own
  solo output (6.8k). For small tasks the spec is the job, so the saving there
  is small and comes from a better result. The saving the design is built for,
  where Opus alone spends 25k to 60k output tokens, needs a larger build.
- One run each. The next test is a real app, as the owner plans.
