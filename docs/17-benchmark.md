# The benchmark: single Opus first, then the engine against it

## Why (the owner, 2026-11-13)

Stop guessing at edge cases. Measure what one Opus 5.5 agent costs and
delivers on fixed tasks, then change the engine (add, remove, try experimental
things) and keep only what gets nearer to, then past, those numbers. Test the
roles one at a time on inputs with known outputs.

The goal stays: the least total cost for a resolution rate that matches or
beats a single frontier model.

## The tasks

Eight tasks under `evals/tasks`, each with a hidden check the agents never see:

| Task | Kind | What it is |
| --- | --- | --- |
| `js-cart-bug` | bug | a small fix; should never reach the expert |
| `py-kv-store` | small new program | one file, exact interface |
| `hard-py-cron` | hard | cron `next_run`, many edge rules |
| `hard-ts-expr` | hard | an expression parser and evaluator |
| `large-js-shop` | large | five modules that depend on each other |
| `build-logstat` | build | the owner's logstat prompt, 26 hidden cases |
| `build-expenses` | build | the expense tracker prompt, 33 hidden cases |
| `build-sitewatch` | build | the website watcher prompt, 22 hidden cases against local sites |

The three `build-*` tasks are the owner's own prompts with the interface
pinned, so a hidden battery can score them. Each battery prints
`SCORE passed/total`; the task passes only at full score, and the score is
kept.

## What is measured

For every task: hidden pass and score, minutes, estimated API cost (total and
the expert's share), output tokens by tier, cache-read tokens (what an agent
rereads on every call), turns, and the Claude 5-hour quota read by a one-word
call before and after the task.

    neuromesh eval --preset solo-opus --name bench-solo-opus-1 --quota --tasks js-cart-bug,py-kv-store,hard-py-cron,hard-ts-expr,large-js-shop,build-logstat,build-expenses,build-sitewatch
    node evals/bench.ts bench-solo-opus-1 bench-opus-haiku-1      # the table
    node evals/bench.ts --turns bench-opus-haiku-1                # every turn
    node evals/bench.ts --fit bench-solo-opus-1 bench-solo-haiku-1  # quota points per token

An eval that stops at a quota limit continues with the same command.

Quota readings are only clean when nothing else uses the Claude plan at the
same time. A Claude Code session working alongside the eval is counted in
them.

## Testing one role at a time

`neuromesh eval --spec-from <eval>` builds every task from the spec that an
earlier eval's run wrote. No spec turn, no Opus: workers and the reviewer are
then compared on exactly the same input. This is the way to answer "did Opus
plan too little, or did the worker fail a good plan".

Planned and not built yet:
- the spec role alone: run only the spec turn, and judge the spec by how
  workers do on it (frozen workers, different spec prompts);
- the reviewer alone: a passing program and copies with one known bug each;
  count the bugs it flags and the false alarms.

## The experiment with the most to gain: one-answer workers (F77)

From the owner's earlier research (`nmr-handoff.md`): a tight context and one
low-effort answer used 37% fewer tokens than an exploring agent, with the same
result, and the tool's own wrapper cost about 17.5k tokens per call. In the
bookshelf run Haiku's agent turns were most of the quota: dozens of calls,
each rereading the whole conversation.

F77 `direct-build` (preset `factory-opus-haiku-direct`): for a worker's part of
a program that has a spec, the worker has no tools. Its prompt holds the spec,
its task and the project's files; its one answer holds its files. Neuromesh
writes them and runs the checks. A failure goes back once the same way, then
the worker gets its tools as before. Measured on one tiny call: one model
call, 4 seconds, a 3k-token prompt (against 17k to 33k with tools).

Built, with a test on the fake backend. Not yet tried live. The question the
benchmark must answer is whether quality holds when the worker cannot run
its own code.

## Results so far

| Eval | Task | Hidden | Minutes | Est. cost | Opus output |
| --- | --- | --- | --- | --- | --- |
| `bench-solo-opus-1` | `build-expenses` | pass, 33/33 | 1.7 | $0.44 | 12.2k |
| `bench-solo-opus-1` | `build-logstat` | stopped by the 5-hour limit | | | |

Single Opus built the expense tracker to a full hidden score in under two
minutes for about $0.44. That is the bar.

The eval then stopped at the Claude 5-hour limit. The limit was reached mostly
by the Claude Code session doing this work (Fable 5.2 at high effort, with a
very long conversation), not by the benchmark. The quota readings of that
first task are not usable for the same reason.

## Order of work from here

1. Finish `bench-solo-opus-1` (same command; it continues).
2. `solo-haiku` on the same tasks: the cheap floor, and Haiku's quota weight.
3. `factory-opus-haiku` (plan-first, as it is): `bench-opus-haiku-1`.
4. `factory-opus-haiku-direct` with `--spec-from bench-opus-haiku-1`: the same
   specs, one-answer workers. Compare worker tokens, quota and hidden scores.
5. Keep what wins; then the spec role (a shorter spec) and the reviewer role.
6. The local Gemma model (`llama-server`, Gemma 4 E2B is on this Mac) in one
   small role, through opencode. Experimental.

Run these from a session with a short conversation, on Opus 5.5, and leave it
idle while an eval runs.
