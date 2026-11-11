# Neuromesh working rules

Read `docs/02-v0.1-plan.md` before starting work. It says which milestone is
current and what "done" means for it.

- Build the engine only. No TUI work until the v0.1 exit criteria hold.
- Models are reached only through the installed CLIs in their documented
  headless modes (`agy -p`, `claude -p`, `codex exec`). Never drive
  a tool through an internal protocol, and never add paid API calls.
- The default worker is GPT-6 Luna through Codex (cheapest measured, since
  2026-11-11). Keep the expert models (GPT-6.1 Sol, Claude Opus) to a minimum.
- Experiments with model, effort and team combinations go on the
  `neuromesh-research` branch; `main` holds what has been measured to work.
- Live model calls spend the owner's subscription quota. Use the fake backend
  for engine tests. Say before starting anything that will make more than a few
  live calls.
- A milestone is finished when its command works on real subscriptions, not
  when tests pass on the fake backend.
- Keep engine failures (crash, hang, lost run, leftover process) separate from
  task failures (the model wrote wrong code).
- An unknown number is recorded as unknown, never as 0. API-equivalent cost is
  always labelled as an estimate.
- No hashes, provenance tables, evidence vaults or long worklogs.
- `neuromesh-old*` folders in `~/Projects` are a read-only archive. Do not edit
  or repair them.
- TypeScript strict mode, run directly by Node (no build step), no runtime
  dependencies unless a milestone needs one, no agent framework.
- `npm test` and `npx tsc --noEmit` must pass before work is called done.
