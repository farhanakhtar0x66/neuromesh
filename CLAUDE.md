# Neuromesh working rules

Read `docs/02-v0.1-plan.md` before starting work. It says which milestone is
current and what "done" means for it.

- Build the engine only. No TUI work until the v0.1 exit criteria hold.
- Models are reached only through the installed CLIs in their documented
  headless modes (`agy -p`, `claude -p`, `codex exec`, `opencode run`). Never
  drive a tool through an internal protocol. Models paid per token (API keys)
  come only through opencode, which keeps the key (owner's decision,
  2026-11-12); their cost is real money and shown as the tool reports it.
- Testers' run reports (F52) are sent only with their consent, and never hold
  code, diffs, file locations or identity.
- The default worker is GPT-6 Luna through Codex (cheapest measured, since
  2026-11-11). Keep the expert models (GPT-6.1 Sol, Claude Opus) to a minimum.
- Branches: `main` holds what has been measured to work. `neuromesh-research`
  is for experiments, including unorthodox ones. `neuromesh-testing` is for
  real use: every `neuromesh run` is recorded in the usage log
  (`~/.neuromesh/usage/USAGE.md`) with the owner's rating, so presets are
  judged on real work, not only on the synthetic suite.
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
- Every feature or behaviour change added after v0.1 is registered in
  `src/features.ts` with an id (F01, F02, ...). Mark its code with a
  `// [Fxx key]` comment, gate it with `isOn("key")`, run optional ones through
  `optional()`/`inFeature()` so a failure is tagged with the id and switched off
  instead of crashing the run, and add `feature: "Fxx"` to its events. Errors,
  the event log and the usage log then point at the feature, and
  `--disable <key>` works around it. `NEUROMESH_FAULT=<key>` fails one on
  purpose to check the handling.
- The owner's Mac runs the `neuromesh-testing` branch for real work; their
  usage log (`~/.neuromesh/usage/USAGE.md`) is the main evidence. Do not run
  heavy live tests unless asked.
