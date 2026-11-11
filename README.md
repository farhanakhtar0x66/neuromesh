# Neuromesh

A multi-agent coding engine built like a factory floor.

On a motorcycle assembly line, one expert directs several workers. The workers
do the assembly; the expert steps in only when something goes wrong, and
otherwise saves their energy. Most people use AI the other way round: the one
expert does every tedious job. Neuromesh fixes that. Cheap, fast models do the
work, the engine checks every result by running the project's own checks, and
the expensive model is called only when a worker is stuck, and then first just
to give advice.

**Status: v0.1 (2026-11-11).** Results: [docs/06-v0.1-results.md](docs/06-v0.1-results.md).

## What v0.1 showed

On a 25-task suite with hidden tests (bug fixes, features, refactors, tools, and
four deliberately hard tasks), measured on subscriptions:

- Gemini 3.8 Flash alone passed **25 of 25**. GPT-6.1 Sol alone passed all the
  hard and large tasks it was given, 4 to 5 times faster, but its quota is the
  scarce one: after a day of runs ChatGPT Plus had 23% of its week left and
  Gemini 87%.
- The default preset, `factory-wf`, starts every request with a Gemini worker
  and keeps the expert idle unless the worker gets stuck. On this suite that
  means close to **zero expert tokens per task** at the same pass rate.
- Expert planning and parallel workers did not pay off at this task size: a plan
  cost the expert about as much as solving the task alone, and splitting a
  five-part task took four times longer. Planning is kept for clearly large
  requests only.

## Using it

Needs Node 24 or newer and git. Model access comes from the CLIs you are already
logged in to: `agy` (Antigravity, for Gemini), `codex` (ChatGPT) and `claude`
(Claude Code). Check them with `neuromesh doctor`.

```bash
npm install
```

```bash
npm link
```

Then, inside any git repository with at least one commit:

```bash
neuromesh run "make slugify trim leading and trailing dashes"
```

The run works in its own copy of the repository and never touches your files.
It runs the project's checks before and after, gives the worker repair turns
when they fail, and asks the expert for advice when the worker is stuck. When it
finishes, review and apply the result:

```bash
neuromesh diff
```

```bash
neuromesh apply
```

Other commands:

| Command | What it does |
| --- | --- |
| `neuromesh status` | List runs, or show one |
| `neuromesh resume` | Continue a run stopped by Ctrl-C, a crash or a subscription limit |
| `neuromesh discard` | Throw a run's changes away |
| `neuromesh presets` | List presets (which model plays which role) |
| `neuromesh cooldowns` | Models waiting for a subscription limit to reset |
| `neuromesh eval` | Run the task suite against a preset |
| `neuromesh doctor` | Check each model CLI with a few small live calls |

Useful options for `run`: `--preset`, `--solo` or `--team`, `--model` (worker
model), `--expert-budget <tokens>`, `--json` (events as JSON lines, for a future
user interface).

## Presets

| Preset | Expert | Worker | Use |
| --- | --- | --- | --- |
| `factory-wf` (default) | GPT-6.1 Sol: advice, takeover, large plans | Gemini 3.8 Flash | The factory floor: least expert use |
| `factory-luna` | GPT-6.1 Sol: advice, takeover, large plans | GPT-6 Luna, low then high effort | Lowest cost measured: 12% of Sol alone on hard tasks (API estimate) |
| `factory` | GPT-6.1 Sol plans every non-trivial request | Gemini 3.8 Flash | Plan first, with a tester |
| `google-only` | Gemini Flash high | Gemini Flash | No Claude or ChatGPT quota at all |
| `duo`, `trio` | GPT-6.1 Sol | Gemini Flash | No tester; or a GPT tester |
| `solo-luna`, `solo-flash`, `solo-sol`, `solo-codex`, `solo-claude` | | one model | Baselines. `solo-luna` passed all 25 suite tasks at about 4% of Sol's API cost |

Expert models fall back in order (GPT-6.1 Sol, then Claude Opus 5.5) when one
runs out of quota; a run pauses when none is left and resumes later.

## Read more

1. [docs/06-v0.1-results.md](docs/06-v0.1-results.md): the measurements.
2. [docs/05-engine-as-built.md](docs/05-engine-as-built.md): how the engine works.
3. [docs/STATUS.md](docs/STATUS.md): where work stands and how to resume it.
4. [docs/00-lessons-from-old-attempt.md](docs/00-lessons-from-old-attempt.md):
   why this is a fresh start.
5. [docs/01-engine-architecture.md](docs/01-engine-architecture.md) and
   [docs/02-v0.1-plan.md](docs/02-v0.1-plan.md): the original design and plan.
6. [docs/03-m0-results.md](docs/03-m0-results.md) and
   [docs/04-m1-results.md](docs/04-m1-results.md): the first milestones.

## Limits

- Workers on Antigravity and Claude Code are not sandboxed to their folder; work
  happens in a throwaway git worktree and you review the diff before applying.
- The suite is too easy: the cheapest model tried (GPT-6 Luna) passes all 25
  tasks alone. It cannot show a team beating one cheap model, or escalation
  earning its keep. See `docs/06-v0.1-results.md`.
- Token counts are the tools' own reports. API-equivalent cost is an estimate
  from list prices (`src/usage/prices.ts`); nothing is paid per token.
- No user interface yet; the engine prints a JSON event stream for one.
