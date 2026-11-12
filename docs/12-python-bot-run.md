# The python-bot run: why it cost three times Opus alone, and what to change

First real run through the TUI (2026-11-12, `factory-opus-luna`, usage-log
rating 3). Request: "create a python bot that scraps wikipedia and makes a .md
of articles and store them into my designated folder with images and all". The
owner ran the same prompt on Claude Opus 5.5 alone (`~/Extra/pykimd`).

Everything below comes from the run's own records
(`~/.neuromesh/projects/python-bot-2a740d51/runs/20261112-151045-0e5e`), the
solo session's transcript, and replays that made no model calls. Costs are
estimates at API list prices.

## What each side spent

| | Opus output tokens | Opus cost (est.) | Luna cost (est.) | Minutes | Owner saw |
| --- | --- | --- | --- | --- | --- |
| Opus alone | 25k | $1.48 | - | 16 (with two interruptions) | 3% of Opus quota |
| Neuromesh | 72k | $2.81 | $0.06 | 21 | 10% of Opus quota |

Neuromesh's Opus spending by turn:

| Turn | Output tokens | Cost | What it did |
| --- | --- | --- | --- |
| Spec and design | 5.3k | $0.16 | Chose the layout, the behaviour, and `beautifulsoup4` as the one dependency |
| Advice | 3.1k | $0.32 | Found that the converter tests never ran |
| **Takeover** | **63.2k** | **$2.33** | Threw the worker's code away and rebuilt everything |

83% of the Opus cost was the takeover. The quota percentage follows output
tokens more closely than the dollar estimate does (2.8x the output, 3.3x the
quota, 1.9x the dollars). How ChatGPT counts Luna's 3.2M tokens (95% cached
reads) against its quota is unknown.

## The chain of causes

1. **The worker could not install the dependency.** Codex's `workspace-write`
   sandbox has no network, and the system Python refuses `pip install`
   (PEP 668). Luna tried both, then a venv, and reported it honestly each time.
   The engine did nothing with that report.
2. **The check passed while testing nothing.** Luna made the converter tests
   skip when `bs4` is missing. The check went green with the main module never
   imported.
3. **The reviewer could not run the code either**, so its second "blocker"
   (text not escaped) was wrong: the escaping was already there. Its own
   reproduction was broken by a backtick in a shell string.
4. **A wrong finding called Opus in.** The advice was right about the cause
   (the tests never run) but told the worker to remove the skip and
   `pip install`, which the sandbox cannot do. Following it turned a green
   check red.
5. **A red check after advice means takeover, and takeover resets the folder**
   (`src/engine/run.ts`, the `escalate` step: `resetTo(task.worktree, task.base)`
   unless the checks pass). Opus started from an empty folder and, to get round
   the missing package, wrote its own HTML parser as well. The $1.00 expert
   budget did not stop it: the budget is only read before a turn starts.
6. **The result still shipped a bug.** The spec was written without looking at
   Wikipedia ("Math images become `$<alt LaTeX>$`"), the fixtures were written
   by hand to match the spec, and Wikipedia now sends MathML only. 46 tests
   pass; every formula comes out flattened (`$eiπ$`).

One environment fact (packages cannot be installed where the workers and the
checks run) was treated as a task failure at every step, and climbed the whole
ladder. `docs/08-build-test.md` already found that takeovers are the cost
cliff; this run shows what pushes a task off it.

## Replays (no model calls)

| Replay | Result |
| --- | --- |
| Codex sandbox, default | `curl pypi.org`: cannot resolve host |
| Codex sandbox with `-c sandbox_workspace_write.network_access=true` | HTTP 200; `python3 -m venv` + `pip install beautifulsoup4` works, writes still confined |
| Luna's last version (before the takeover) with `bs4` installed | 13 of 15 of its own tests pass; the 2 failures are one small bug (`** bold **`) |
| The same, run on four live articles | All four saved, 193 images, 45 s. Visible defects: infobox cells broken across lines, the bold spacing, no math |
| Neuromesh's final version on the same four | All saved, 77 s, math flattened, disambiguation warning never fires |
| Opus alone on the same four | All saved, 18 s, math correct, real footnotes |

So Luna's build was working code with three defects that anyone sees by
opening one output file. It needed an environment and a look at real output,
not a rebuild.

## What the target means in numbers

"About a third of Opus alone" is roughly 8k Opus output tokens for a build this
size. The spec turn used 5.3k. So the budget is the spec plus at most one short
advice turn, and no takeover, ever. On the typing-app builds the same preset
without a takeover cost $0.56 to $0.58 against $0.76 to $1.91 for Opus alone,
with equal or better scores, so the lower half of that range has been reached
twice; a third has not been measured yet.

## Changes, in order of effect

1. **A working environment before the first worker turn.** The engine makes a
   venv (or runs `npm install`) for the work folder, the checks use it, and
   workers in a new-program build get network inside the write sandbox. When a
   worker reports that something cannot be installed or reached, that is an
   environment failure: the engine fixes it or stops and says so. It is never
   sent to the expert.
2. **No expert rebuild.** The takeover never resets the folder. The expert
   answers with a diagnosis and exact changes for the worker to apply; a
   running expert turn is stopped when it passes the budget.
3. **A check that tests nothing is not a pass.** Skipped tests, zero tests and
   import errors are read from the check output and reported as "did not run".
4. **Real output as evidence.** The spec names two to four acceptance runs
   (real commands and what must be true of the result). The engine runs them,
   as it already runs terminal programs for the screen check, and the reviewer
   judges those results. The drop of the "no network at run time" standard for
   programs whose purpose is fetching belongs here.
5. **Only reproduced findings count.** The reviewer gives each blocker as a
   command or test that fails; the engine runs it; a finding that does not
   reproduce is dropped.
6. **Facts before the spec.** A cheap scout turn (Luna, with network) looks at
   the real data and the machine (interpreter, package tools) and hands the
   spec writer a short fact sheet, so the spec does not guess.

## Testing each role alone

The owner's suggestion: instead of only running the whole team, freeze a task
whose right answer is known and test one role at a time. This run supplies the
first case, and the replays above were its first use.

| Role | Frozen input | Scored against |
| --- | --- | --- |
| Spec | The request plus the fact sheet | Dependencies install here; no claim the facts contradict; output under 6k tokens |
| Builder | The spec from this run, working environment | The acceptance runs on four live articles (images local, math, infobox, footnotes, time) |
| Reviewer | Three builds with known defects (Luna's last, the final one, Opus's) | Which known defects it reports; how many findings fail to reproduce |
| Adviser | The stuck state from this run | Names the missing package; every step can be done in the sandbox |

A sweep is about ten Luna turns ($0.01 to $0.02 each) and, for the spec role,
one Opus turn ($0.16) per variant.
