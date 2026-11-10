# M1 results: one agent, prompt to applied diff

Run on 2026-11-11, preset `solo-flash` (Gemini 3.8 Flash high through
Antigravity), through the real command line: `neuromesh run`, then
`neuromesh apply`, then hidden tests the agent never saw.

## Five tasks

| Task | Kind | Checks | Hidden tests | Turns | Time | Tokens (fresh input / cache read / output) |
| --- | --- | --- | --- | --- | --- | --- |
| js-slugify-bug | bug fix | passed (failed before) | pass | 1 | 2m 15s | 67k / 299k / 7.6k |
| js-todo-remove | multi-file feature | passed | pass | 1 | 3m 52s | 155k / 772k / 19.8k |
| py-wordcount-json | feature | passed | pass | 1 | 3m 34s | 100k / 602k / 8.3k |
| readme-typos | trivial | none | pass | 1 | 1m 10s | 50k / 111k / 3.5k |
| rust-roman | implement | passed (failed before) | pass | 1 | 1m 37s | 78k / 406k / 5.5k |

5 of 5 passed. Zero engine failures. No repair turns were needed.

## Stopping and resuming

| Case | What happened | Result |
| --- | --- | --- |
| `kill -9` of the engine while the agent was working | The agent tool kept running on its own. `neuromesh resume` stopped it, recorded the lost turn with its usage unknown, and finished the task with a fresh "continue" turn. | pass |
| Ctrl-C while the agent was working | The run stopped cleanly with status `interrupted` and the agent tool gone. Resume finished it: `initial:cancelled → continue:done`. | pass |

`evals/kill-resume.ts` repeats both checks.

## What changed because of M1

- **A crash used to lose the in-progress turn.** The first `kill -9` test resumed
  with a fresh "initial" turn, because the killed turn was never recorded. Every
  turn is now written to the run state when it starts, so resume records it as
  cancelled (tokens unknown) and the next turn checks the files for half-done work.
- **Git refuses an exclude rule for a path it already ignores.** This broke the
  diff when `node_modules` was copied into the worktree. Only paths git does not
  ignore are excluded now.

## Observation for later milestones

Even these small tasks took 160k to 940k tokens per run, most of them cache
reads. The fixed cost of an agent session (about 16k tokens for Antigravity,
from M0) is a small part of that; most comes from the agent reading files and
re-sending its growing context on every tool call. This is why the team design
gives workers coarse tasks rather than many small ones.
