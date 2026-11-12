# Changelog

## 0.2.0 (2026-11-12)

The TUI, and the first build for testers.

### The TUI

- `neuromesh` in a project folder opens it.
- **Look:** its own look, the `neuromesh-dark` theme with rounded, titled
  frames, or transparent. The big logo glimmers.
- **Panes:**
  - left: projects and recent sessions;
  - middle: one box per agent, at three levels of detail;
  - right: the team as a graph with each model's usage, what the agents'
    context was made of, the changes, and the cost.
- **Control:** mouse everywhere, and a key for everything.
- **Final report:** drawn as markdown, and read from its first line.
- **Follow-ups** continue a session from the earlier run's result.
- **Teams:** two favourites (Opus 5.5 lead with GPT-6 Luna workers; GPT-6.1
  Sol high with Gemini 3.8 Flash workers) and a Custom team builder.
- **`/connect`** signs in to Codex, Claude Code, Antigravity and opencode.

### Engine

- Normal mode asks before the plan and before calling the expert; Turbo goes
  ahead.
- opencode backend, so any model opencode knows works, API-key models included.
- Attachments, compaction, Claude's usage windows, worker reports as events,
  follow-up runs.

### Testing

- Run reports to the author, with consent (`neuromesh telemetry`), and the
  endpoint to receive them.
- `install.sh` for the testing build.
- Licensed under PolyForm Shield 1.0.0.

## 0.1.0 (2026-11-11)

The first working version: an engine that turns a request into a checked diff,
with cheap models doing the work and the expensive model kept for problems.

Default preset `factory-luna`: GPT-6 Luna workers and tester, GPT-6.1 Sol as
the expert. Exit run: 75/75 suite tasks over three runs, no engine failures,
about 1% expert share and an estimated $0.01 per task.

### Engine

- `neuromesh run` works in a git worktree outside your repository, runs the
  project's own checks before and after, and leaves a diff for
  `neuromesh diff` and `neuromesh apply`.
- Team runs: the expert plans clearly large requests into tasks with owned
  files; independent tasks run in parallel; merge conflicts are redone on top;
  a merged result that fails gets one integration fix from the expert.
- Escalation ladder: repair turns, then a stronger worker rung (Gemini Flash
  low, then high), then expert advice (read-only), then an expert takeover.
  "Stuck" is decided by the engine (stagnation breaker ported from the Rust
  research, repair limits, tester findings), never by a model.
- Tester: a cheap model reviews each change in a throwaway copy and sends
  concrete findings back to the worker.
- Per-run expert token budget; model fallback chains per role; quota cooldowns
  across runs; runs pause on a subscription limit and resume later.
- Reliability: whole process trees are stopped on cancel; tools that linger
  after their final event or go silent for 10 minutes are stopped; network
  errors are retried once; a crashed engine's in-progress turn is recorded and
  its orphaned agent stopped on resume.

### Backends

- Antigravity (Gemini 3.8 Flash), Codex (GPT-6.1 Sol and Terra) and Claude Code,
  driven only through their documented headless modes. `neuromesh doctor`
  checks each one.

### Measurement

- A 25-task suite with hidden tests (`evals/tasks`), `neuromesh eval`,
  `eval compare` and `eval recheck`. Results in docs/06-v0.1-results.md.

### Known limits

- Workers on Antigravity and Claude Code are not sandboxed to their folder.
- On this suite the cheap worker rarely gets stuck, so expert escalation is
  proven by tests and a few live runs rather than by large numbers.
- No user interface yet.
