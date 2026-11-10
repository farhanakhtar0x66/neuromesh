# Lessons from the old attempt

Written 2026-11-11 from a read of `neuromesh-old` (all local worktrees and all
seven GitHub branches), the `neuromesh-old-learn` vault, and the research
handoff. This is the reason the new plan looks the way it does.

## What the old attempt was

Five weeks of work (3 Oct to 10 Nov 2026), 45 worklog entries, and roughly:

| Part | Size | Where |
| --- | --- | --- |
| Product (TUI + controller) | 26,685 lines of Rust | `prototypes/terminal-lab/src` |
| Research kernel | 10,651 lines of Rust | `research/offline-core` |
| Research harness | 4,928 lines of Python | `research/harness` |

It never completed one run where a prompt went in and accepted, working code
came out of the team. Every "competition" attempt is recorded as failed or
incomplete.

## Why it failed

**1. There was never a walking skeleton.** The TUI, session recovery, token
accounting, evidence storage and four UI redesigns were all built before a
single end-to-end task had succeeded. Nothing was ever proven small and then
grown.

**2. It plugged into the other tools at the wrong layer.** Codex was driven
through its app-server JSON-RPC protocol with a "fail closed" rule: any of 59
notification types, or any server request, halted the run. Live trials v1 to v5
all died on plumbing before a model did any work:

| Trial | What killed it |
| --- | --- |
| v1 | Error detail was stripped, cause unknown |
| v2 | macOS wiped `/private/tmp` before the run |
| v3 | The launcher's `umask` changed file modes, so digests no longer matched |
| v4 | A harmless background status notification was treated as fatal |
| v5 | A one-second clock drift and a non-empty environment list |

Antigravity in headless mode refused file writes and commands outright, so the
"worker" role could not work at all.

**3. Ceremony outgrew the product.** SHA-256 pin tables, frozen manifests,
"consumed claims", 53,560 preserved evidence entries and a separate verifier
agent, all to protect measurements taken on a 269-token fixture. The rigor was
real, but it was guarding results that did not exist yet.

**4. The benchmark was too big for the budget.** The test was "build a whole
typing app" on subscription quota. Both the single-model arm and the team arm
hit quota limits before finishing. No comparison ever completed.

**5. Direction changed about every week.** Python CLI, then a Rust app with its
own provider code, then a front end over OpenCode, then a native-runtime team,
then a shader UI, then a research branch.

**6. No resume.** When a run hit a quota limit it was simply lost.

## What the research branch actually showed

The research branch is the part that worked, and its ideas are worth keeping:

| Idea | What it does | Result on the test crate |
| --- | --- | --- |
| M1 context packet | Give the worker only the target code and its type dependencies, found without any model call | Prompt written by us shrank 87.85% (1,414 vs 11,639 tokens) |
| M2 stagnation breaker | Stop a worker that repeats a failed state or makes no progress twice | Works offline |
| M3a failure autopsy | On escalation, hand over the task, the failed patches and the exact errors, and none of the failed worker's chat | Works offline |
| M4 contract-first parallel | Freeze the public interface, run workers on separate files, find which patch pair broke integration | Two workers overlapped 40%, wall time down 23% |

Three honest limits on those results:

- It was Rust only, on one 10-file crate, with one pair of runs per trial.
- The workers produced one patch in one turn. They were not agents that explore,
  edit and test.
- The "universal" provider layer was only ever tested against fake peers.

**The most important number is one the old notes underplay.** Every CLI turn
carried about 17,500 tokens of built-in overhead from the tool's own system
prompt. So in the parallel trial, the two cheap workers together used *more*
tokens than the single expensive control (37,455 vs 30,711). The trial won on
model tier and wall time, not on token count.

What this means for the new design:

- Each delegation has a fixed cost. Delegating small things loses.
- Tasks handed to workers must be coarse (a real chunk of work), not tiny.
- The saving comes from moving work to a cheaper model tier, so that is what we
  measure.

## What we keep and what we drop

Keep (as ideas, rewritten simply, not as code):

- Fresh context for every worker, with a brief instead of the conversation.
- The stagnation breaker and the failure autopsy.
- Disjoint ownership for parallel work.
- Honest accounting: an unknown number stays "unknown", never 0.
- A fake backend so engine tests cost no quota.

Drop:

- Driving tools through internal protocols. Use their documented headless modes.
- Cryptographic provenance, frozen manifests, evidence vaults.
- Building any TUI before the engine works.
- Whole-app builds as the benchmark.
- A separate "verifier agent" for our own development process.

## State of the old repository (checked 2026-11-11)

Nothing appears to be lost. GitHub `farhanakhtar0x66/neuromesh-old` has seven
branches:

| Branch | Tip | What it is |
| --- | --- | --- |
| `neuromesh-research` | `426cce3` | Research kernel, harness and research docs. Intact. |
| `main` | `c5b24d1` | Old product plus the research integration. PR #4 merged `codex/section5-production-integration` into it on 10 Nov. |
| `codex/section5-production-integration` | `79b33d9` | Already merged into `main`. |
| `neuromesh` | `a34924d` | Old product with the "shader command center" TUI. |
| `design/neuromesh-tui-system-20261022` | `a92a3b1` | Early TUI design skill. |
| `phase-1/dependable-real-team` | `b090e65` | Early checkpoint. |
| `phase-0/protect-working-baseline-2026-10-27` | `ecd6f07` | Early checkpoint. |

Things to know:

- `neuromesh-research` and `main` have diverged (research is 9 commits ahead and
  8 behind). The research branch is the clean copy of the research work.
- The local clone's `main` is stale (`79add57`); GitHub's `main` is 8 commits
  ahead of it.
- Two things exist only on this Mac: the uncommitted routing work in the
  `phase-2/macos-adaptive-routing` working tree, and the branch name
  `local/opencode-core` (its commit is already inside `neuromesh`).
- The rename from `neuromesh` to `neuromesh-old` also renamed files inside the
  old checkouts (for example `src/neuromesh-old/` and an uncommitted
  `neuromesh.rs` → `neuromesh-old.rs` in the research worktree). The GitHub
  copies are not affected. The old local checkouts should be treated as a
  read-only archive, not repaired.
