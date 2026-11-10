# Neuromesh

A multi-agent coding engine built like a factory floor.

On a motorcycle assembly line, one expert directs several workers. The workers
do the assembly; the expert steps in only when there is a problem, and otherwise
saves their energy. Today most people use AI the other way round: the one expert
does every tedious job. Neuromesh fixes that. One heavy model plans and handles
the hard parts, cheap fast models (or local ones) do the work, and everything is
checked before it leaves the line. The aim is the same result as a single
frontier model at a fraction of the cost.

**Status (2026-11-11): milestone M0 (backend conformance) is done. M1 is next.**

This is a fresh start. The earlier attempt lives in `neuromesh-old` and is kept
as a read-only archive.

## Using it

Needs Node 24 or newer and git. Model access comes from the CLIs you are already
logged in to (`agy`, `claude`, `codex`).

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

The run works in its own copy of the repository, runs the project's own checks
before and after the agent, and gives the agent another turn if they fail. Your
files are untouched until you apply the result:

```bash
neuromesh diff
```

```bash
neuromesh apply
```

Other commands: `neuromesh status`, `neuromesh resume` (after Ctrl-C, a crash or
a subscription limit), `neuromesh discard`, `neuromesh presets`,
`neuromesh doctor`. The default preset is `solo-flash` (one Gemini 3.8 Flash
agent); pick another with `--preset`.

## Read in this order

1. [docs/00-lessons-from-old-attempt.md](docs/00-lessons-from-old-attempt.md):
   what went wrong before and what is worth keeping.
2. [docs/01-engine-architecture.md](docs/01-engine-architecture.md): how the
   engine is meant to work.
3. [docs/02-v0.1-plan.md](docs/02-v0.1-plan.md): milestones, the task suite and
   the conditions for calling v0.1 done.
4. [docs/03-m0-results.md](docs/03-m0-results.md): what the three backends can
   and cannot do on this machine.

## Decisions so far

- Models run on existing subscriptions through the Antigravity (Gemini), Claude
  Code and Codex command-line tools. No paid API keys.
- Gemini is used the most; Claude and GPT the least.
- The engine is written in TypeScript and has no user interface of its own. It
  prints a stream of JSON events that a TUI can read later.
- "Working" is judged on a suite of 15 to 20 small coding tasks with hidden
  tests, against a single-model baseline.

## Source material

- Old repository: `github.com/farhanakhtar0x66/neuromesh-old` (the
  `neuromesh-research` branch holds the useful research).
- Notes: `~/Projects/neuromesh-old-learn/` (`neuromash_architecture_notes.md`,
  `multi_agent_swe_architecture_landscape.md`, `nmr-handoff.md`).
- TUI reference for later:
  `~/Downloads/Installers and Archives/NEUROMESH_SIGNAL_STUDIO_DESIGN_PACK/`.
