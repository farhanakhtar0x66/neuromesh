# M0 results: backend conformance

Run on 2026-11-11 on this Mac with `node src/cli/main.ts doctor`. Each backend
got seven small live calls on its cheapest model.

## Result

| Probe | Antigravity 1.5.5 (Gemini 3.8 Flash low) | Claude Code 2.1.319 (Haiku 5.5) | Codex 0.165.0 (default model, low effort) |
| --- | --- | --- | --- |
| Answer in a fixed JSON shape | pass | pass | pass |
| Reports usage | pass | pass | pass |
| Read-only mode cannot write | pass | pass | pass |
| Write a file | pass | pass | pass |
| Run a shell command | pass | pass | pass |
| Resume a session | pass | pass | pass |
| Stays inside its folder | **no** | **no** | pass |
| Cancel stops everything | pass | pass | pass (after a fix, see below) |
| Bad request fails with a message | pass | pass | pass |
| Cost of starting a session (input tokens) | about 16,400 | about 34,200 (almost all cached) | about 16,500 (about 3,000 fresh) |

All three are usable for every role. Gemini CLI is not: see the first finding.

`.neuromesh/conformance.json` holds only the most recent doctor run. The table
above combines one full run with a later cancel-only run made after the fix.

## Findings

**1. Gemini CLI no longer works on an individual Google account.** It stops at
login with "This client is no longer supported for Gemini Code Assist for
individuals" and points to Antigravity. So Antigravity (`agy`) is the only route
to Gemini on this subscription. Gemini CLI has no adapter.

**2. Antigravity can run commands headlessly, but not the way its flags
suggest.** This is the blocker that stopped the old attempt, now understood:

- `--mode accept-edits` writes files but refuses every shell command, because
  headless mode cannot ask for approval.
- `--sandbox` makes commands run, but sandboxed commands cannot write inside
  the working folder at all (`touch a.txt` fails with EPERM), while they *can*
  write in the home folder. That is useless for building or testing code.
- What works: a session-only allow rule, `--settings
  '{"permissions":{"allow":["command(*)"]}}'`. It is never saved to the user's
  settings. The adapter can also pass a narrower list of programs.

**3. A refused action in Antigravity wipes the answer.** The run still ends with
status `SUCCESS`, but the response is empty and a `denied_actions` list appears.
The adapter treats that as a permission stop.

**4. Antigravity's plan mode costs an extra turn.** In read-only (`plan`) mode
it first writes a plan file into its own data folder, then answers.

**5. Only Codex confines the agent.** In write mode, Antigravity and Claude Code
ran a command that created a file in the home folder. Codex's sandbox refused
it. For v0.1 this means a worker on Antigravity or Claude Code has the same
reach as the user who started it. The engine's diff scope check catches stray
changes inside the repository, not outside it. Still to try: Claude Code's own
sandbox setting, and wrapping Antigravity in a macOS sandbox profile that allows
the worktree only.

**6. Codex runs commands in a separate process group.** Cancelling Codex left
the command it had started still running. The process runner now tracks every
descendant of the tool while it runs and stops those as well. All three backends
pass the cancel probe with this in place, and there is a unit test for it.

**7. Starting a session is never free.** Roughly 16,000 to 34,000 input tokens
before the agent has done anything. This confirms the old measurement (about
17,500 on Codex) and the design rule that follows from it: hand out coarse
tasks, and send small requests to a single worker.

**8. Useful extras that the tools report.**

- Claude Code reports how much of the 5-hour and 7-day subscription windows is
  used, on every call. The adapter records it, which gives the engine a way to
  slow down or pause before a limit is hit.
- Claude Code reports an API-equivalent cost per call.
- Claude Code reports the model that actually answered. In one early manual
  call, asking for the alias `haiku` was answered by `claude-sonnet-5-5`, so
  presets use full model ids and the adapter records the real one.
- Antigravity's error for an unknown model lists the models it accepts.

## Models available

Antigravity lists: Gemini 3.8 Flash (high, medium, low), Claude Sonnet 4.6,
Claude Opus 4.6 (thinking), GPT-OSS 120B. There is no Gemini model heavier than
Flash, but the Google subscription itself offers a heavy model (Claude Opus 4.6)
through Antigravity. That makes a preset possible that uses no Claude or ChatGPT
quota at all.

Not yet run live: any heavy model (Opus 5.5 on Claude Code, Opus 4.6 on
Antigravity, the high Codex tiers). The probes test the plumbing, which does not
depend on the model, but the heavy model ids get their first live call in M1.

## What M0 built

- `src/backends/`: the backend interface, a process runner with timeout, cancel
  and process-tree cleanup, adapters for Antigravity, Claude Code and Codex, and
  a fake backend for tests.
- `src/doctor/`: the conformance probes.
- `src/cli/main.ts`: the `doctor` command.
- `test/`: 21 unit tests, none of which call a model.

Commands:

```bash
npm test
```

```bash
npm run doctor
```
