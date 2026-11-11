# Status and handoff

Kept current after every meaningful step so that work can resume in a new
session if usage runs out. Read this first, then `docs/02-v0.1-plan.md`.

## Standing instructions from the owner (2026-11-11)

- Work through M2 to M6 without asking for confirmation.
- Commit and push to `origin main` (private repo `farhanakhtar0x66/neuromesh`)
  often, including between milestones.
- Workers and testers: Gemini 3.8 Flash through Antigravity (`agy`). Gemini quota
  is plentiful; use it for all development runs.
- Expert (orchestrator, escalation) model, in this order (updated 2026-11-11):
  1. `gpt-6.1-sol` through Codex: medium effort to plan, high effort for escalations
  2. Claude Opus 5.5 at medium effort through Claude Code, only if Sol is exhausted
- Claude 4.6 through Antigravity is out: past a small free quota it needs paid
  "AI Credits". Its presets were removed.

## Where things stand

| Milestone | State |
| --- | --- |
| M0 backend conformance | Done. See `docs/03-m0-results.md`. |
| M1 single agent, prompt to applied diff | Done. 5/5 live tasks, both kill and Ctrl-C resume pass. See `docs/04-m1-results.md`. |
| M2 task suite and baselines | 20 tasks in `evals/tasks`, `neuromesh eval` done. `base-solo-flash` running. `base-solo-opus46` paused after 5/5 passes: Opus 4.6 on Antigravity hit its individual quota after ~600k tokens; rerun the same command to continue once it resets. |
| M3 orchestrator and workers | Done. Live: factory 4/4 on multi-part tasks. |
| M4 tester, repair, escalation | Done. Advice-then-takeover escalation, expert budget, tester policy. Live escalation check running (`esc-check-flash-low`). |
| M5 intake and parallel work | Done. Worker-first intake; live 4-task plan on the large shop ran two tasks in parallel (`large-factory-wf-split`). |
| M6 hardening and release | In progress: E1 runs, results document, README. |

## How to resume

```bash
cd ~/Projects/neuromesh && git pull && npm install
```

```bash
npm test && npx tsc --noEmit
```

Live checks (spend Gemini quota only):

```bash
node src/cli/main.ts eval --preset solo-flash --tasks js-slugify-bug,rust-roman --name smoke
```

```bash
node evals/kill-resume.ts --signal SIGKILL
```

Run state lives in `~/.neuromesh/projects/<repo>-<id>/runs/`; eval output in
`~/.neuromesh/evals/`.

## Eval commands in use

```bash
node src/cli/main.ts eval --preset solo-flash --name base-solo-flash
```

```bash
node src/cli/main.ts eval --preset solo-opus46 --name base-solo-opus46
```

```bash
node src/cli/main.ts eval --preset factory --kinds multi --name try-factory-multi
```

```bash
node src/cli/main.ts eval compare base-solo-flash base-solo-opus46 try-factory-multi
```

Rerunning an eval command with the same `--name` continues it; tasks already
finished are skipped.

## Findings so far (2026-11-11)

1. **Claude 4.6 on Antigravity has a small quota.** Opus 4.6 stopped after 5
   tasks (about 600k tokens) with "Individual quota reached ... Resets in
   4h55m". Sonnet 4.6 shares the same pool. The expert really is the scarce
   resource, as the factory idea assumes.
2. **Gemini 3.8 Flash alone is strong on the standard tasks** (all passes so far
   apart from two Gemini 503 outages). The standard suite cannot show a team
   advantage, so four hard tasks were added (`hard-*`), each with a hidden check
   validated against a reference implementation.
3. **Planning costs nearly as much expert effort as doing small tasks.** On the
   four multi-part tasks the `factory` preset passed 4/4 with about 80k expert
   tokens per task (planning only), against about 120k for Opus doing the whole
   task alone. Every plan was a single task. The tester added about half the
   worker tokens and found nothing. Direction: worker first, with the expert
   only on escalation or genuinely large requests. To be confirmed on the hard
   tasks before changing the default.
4. **Python hidden checks were broken** (wrong import path) until commit
   `310fdc2`; evals run before that were re-scored with `neuromesh eval recheck`.
5. **The CLIs sometimes hang after finishing.** Antigravity and Codex printed
   their final event and then did not exit, so turns ran into the 30-minute
   limit and were recorded as timeouts. Fixed in `507148f`: the engine stops a
   tool 10 seconds after its final event. Together with network drops to
   Google's API (now retried once), this caused every "failure" of the first
   `solo-flash` baseline that was not a broken hidden check. Those tasks are
   being rerun with `--rerun`.
6. **Two hidden checks of mine were wrong** (Python import path; an inventory
   query that matched). Both fixed and re-scored. Hard-task checks were each
   validated against a reference implementation for that reason.
7. **Quota, as seen by the owner on 2026-11-11.** After a day of evals, Gemini
   (Antigravity) showed 87% of its weekly limit left; ChatGPT Plus (GPT-6.1 Sol)
   showed 23% weekly left. Expert quota is the binding constraint, so the expert
   baseline stays small (`hard-solo-sol`, `large-solo-sol`) and Sol is otherwise
   spent only through the factory's advice and takeover.
8. **Final baselines (after removing infrastructure faults and test bugs).**
   Gemini 3.8 Flash alone: 20/20 standard, 4/4 hard, 1/1 large, about 8-12
   minutes and 0 expert tokens per hard task. GPT-6.1 Sol alone: 4/4 hard, 1/1
   large, 1-2 minutes and 22-42k fresh expert tokens per task. On this suite
   the cheap worker is as capable as the expert, so the factory's job is to
   keep the expert idle, which worker-first routing does. Escalation has not
   been needed live; `esc-check-flash-low` runs the hard tasks with a weaker
   worker (Flash low effort) to exercise advice and takeover for real.
9. **E1 in progress:** `e1-factory-wf-1..3`, three full-suite runs of `factory-wf`.

Current engine choices for `factory-wf` (all measured above): worker-first
routing, plan only clearly large requests (and then split independent parts),
two-step escalation (advice, then takeover), expert budget 250k per run,
tester only when the project has no checks, and stall protection (10-minute
idle timeout, 10-second linger after a final event, one retry on network errors).
10. **Worker ladder (owner's request, from the research's tiered effort).**
    `factory-wf` now starts every task on Gemini Flash low and climbs to Flash
    high when stuck, before the expert is asked. Being measured as
    `ladder-hard` (hard and large tasks). The E1 runs started before the ladder
    and before the tester was turned back on; they measure reliability.
11. **The tester is back on.** A low-effort worker passed the visible checks
    with a wrong cache implementation (hidden tests failed) and nothing stopped
    it. The tester runs on Gemini, the cheap quota, so it stays on.
