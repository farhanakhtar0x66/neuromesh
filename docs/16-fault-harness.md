# The fault harness, and what it found

## Predictable or not

The defects of 2026-11-12 (the python-bot rebuild, the bookshelf budget cut,
the lost usage) were all of one kind: a turn ended in an unusual way while a
task was in an unusual state, and nothing said what should happen for that
pair. That kind is predictable. It can be found without a model call, by
giving every step every kind of ending and checking rules that must always
hold.

What is not predictable is what the models do: how much a worker writes, how a
subscription's quota weighs each model, whether a spec names the right
duplicate rule. That still needs live runs (docs 13 to 15).

## The harness

`evals/chaos.ts` runs the real engine against a fake backend
(`test/support/chaos.ts`). A seed fixes everything, so a failing seed replays:

    node evals/chaos.ts --seeds 2000            many seeds, on most of the cores
    node evals/chaos.ts --seed 1234 --trace 1   one seed, every event shown
    node evals/chaos.ts --kill 1 --seeds 400    the engine process is killed part way, then resumed

Each seed draws:

- a repository (1 to 4 files its check needs, paths with spaces, or no checks);
- a preset: 0 to 3 worker rungs, tester or none, expert as planner, as fixer,
  both or neither, a briefer or none, team or solo, 1 to 3 tasks at once,
  repair rounds, a dollar budget from $0.05 to none, up to 4 features off;
- a request (a fix, a new program, a typo, a refactor);
- what each agent turn does. Good work, wrong work, part of it, nothing,
  "blocked", "split", files outside its task. An error, a dropped connection,
  a quota limit, a revoked login, a model that does not exist, a hang, a crash
  in the adapter, an answer no parser can use, spending past the budget.
  Damage to the work folder: its own commit, a switched branch, deleted
  checks, the folder deleted, a stale git lock, a git repository started
  inside. A reviewer that passes, fails with a real or an empty finding, or
  deletes its copy;
- optionally an interruption at a random turn, or a kill of the whole engine
  process a moment after a random turn starts, followed by a resume.

## The rules every run must keep

- It ends, within a time limit and a turn limit, as finished, failed, paused
  or interrupted, with a reason, and never by throwing.
- A failure is the agents' ("agent"), never the engine's.
- The saved state matches what was returned; nothing is left in flight.
- A finished run has every task passed or failed, an outcome and a patch; if
  it says the checks passed, the check really passes on the result.
- No reviewer's copy is left behind; after a finished run no task folder or
  task branch is left.
- The person's own checkout is untouched: same commit, same branch, no changed
  files.
- No expert turn starts once the dollar budget is spent.
- A task starts only after what it depends on has merged.
- The event log starts and ends correctly, every started turn is recorded as
  finished, and the file on disk is whole (a kill may cost one line).
- When every agent does its work: the run finishes with passing checks, no
  task fails, and not one extra turn is spent (no repair, no review fix, no
  climb, no advice, no expert).
- The same after a kill and a resume: good agents still finish the work.

## What it found (first 320 seeds: 39 broke a rule)

| Defect | What a real run would have seen | Fix |
| --- | --- | --- |
| After the expert's fix and its one repair both failed, the checks step ran again without end. A `continue` sat before the `return`. | The run reruns the project's tests forever. | The branch is fixed; the compiler now rejects unreachable code (`allowUnreachableCode: false`). |
| Of two tasks built at the same time, the later was tested in a folder without the earlier one's merged work. | Correct work fails its checks, the worker repairs nothing, the expert is called in (about $0.47 of Opus in the seed) and the task is marked failed, while the merged result passes. | F75 sync-before-checks: other tasks' merged work is merged in before a task's checks, and the checks run again if another task merged meanwhile. |
| A backend adapter that threw ended the run. | "engine error", and a turn left open in the log. | F74 adapter-guard: a failed turn like any other. |
| The agent deleted its work folder, left a git lock, switched branch, or a tool ran `git init` inside the work. | "engine error: git add failed", or (nested repository, switched branch) the files silently missing from the result. | F73 heal-worktree, before and after every writing turn. |
| A team preset with no orchestrator. | Paused "for quota", forever. | A role with no model is not a quota limit: a worker takes the request. |
| A plan gave the expert a part in a preset with no expert. | The run failed. | The part goes to the top worker rung (F69). |
| A worker was offered "split" when nobody could split (no expert, or no budget for one). | A wasted turn, then a likely failed task. | The offer is made only while someone can do the dividing. |
| A kill could leave the last event line half written, and the next event was appended to it. | Two events lost to readers. | The log starts a new line first. |

Found by reading the process runner for the same class:

| Defect | What a real run would have seen | Fix |
| --- | --- | --- |
| A tool exited while a program it had started (a server left in the background, in a group of its own) still held its output pipe. The time limit could not stop it: the program was not in the list of descendants. | The turn waits for as long as the server lives. Checks and acceptance runs go through the same runner. | F76 leftover-stop: every program a turn starts carries a tag in its environment; once the tool has exited or was stopped, whatever carries the tag is stopped, and the turn ends even if the pipe stays open. |
| Git refused because another process held a lock for a moment. | "engine error". | The command is tried again (four times, up to 1.5 s apart). |

The four tool-output parsers were also fed 16,000 random event streams; none
threw.

## Where it stands

After the fixes: 1,200 ordinary seeds and 400 kill-and-resume seeds kept every
rule (about 4,500 agent turns). `test/chaos.test.ts` runs 20 ordinary and 8
kill seeds on every change; `test/reliability.test.ts` holds one test per
defect above.

This shows the engine keeps these rules against these faults. It does not show
there are no others. What the harness does not model yet:

- two runs on one repository at the same time (the git retry is the only
  cover);
- the person's repository changing during a run, and the apply step;
- a full disk, or a folder that cannot be written;
- follow-up runs, attachments, the ask-first questions;
- the real tools' own behaviour (only their parsers were fuzzed).
