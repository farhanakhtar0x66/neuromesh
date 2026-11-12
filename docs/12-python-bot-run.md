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

Two more, found when the run was read against the earlier research and
published work (next section):

7. **The adviser gets what the worker observed.** The handoff strips the
   worker's reasoning on purpose, and with it went the worker's report that
   the package could not be installed. Commands the worker ran and their
   output, and its "blocked" note, are facts and go to the adviser; its
   theories still do not.
8. **A small advice packet.** 75% of the advice turn's cost was its own input
   (two 8,000-character diffs, the failures, and the tool's setup), not its
   answer. The earlier research capped this handoff at 2,000 tokens; the port
   did not keep the cap.

## What the earlier research and published work say

From the earlier research (`neuromesh-old-learn`):

- **The takeover's reset is the M3a design used outside what it was measured
  on.** M3a restores the baseline and hands the expert only the failed patches
  and errors. It was measured on one-patch tasks of 269 and 10,159 source
  tokens, where a reset loses nothing. On a new program the reset throws away
  the whole build. The no-chat handoff stays; the reset does not (change 2).
- **Every delegated turn has a fixed cost** (17,500 tokens per Codex turn
  then). In this run an Opus turn with write tools started at 25,800 tokens
  before any work. So few, large turns; this run had nine.
- M1 (context packet) and M2 (stagnation breaker) are in the engine and had no
  part here: there was no repository to slice, and the breaker watches the
  checks, which were green while testing nothing (change 3).
- M4 (contract-first parallel work) and the routing ideas apply to large
  changes in existing code, not to this failure.

From published work (figures as reported there, several second-hand):

| Source | Finding | Bears on |
| --- | --- | --- |
| Anthropic, the advisor strategy (2026) | A cheap model runs the whole job and consults a stronger one at decision points; the advisor never uses tools or writes the output, and its uses are capped | Change 2: the expert advises, never types |
| SWE-Edit (arXiv 2604.26102) | A stronger editing model added 0.4 points of resolve rate at 5.8 times the editor cost | Change 2: typing does not need the expert |
| Strong-weak collaboration study (arXiv 2505.20182) | A plan or an answered question for the task at hand lifts the weak model and is worth its cost; repo-wide context and repeated weak attempts are not | Keep the spec turn; make advice a pointed answer |
| Why do multi-agent LLM systems fail? (arXiv 2503.13657) | Failures fall into specification, information lost between agents, and missing or wrong verification; better role prompts alone did not remove them | This run had one of each: causes 6, 1 and 4, 2 and 3 |
| SetupBench (arXiv 2507.09063) | Agents set up a repository's environment correctly 39% to 57% of the time | Change 1: the engine installs, not the worker |
| Routing and cascading (arXiv 2410.10347), SWE-Router | Escalating only after a failed test does poorly; reading the first few cheap turns decides better. Savings measured on visible tests overstate | Change 1 (act on the first "blocked" report) and change 3 |
| Review overcorrection; Refute-or-Promote (arXiv 2604.19049) | Model reviewers flag correct code; one real run removes findings that argument does not | Change 5 |
| Harness comparisons (2026) | The same model costs about twice as much in one harness as in another, mostly fixed overhead per turn | Fewer turns; change 8 |

None of these reports a team at a third of the frontier model's cost with
equal results on whole-program builds. The advisor strategy's own coding
figure is 12% cheaper with a mid-priced executor. A third is a target to
measure, not a published result.

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

## Built (2026-11-12)

The eight changes are in the engine as F54 to F63, each switchable with
`--disable <key>` (`docs/10-features.md`):

| Change | Features |
| --- | --- |
| 1. A working environment | F54 `work-env`, F55 `worker-network`, F56 `env-blocked` |
| 2. No expert rebuild | F60 `no-rebuild` |
| 3. A check that tests nothing is not a pass | F57 `hollow-checks` |
| 4. Real output as evidence | F58 `acceptance-runs` |
| 5. Only reproduced findings count | F59 `reproduced-findings` |
| 6. Facts before the spec | F63 `scout-facts` |
| 7. The adviser gets what the worker observed | F61 `advice-facts` |
| 8. A small advice packet | F62 `advice-cap` |

`factory-opus-luna`'s expert budget went from $1.00 to $0.60 (estimated):
the spec, one advice turn and a short in-place fix, with a running expert turn
stopped at the limit.

Checked with the fake backend (19 new tests, 154 in all) and two replays with
no model calls on the worker's real code from this run:

- Its round-2 version, whose check "passed" with four converter tests skipped
  ("install requirements.txt to run converter tests"), is now a failed check
  that says why.
- With the engine's environment, `beautifulsoup4` installs from its
  requirements.txt, all 13 tests run, and the one real bug (`** bold **`)
  shows as an ordinary failing test, which a repair round handles.

Not yet checked live. The role tests come next, then a rerun of the request.
