# The usage log (`neuromesh-testing`)

The task suite and the build test are synthetic. They show what a preset can
do, not what it is like to use on real work. The usage log records real runs.

## What is recorded

After every `neuromesh run` (and `neuromesh resume`), one line goes into
`~/.neuromesh/usage/runs.jsonl`, and `~/.neuromesh/usage/USAGE.md` is rewritten
from it:

- the preset, and what the brief engine made of the request (kind of work, kind
  of program, the staffing it chose);
- the request as typed (first 300 characters);
- the status, whether the checks passed, the time taken, the number of turns,
  and whether the expert had to step in;
- tokens and estimated cost (API list prices, never money spent) for each model,
  split into expert and worker;
- the size of the change.

When a run ends in a terminal, Neuromesh asks one question: how did this go
compared with how you usually do this kind of work, from 1 (much worse) to 5
(much better), what you usually use, and an optional note. Press Enter to skip.
Rate later, once you have tried the result:

```bash
neuromesh rate last 4 --usual "Claude Code with Opus" "app worked first time"
```

`neuromesh usage` prints the report. `--no-log` leaves a run out; `--no-rate`
skips the question. Evals are never recorded here.

Nothing leaves the machine.

## What it is for

The report's first table groups runs by preset and kind of work: how often
each finished with passing checks, its average time, cost and expert cost, and
the owner's average rating. With enough runs it answers the question the
synthetic tests cannot: which combination to use for which kind of work.
