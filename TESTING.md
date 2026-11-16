# Testing the Neuromesh beta

Thank you for trying it. The beta has one question to answer: **on your real
work, does the `cascade-claude` team get you results as good as Opus alone,
while using much less of your Claude plan?** Your runs and ratings are the
evidence. Fifteen minutes and three real tasks is already useful.

## 1. What you need

- macOS or Linux (Windows is untested), Node.js 24 or newer, git.
- [Claude Code](https://claude.com/claude-code) installed and signed in to a
  Claude plan (Pro is enough). Check with `claude --version`.
- A git repository you work in, ideally one with tests.

## 2. Install

```sh
curl -fsSL https://raw.githubusercontent.com/farhanakhtar0x66/neuromesh/neuromesh-testing/install.sh | sh
neuromesh --help
```

Run the install line again any time to update. Your repository is never
changed until you run `neuromesh apply`.

## 3. Check it works (free, then a few cents of quota)

```sh
neuromesh tui --preset demo     # the interface with a fake team: no quota spent
neuromesh doctor                # a few tiny live calls per installed tool
```

`doctor` ends by saying whether the default team is ready. Only Claude Code has
to pass; a FAIL for Codex, Antigravity or opencode does not matter here. If it
says Claude Code is not installed or not signed in, follow the line it prints
(install it, or run `claude` once and log in).

## 4. Do real work

In your repository:

```sh
cd your-project
neuromesh                       # the TUI; or, from the command line:
neuromesh run "<what you want>"
neuromesh diff                  # read what it did
neuromesh apply                 # keep it  (or: neuromesh discard)
neuromesh rate last 4 --usual "Claude Code with Opus"
```

In the TUI, press 1 to 5 once a run has finished to rate it.

**What to try** (a mix is best):

| Kind | Example |
| --- | --- |
| A small fix | "the date parser drops the timezone; keep it" |
| A feature across a few files | "add a --json flag to the export command" |
| A refactor | "move the retry logic out of client.ts into its own module, behaviour unchanged" |
| Something new | "a CLI that watches a folder and prints new files' sizes" |
| Something you think is hard | whatever you'd normally hand to Opus |

Write requests the way you normally would. Don't simplify them for the tool.

**Rating (1 to 5) compares the run with your usual way of working:**

| | |
| --- | --- |
| 5 | better than I'd have got my usual way |
| 4 | as good, and cheaper or faster |
| 3 | usable after small fixes |
| 2 | needed real rework |
| 1 | wrong or unusable |

`--usual` says what you compared it with (for example "Claude Code with Sonnet").

## 5. Watch your plan

Every tier uses your one Claude plan. While a run is going, an open Claude Code
session spends from the same five-hour window, so leave it idle if you want the
cost numbers to mean something. `neuromesh usage` shows your runs, their cost
and your ratings. A model that hit its limit waits; `neuromesh cooldowns`
shows which.

## 6. When something goes wrong

- **It stopped** (crash, Ctrl-C, closed terminal): `neuromesh resume`.
- **A feature misbehaves:** the error names it (for example `F102`).
  `neuromesh features` lists them; add `--disable <key>` to the command to run
  without it, and tell us which one.
- **It failed or did the wrong thing:** rate it 1 or 2. That is the most
  useful report there is.
- **A bug, or a run that went wrong:** run
  `neuromesh report last --note "what went wrong"` (use a run id instead of
  `last` for an older run). It writes one file,
  `~/.neuromesh/reports/<run-id>.md`, and prints where. The file holds your
  version, OS and Node version, the preset and models, how the run ended and
  which features failed, the run's timeline (what ran, which model, how long,
  tokens, which checks passed or failed), the agents' final reports, your
  request and your note. Code, diffs, file paths, names, emails, hosts and keys
  are taken out first, and the file says how many of each. It is cut to about
  30 KB, keeping the end of the run. Nothing is sent: read the file, then open
  <https://github.com/farhanakhtar0x66/neuromesh/issues/new> and paste it in
  or attach it. If your request itself is private, edit that part out first.

Two kinds of failure, so we can tell them apart:
- **Engine failure:** a crash, a hang, a lost run, a process left running. Always a bug.
- **Task failure:** the run finished but the code is wrong. A rating, not a bug.

## 7. What gets shared

On first start the TUI asks once whether to share run reports. If you say yes:

- **Shared:** preset and models, efforts, turns, tokens, time, estimated cost,
  how the run ended, checks, escalations, features that failed, your request,
  the agents' final reports, and your rating.
- **Never shared:** your code or diffs, file locations, or who you are; an
  install is a random id.
- **Read them first:** unsent reports wait in `~/.neuromesh/telemetry/outbox`.
- **Stop:** `neuromesh telemetry off`, `/settings`, or `NEUROMESH_TELEMETRY=off`.

If your request text itself is private, rate the run and turn telemetry off for
that one: `NEUROMESH_TELEMETRY=off neuromesh run "..."`.

## Known limits

- F101 (blind tests) is off by default; F100 is on, and F102 to F104 are on but have never fired. Your runs are how they get judged.
- Costs are estimates from API list prices.
- Agents are sandboxed on macOS only; elsewhere they work in a throwaway git
  worktree and nothing reaches your files until `apply`.
