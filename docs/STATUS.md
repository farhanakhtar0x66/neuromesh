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
| M6 hardening and release | Done 2026-11-11: E1 to E5 hold (`docs/06-v0.1-results.md`), tagged `v0.1.0`. Work continues on `neuromesh-research` (experiments: brief engine, screen check, Opus as lead engineer) and `neuromesh-testing` (usage log of real runs). |

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
9. **E1 in progress:** `e1-final-1..3`, three full-suite runs of the final
   `factory-wf` (ladder, tester on), started 2026-11-11 10:47 IST. The earlier
   `e1-factory-wf-1..3` runs were stopped at about 5/25 because they measured an
   older configuration; none of their tasks had failed. To continue E1 in a new
   session, rerun the same three commands: finished tasks are skipped.

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
12. **Tester value, measured.** Hard tasks with a Flash-low worker: 3/4 without
    the tester (`esc-check-flash-low`), 4/4 with it
    (`esc-check-flash-low-tester`), both with zero expert tokens.
13. **Hidden-check ambiguity again.** `hard-js-cache` required a specific count
    for a call that joins a load in progress, which the prompt never states.
    The check now accepts hit, miss or neither (at most once); results
    re-scored. The engine survived the Claude Code session quitting: evals run
    detached and kept going.
14. **Gemini has limits too.** At 11:57 IST all three parallel E1 runs paused:
    Antigravity said "Your AI credits balance is too low to continue" for both
    Gemini rungs. The engine paused cleanly (zero engine failures, no lost
    work). E1 now runs one eval at a time through `evals/until-done.ts`, which
    waits out cooldowns between quota windows:

    ```bash
    node evals/until-done.ts --preset factory-wf e1-final-1 e1-final-2 e1-final-3
    ```

    It was started detached at 11:58 IST (log in the session scratchpad). If it
    is not running, start it again with the command above; finished tasks are
    skipped. After E1 finishes, re-score with
    `node src/cli/main.ts eval recheck e1-final-1 e1-final-2 e1-final-3`
    (a running eval overwrites re-scores made while it runs).
15. **Cost in one unit (2026-11-11, afternoon).** Evals are now priced at API list
    prices (`src/usage/prices.ts`). GPT-6.1 Sol alone costs about $0.10 per hard
    task; `factory-wf` costs $0.70 to $0.82. The factory wins only on subscription
    quota, not on API cost. See "Cost in one unit" in `docs/06-v0.1-results.md`.

16. **GPT-6 Luna is the cheap worker the prices predicted (2026-11-11, 13:30 to
    14:00 IST).** Luna alone (`solo-luna`, Codex, medium effort): 25/25 on the
    full suite, estimated $0.004 per task, 22 minutes for all 25. Hard tasks:
    4/4 twice at $0.004 against Sol alone at $0.102. `factory-luna` (Luna low,
    then high, Luna tester, Sol expert): hard 4/4 at $0.012 per task (12% of Sol
    alone), large 1/1 at $0.094 of which the Sol plan is $0.058. The Luna tester
    rejected two changes that passed the visible checks; both were fixed. So the
    cost goal is met on this suite, and the suite is too easy to tell models
    apart: a harder benchmark is the main missing piece. Evals:
    `hard-solo-luna`, `base-solo-luna`, `hl-factory-luna`.

17. **Default preset is now `factory-luna` (owner's decision, 2026-11-11 14:10
    IST).** The Gemini E1 (`e1-final-1..3`) was stopped unfinished: 10 tasks
    passed, 0 engine failures. E1 now runs on the Luna team as `e1-luna-1..3`.
    Experiments with models and efforts go on the `neuromesh-research` branch.
    Before any TUI work the owner wants one more test: build a typing-speed
    test for the terminal with three prompt styles (one line, detailed, a .md of
    steps) and beat a single Claude Opus 5.5 medium agent on cost and quality.
    A deterministic brief engine that improves the prompt and picks the
    staffing comes first.

18. **The TUI, redesigned to the owner's sketch (2026-11-12).** Layered panes in
    the terminal's own colours (or transparent), projects and recents on the
    left, one box per agent in the middle with verbosity none/medium/full, the
    agent graph, context and changes on the right, mouse everywhere, and the
    final report rendered as markdown. Normal mode asks before the plan and the
    expert (F39); Turbo goes ahead. Features F32 to F47; `docs/11-tui.md`.
    Checked with the demo preset only; no live run through the TUI yet.
    Then its own look (the neuromesh-dark theme, titled frames instead of
    opencode-like shaded panels) and follow-ups that continue a session from
    the earlier run's result (F48, F49).

## Next steps

1. E1 on the Luna team: `node evals/until-done.ts e1-luna-1 e1-luna-2 e1-luna-3`
   (run from a frozen copy of `main`). Then `eval recheck` the three, fill the
   E1 to E3 rows in the results, tag v0.1.0.
2. On `neuromesh-research`: the brief engine, then the typing-app test against
   Opus 5.5 medium.
3. A harder benchmark: tasks Luna fails alone, so that escalation and the tester
   can be shown to earn their cost.
4. Large requests: the Sol plan is most of the cost. Try a Luna-high planner, or
   plan only above a higher size bar.
