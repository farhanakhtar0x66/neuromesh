// Feature registry. Every capability added on top of the v0.1 engine is listed
// here with an id, and every place in the code that belongs to it is marked
// with that id: a comment `[F04 screen-check]` at the code, a `feature` field
// on its events, and its id on any error it raises. So when Neuromesh goes
// wrong, the error, the event log and the usage log say which feature was
// involved, and the feature can be switched off to work around it:
//
//   NEUROMESH_DISABLE=screen-check,context-packet neuromesh run "..."
//   neuromesh run --disable F04 "..."
//   "disable": ["screen-check"] in a preset
//
// NEUROMESH_FAULT=<key> makes a feature fail on purpose, to check the handling.
//
// `neuromesh features` lists them all.

export interface Feature {
  id: string;
  key: string;
  name: string;
  added: string;
  /** Where it lives; the first file is the main one. */
  files: string[];
  what: string;
  /**
   * An optional feature that fails is switched off for the rest of the run and
   * the run goes on without it. A core one stops the run with a tagged error.
   */
  optional: boolean;
}

export const FEATURES: Feature[] = [
  {
    id: "F01",
    key: "brief-engine",
    name: "Brief engine",
    added: "2026-11-11",
    files: ["src/intake/brief.ts", "src/engine/run.ts (startRun)"],
    what: "Cleans the request, attaches documents it names, adds working standards and decides the staffing, with no model call.",
    optional: true,
  },
  {
    id: "F02",
    key: "spec-step",
    name: "Spec step",
    added: "2026-11-11",
    files: ["src/engine/run.ts (specStep)", "src/engine/prompts.ts (specPrompt)"],
    what: "A spec writer turns a short request for something new into features, behaviour rules, scope and a design.",
    optional: true,
  },
  {
    id: "F03",
    key: "expert-spec",
    name: "Expert spec and design",
    added: "2026-11-11",
    files: ["src/intake/brief.ts (staff)", "presets/factory-opus-luna.json"],
    what: "With an expert spec writer, every new program gets a spec and design before the workers start.",
    optional: true,
  },
  {
    id: "F04",
    key: "screen-check",
    name: "Screen check",
    added: "2026-11-11",
    files: ["src/checks/screen.ts", "src/engine/run.ts (screensFor)"],
    what: "Runs a full-screen terminal program in tmux, plays generic user actions and gives the screens to the tester.",
    optional: true,
  },
  {
    id: "F05",
    key: "tester-severity",
    name: "Blocker and minor findings",
    added: "2026-11-11",
    files: ["src/engine/run.ts (test step)", "src/engine/prompts.ts (VERDICT_SCHEMA)"],
    what: "The tester marks findings blocker or minor; a review with only minor findings lets the task merge.",
    optional: true,
  },
  {
    id: "F06",
    key: "review-memory",
    name: "Review memory",
    added: "2026-11-11",
    files: ["src/engine/prompts.ts (earlierReviews)"],
    what: "The tester sees its earlier findings and may not reverse them or fail a choice the spec leaves open.",
    optional: true,
  },
  {
    id: "F07",
    key: "review-only-merge",
    name: "No rebuild over review-only objections",
    added: "2026-11-11",
    files: ["src/engine/run.ts (test step)"],
    what: "Once the expert's advice was tried and the checks pass, remaining reviewer objections are recorded instead of sent to an expert rebuild.",
    optional: true,
  },
  {
    id: "F08",
    key: "lean-claude",
    name: "Lean Claude sessions",
    added: "2026-11-11",
    files: ["src/backends/claude.ts (claudeArgs)"],
    what: "Claude Code gets only the tools a turn needs, a short system prompt for read-only turns, and nothing from the user's setup.",
    optional: true,
  },
  {
    id: "F09",
    key: "codex-session-totals",
    name: "Per-turn Codex usage",
    added: "2026-11-11",
    files: ["src/engine/run.ts (once, perTurnAttempts)", "src/backends/codex.ts"],
    what: "Resumed Codex sessions report running totals; the engine records the change per turn.",
    optional: false,
  },
  {
    id: "F10",
    key: "work-created-checks",
    name: "Checks created by the work",
    added: "2026-11-11",
    files: ["src/engine/run.ts (checks step)"],
    what: "A project with no checks picks up the tests the work itself adds, and they gate the task.",
    optional: true,
  },
  {
    id: "F11",
    key: "usage-log",
    name: "Usage log",
    added: "2026-11-11",
    files: ["src/usage/log.ts", "src/cli/main.ts (finish, rate, usage)"],
    what: "Records every real run and the owner's rating in ~/.neuromesh/usage/USAGE.md.",
    optional: true,
  },
  {
    id: "F12",
    key: "context-packet",
    name: "Context packet",
    added: "2026-11-11",
    files: ["src/context/packet.ts", "src/engine/prompts.ts (taskPrompt, advisePrompt, escalationPrompt)"],
    what: "A repository map and the signatures most relevant to the request, built with no model call and put in the prompt, so agents explore less.",
    optional: true,
  },
  {
    id: "F13",
    key: "nm-tools",
    name: "Universal agent tools",
    added: "2026-11-11",
    files: ["src/tools/nm.ts", "src/engine/prompts.ts (toolsNote)"],
    what: "One shell tool any agent CLI can call: repository map, symbol bodies, ranked search, the project's checks in short form.",
    optional: true,
  },
  {
    id: "F14",
    key: "expert-patch",
    name: "Expert patch instead of rebuild",
    added: "2026-11-11",
    files: ["src/engine/run.ts (escalate step)", "src/engine/prompts.ts (patchPrompt)"],
    what: "When checks pass and only review findings remain, the expert fixes the named problems in the worker's tree instead of rebuilding from the start.",
    optional: true,
  },
  {
    id: "F15",
    key: "spec-cap",
    name: "Spec length cap",
    added: "2026-11-11",
    files: ["src/engine/prompts.ts (specPrompt)"],
    what: "Asks the spec writer for a compact spec, since its output is most of an expert spec turn's cost.",
    optional: true,
  },
  {
    id: "F16",
    key: "dollar-budget",
    name: "Expert budget in dollars",
    added: "2026-11-11",
    files: ["src/engine/run.ts (budgetLeft)", "src/presets/presets.ts (expertBudgetUsd)"],
    what: "Caps a run's expert spending by estimated API cost as well as by tokens.",
    optional: true,
  },
  {
    id: "F17",
    key: "live-cost",
    name: "Live cost",
    added: "2026-11-11",
    files: ["src/engine/run.ts (once)", "src/cli/format.ts"],
    what: "Shows each turn's estimated cost as it finishes, and cost by role in the summary.",
    optional: true,
  },
  {
    id: "F18",
    key: "screen-check-2",
    name: "Screen check, round 2",
    added: "2026-11-11",
    files: ["src/checks/screen.ts (countdown wait)"],
    what: "Waits out a countdown the program shows, so a timed run that never ends by itself is caught.",
    optional: true,
  },
  {
    id: "F19",
    key: "tui",
    name: "Terminal UI",
    added: "2026-11-12",
    files: ["src/tui/app.ts", "src/tui/view.ts", "src/tui/canvas.ts", "src/tui/model.ts", "src/tui/blocks.ts", "src/tui/term.ts", "src/tui/composer.ts", "src/tui/text.ts", "src/tui/theme.ts"],
    what: "The full-screen interface: a top bar (brand, project, status), projects and sessions on the left, the run as agent boxes in the middle, the team and its numbers on the right, a bottom bar; drawn on a cell canvas.",
    optional: false,
  },
  {
    id: "F20",
    key: "tui-working",
    name: "Working indicator",
    added: "2026-11-12",
    files: ["src/tui/view.ts (workingLine)"],
    what: "While a run works: an animated glyph and a shimmering verb for the stage, with the time and tokens so far, just above the prompt.",
    optional: true,
  },
  {
    id: "F21",
    key: "tui-slash",
    name: "Slash commands",
    added: "2026-11-12",
    files: ["src/tui/commands.ts", "src/tui/app.ts (suggestions)"],
    what: "Typing / in the prompt lists commands with autocomplete; Enter or Tab runs one.",
    optional: true,
  },
  {
    id: "F22",
    key: "tui-mentions",
    name: "File mentions",
    added: "2026-11-12",
    files: ["src/tui/files.ts", "src/tui/app.ts (suggestions)"],
    what: "Typing @ in the prompt searches the repository's files; Tab or Enter puts the path in.",
    optional: true,
  },
  {
    id: "F23",
    key: "tui-history",
    name: "Prompt history",
    added: "2026-11-12",
    files: ["src/tui/files.ts (history)", "src/tui/app.ts"],
    what: "Up and Down in an empty or recalled prompt step through earlier requests, kept in ~/.neuromesh/history.json.",
    optional: true,
  },
  {
    id: "F24",
    key: "tui-sessions",
    name: "Session switcher",
    added: "2026-11-12",
    files: ["src/tui/app.ts (openSession, resume)", "src/tui/view.ts (pickerPopup)"],
    what: "Ctrl+S, /sessions or a click in the sidebar reopens a past run from its event log: review, apply, discard or resume it.",
    optional: true,
  },
  {
    id: "F25",
    key: "tui-presets",
    name: "Preset picker",
    added: "2026-11-12",
    files: ["src/tui/app.ts (choosePreset)", "src/tui/view.ts (pickerPopup)"],
    what: "/preset (or a click on the preset in the prompt bar) lists presets with what each does; the choice applies to the next runs.",
    optional: true,
  },
  {
    id: "F26",
    key: "tui-details",
    name: "Agent details",
    added: "2026-11-12",
    files: ["src/tui/app.ts (cycleVerbose)", "src/tui/blocks.ts"],
    what: "Ctrl+O cycles the verbosity (medium, full, none), the same as /verbose.",
    optional: true,
  },
  {
    id: "F27",
    key: "tui-diff-numbers",
    name: "Diffs with line numbers",
    added: "2026-11-12",
    files: ["src/tui/diff.ts"],
    what: "Diffs in the stream and the diff view show old and new line numbers per file.",
    optional: true,
  },
  {
    id: "F28",
    key: "tui-notify",
    name: "Bell, title and exit summary",
    added: "2026-11-12",
    files: ["src/tui/app.ts (notify)", "src/tui/term.ts (title, bell)"],
    what: "The terminal title shows the run's state, the bell rings when a run ends, and quitting prints what this session did.",
    optional: true,
  },
  {
    id: "F29",
    key: "tui-motion",
    name: "Motion",
    added: "2026-11-12",
    files: ["src/tui/anim.ts", "src/tui/view.ts"],
    what: "Animations, each a function of time: shimmering labels while agents work, the pipeline's lines growing into arrows, the status lighting up when it changes, the brand shimmer, popups unfolding, light along the graph's edges, the context grid filling, scrollbars fading. /motion or NEUROMESH_MOTION=off turns them off.",
    optional: true,
  },
  {
    id: "F30",
    key: "tui-intro",
    name: "Logo intro",
    added: "2026-11-12",
    files: ["src/tui/anim.ts (buildUp)", "src/tui/view.ts (logo)"],
    what: "On opening, the logo builds up by density from the left.",
    optional: true,
  },
  {
    id: "F31",
    key: "tui-screensaver",
    name: "Screensaver",
    added: "2026-11-12",
    files: ["src/tui/screensaver.ts", "src/tui/app.ts (startSaver, stopSaver)", "src/tui/term.ts (mouse, suspend)"],
    what: "During a long run with no key press for 4 minutes, the NEUROMESH logo plays animated effects; any key or mouse movement, or the run ending, brings the workspace back. After the owner's terminal-ascii-screensaver; NEUROMESH_SCREENSAVER=external uses that tool itself.",
    optional: true,
  },
  {
    id: "F32",
    key: "tui-layers",
    name: "Layered look",
    added: "2026-11-12",
    files: ["src/tui/theme.ts", "src/tui/canvas.ts", "src/tui/term.ts (queryColours)"],
    what: "Surfaces in shades of the terminal's own background (asked from the terminal at start), so bars, panes, cards and popups sit on distinct layers with shadows, as opencode does. Transparent mode (settings) paints no backgrounds and draws lines instead.",
    optional: true,
  },
  {
    id: "F33",
    key: "tui-mouse",
    name: "Mouse",
    added: "2026-11-12",
    files: ["src/tui/term.ts (parseKeys mouse)", "src/tui/app.ts (onMouse)", "src/tui/canvas.ts (regions)"],
    what: "Click any button, session, project or agent box; hover shows a row's own buttons; the wheel scrolls the pane under the pointer; double-click renames. Every action also has a key.",
    optional: true,
  },
  {
    id: "F34",
    key: "tui-projects",
    name: "Projects and recents",
    added: "2026-11-12",
    files: ["src/tui/store.ts", "src/tui/view.ts (sidebar)", "src/tui/app.ts (projects)"],
    what: "The sidebar lists named projects (folders, ~/.neuromesh/tui/projects.json) with their sessions, and recent sessions from any other folder. New project with a folder picker, rename, remove (the folder is never touched), and delete a session (its record moves to ~/.neuromesh/trash).",
    optional: true,
  },
  {
    id: "F35",
    key: "tui-agent-boxes",
    name: "Agent boxes and verbosity",
    added: "2026-11-12",
    files: ["src/tui/blocks.ts", "src/tui/view.ts (stream)"],
    what: "The stream as one box per agent, labelled with its role and model; the label shimmers while the agent works. Verbosity none, medium (default: the lead's and expert's words, the workers' task list) or full (every step); click a box to open it.",
    optional: false,
  },
  {
    id: "F36",
    key: "tui-pipeline-box",
    name: "Pipeline buttons",
    added: "2026-11-12",
    files: ["src/tui/view.ts (pipelineBox)"],
    what: "Plan, build, check and review as buttons in a raised box; the line after a finished step grows into an arrow. Clicking a step scrolls to its first box.",
    optional: true,
  },
  {
    id: "F37",
    key: "tui-scroll",
    name: "Scrollbars and list shadows",
    added: "2026-11-12",
    files: ["src/tui/view.ts (scrollbar, fadeEdges)"],
    what: "As in btop: a scrollbar appears while scrolling, and a list longer than its pane fades out at the edge where more is hidden.",
    optional: true,
  },
  {
    id: "F38",
    key: "attachments",
    name: "Attached files",
    added: "2026-11-12",
    files: ["src/engine/run.ts (startRun attachments)", "src/tui/app.ts (attach)"],
    what: "Files from anywhere on the computer (+ in the prompt bar, or Ctrl+F) go with the request: text files are included in the brief every agent works from, others by path.",
    optional: true,
  },
  {
    id: "F39",
    key: "ask-first",
    name: "Normal and Turbo",
    added: "2026-11-12",
    files: ["src/engine/run.ts (askUser)", "src/tui/app.ts (answer)"],
    what: "In Normal mode the run stops to ask before the lead's plan is carried out (approve, change it, or stop) and before the expert is called in. Turbo goes ahead on its own. Changing your repository (Apply) is always yours. Only for callers that can answer (the TUI); `neuromesh run` never asks.",
    optional: true,
  },
  {
    id: "F40",
    key: "tui-agent-graph",
    name: "Agent graph",
    added: "2026-11-12",
    files: ["src/tui/view.ts (agentGraph)"],
    what: "The team as an animated graph: who hands work to whom, who is working, each model's subscription usage where the tool reports it, and the estimated API cost.",
    optional: true,
  },
  {
    id: "F41",
    key: "tui-context",
    name: "Context view",
    added: "2026-11-12",
    files: ["src/tui/view.ts (contextCard)", "src/tui/model.ts (context)"],
    what: "What an agent's last turn was made of (context.md, instructions, its own reading and tools, output) as a grid, as Claude Code's /context shows it, with a Compact button.",
    optional: true,
  },
  {
    id: "F42",
    key: "compact",
    name: "Compaction",
    added: "2026-11-12",
    files: ["src/engine/run.ts (turn)"],
    what: "On request, an agent's next follow-up turn starts a fresh session from the brief and its last report instead of continuing a long one.",
    optional: true,
  },
  {
    id: "F43",
    key: "quota-windows",
    name: "Usage windows",
    added: "2026-11-12",
    files: ["src/backends/claude.ts (rate_limit_event)", "src/engine/run.ts (agent.finished)"],
    what: "Claude Code's usage windows (5 hours, 7 days) with when each resets, passed on with every turn. Codex does not report its windows in headless mode, so they stay unknown.",
    optional: true,
  },
  {
    id: "F44",
    key: "task-report",
    name: "Worker reports",
    added: "2026-11-12",
    files: ["src/engine/run.ts (driveTask)"],
    what: "What a worker said it did at the end of each turn, as an event, so the TUI shows it in the worker's box.",
    optional: true,
  },
  {
    id: "F45",
    key: "tui-settings",
    name: "TUI settings",
    added: "2026-11-12",
    files: ["src/tui/store.ts (settings)", "src/tui/view.ts (settingsOverlay)"],
    what: "/settings: layered or transparent, theme, motion, frame rate, verbosity, Normal or Turbo, mouse, panes. Kept in ~/.neuromesh/tui/settings.json.",
    optional: true,
  },
  {
    id: "F46",
    key: "tui-fps",
    name: "Frame pacing",
    added: "2026-11-12",
    files: ["src/tui/app.ts (schedule)"],
    what: "Animations are drawn at 60 or 120 frames a second (settings), only while something moves; slow motion (a scrolling project name) ticks four times a second; nothing at all when still.",
    optional: true,
  },
  {
    id: "F47",
    key: "tui-markdown",
    name: "Final report",
    added: "2026-11-12",
    files: ["src/tui/markdown.ts", "src/tui/view.ts (placeFinal)", "src/tui/app.ts (settle)"],
    what: "When a run ends, the agents' final report is shown as rendered markdown (headings, lists, code, tables) and the stream scrolls to its first line, so it reads from the top.",
    optional: true,
  },
  {
    id: "F48",
    key: "tui-theme",
    name: "Neuromesh look",
    added: "2026-11-12",
    files: ["src/tui/theme.ts (NEUROMESH_DARK)", "src/tui/view.ts (box, divider, LOGO_MID)"],
    what: "Neuromesh's own look: the neuromesh-dark theme (from the owner's Obsidian Bloom, neutral black) by default, panes and boxes drawn as rounded frames with their titles set into the top edge, the big logo with a smaller one drawn in its style for narrow panes.",
    optional: true,
  },
  {
    id: "F49",
    key: "follow-up",
    name: "Follow-ups in a session",
    added: "2026-11-12",
    files: ["src/engine/run.ts (followFrom)", "src/tui/app.ts (start)", "src/tui/store.ts (sessions)"],
    what: "An instruction given after a run, in the same session, starts from that run's result (applied or not) and is told what was asked and done before; the session's runs show as one session in the sidebar.",
    optional: true,
  },
  {
    id: "F50",
    key: "opencode",
    name: "opencode and logins",
    added: "2026-11-12",
    files: ["src/backends/opencode.ts", "src/tui/app.ts (connect)"],
    what: "opencode as a fourth backend (`opencode run --format json`), so any model opencode knows can work, including API-key models added with `opencode auth login` (the key stays with opencode; their cost is real money and shown as reported). /connect signs in to Codex, Claude Code, Antigravity and opencode through each tool's own login.",
    optional: true,
  },
  {
    id: "F51",
    key: "tui-teams",
    name: "Favourite and custom teams",
    added: "2026-11-12",
    files: ["src/tui/team.ts", "src/tui/app.ts (openPicker, team dialog)", "src/presets/presets.ts (own presets)"],
    what: "The preset list offers two favourites (Opus 5.5 lead with GPT-6 Luna workers; GPT-6.1 Sol high with Gemini 3.8 Flash workers) and a Custom team: a model, or none, for expert, worker and tester, saved as ~/.neuromesh/presets/custom.json.",
    optional: true,
  },
  {
    id: "F52",
    key: "telemetry",
    name: "Testers' reports",
    added: "2026-11-12",
    files: ["src/telemetry/telemetry.ts", "telemetry-endpoint/src/index.js", "src/tui/app.ts (consent)"],
    what: "With the tester's consent (asked once), each real run's numbers, request, final reports and rating go to the owner's endpoint; never code, diffs, file locations or identity. Unsent reports wait in ~/.neuromesh/telemetry/outbox. `neuromesh telemetry on|off|pull`.",
    optional: true,
  },
  {
    id: "F53",
    key: "write-sandbox",
    name: "Write sandbox",
    added: "2026-11-12",
    files: ["src/backends/sandbox.ts", "src/backends/shared.ts (runCli)", "src/engine/run.ts (once)"],
    what: "On macOS, Claude Code, Antigravity and opencode run under the system sandbox (sandbox-exec): they may write only in the run's copy of the repository, git's shared objects, temporary and cache folders, and their own state. Reading and the network are unchanged. Codex keeps its own sandbox.",
    optional: true,
  },
  {
    id: "F54",
    key: "work-env",
    name: "Working environment",
    added: "2026-11-12",
    files: ["src/engine/env.ts", "src/engine/run.ts (prepareEnv)", "src/checks/checks.ts (runChecks env)"],
    what: "The engine makes the work folder's environment: .venv for Python (with uv when installed), node_modules for Node, installing what requirements.txt, pyproject.toml or package.json declare before the first turn and before every check. Agents and checks use it; it never enters the diff. From the python-bot run, where a sandboxed worker could not install the package its design named.",
    optional: true,
  },
  {
    id: "F55",
    key: "worker-network",
    name: "Network for new programs",
    added: "2026-11-12",
    files: ["src/backends/codex.ts (codexArgs)", "src/engine/run.ts (once)"],
    what: "Writing turns on a new program may reach the network inside Codex's sandbox (sandbox_workspace_write.network_access), so workers can install packages and try the real data. Writes stay confined. Other tools already had the network.",
    optional: true,
  },
  {
    id: "F56",
    key: "env-blocked",
    name: "Environment problems are not task failures",
    added: "2026-11-12",
    files: ["src/engine/run.ts (environmentProblem)", "src/engine/env.ts (environmentTrouble)", "src/engine/prompts.ts (envRepairPrompt)"],
    what: "When the checks fail because a package is missing or an install failed (or the worker reports being blocked by the environment), the worker gets up to two turns to declare it, which do not count as repair rounds; then the run stops with an environment failure. It never goes to the expert.",
    optional: true,
  },
  {
    id: "F57",
    key: "hollow-checks",
    name: "Checks that test nothing",
    added: "2026-11-12",
    files: ["src/checks/checks.ts (hollowReason)", "src/engine/run.ts (check)"],
    what: "A check that exits 0 but ran no tests, or skipped tests over a missing package, counts as failed (unless it already did so before the work started). Python checks print skip reasons (unittest -v, pytest -rs) so these are seen.",
    optional: true,
  },
  {
    id: "F58",
    key: "acceptance-runs",
    name: "Acceptance runs",
    added: "2026-11-12",
    files: ["src/checks/acceptance.ts (runAcceptance)", "src/engine/prompts.ts (specPrompt, testerPrompt)", "src/intake/brief.ts (renderBrief)"],
    what: "The spec names 2 to 4 real uses of the program (a command and what must be true of its result). The engine runs them in the reviewer's copy, sandboxed, and hands the reviewer the output, the files written and their first lines. Workers see them in the brief.",
    optional: true,
  },
  {
    id: "F59",
    key: "reproduced-findings",
    name: "Only shown findings count",
    added: "2026-11-12",
    files: ["src/checks/acceptance.ts (verifyFindings)", "src/engine/run.ts (checkFindings)"],
    what: "Each reviewer blocker comes with a check command that fails while the problem is there. The engine runs it: a blocker whose check passes is dropped, one without a check becomes minor (it never calls the expert in). Terminal programs keep screen-based findings.",
    optional: true,
  },
  {
    id: "F60",
    key: "no-rebuild",
    name: "No expert rebuild",
    added: "2026-11-12",
    files: ["src/engine/run.ts (escalate step, once)", "src/engine/prompts.ts (fixInPlacePrompt)", "src/backends/claude.ts (onUsage)"],
    what: "The expert's takeover never resets the work folder: it fixes the worker's code in place with the smallest change. A running expert turn is stopped when the run's estimated expert spending passes the dollar budget (Claude Code reports usage during the turn); its changes so far are kept and checked.",
    optional: true,
  },
  {
    id: "F61",
    key: "advice-facts",
    name: "The expert sees what the worker observed",
    added: "2026-11-12",
    files: ["src/engine/observed.ts", "src/engine/prompts.ts (advisePrompt)"],
    what: "Advice and in-place fixes get the commands that failed in the worker's environment and its blocked report, labelled as facts about the environment. Its reasoning is still left out.",
    optional: true,
  },
  {
    id: "F62",
    key: "advice-cap",
    name: "A small advice packet",
    added: "2026-11-12",
    files: ["src/engine/prompts.ts (compactAttempts)"],
    what: "The stuck state sent to the expert is cut to a few thousand characters: the latest change's files and the start of its diff, the failure, open findings, and only the file list of the attempt before.",
    optional: true,
  },
  {
    id: "F63",
    key: "scout-facts",
    name: "Facts before the spec",
    added: "2026-11-12",
    files: ["src/engine/run.ts (scoutStep)", "src/engine/prompts.ts (scoutPrompt)"],
    what: "Before an expert writes a new program's spec, a cheap worker turn (network on, scratch folder) checks the machine and fetches one real example of the data the program handles, and the spec writer gets up to 10 facts.",
    optional: true,
  },
  {
    id: "F64",
    key: "auth-pause",
    name: "Signed out: pause, do not escalate",
    added: "2026-11-12",
    files: ["src/engine/run.ts (signedOut, stopFor)"],
    what: "When a tool's server rejects its login (expired or revoked), the run pauses with a sign-in hint instead of skipping the spec, calling the expert on the same dead login, or failing. After signing in, resume continues where it stopped.",
    optional: true,
  },
  {
    id: "F65",
    key: "spec-plan",
    name: "Opus plans the build in the spec turn",
    added: "2026-11-12",
    files: ["src/engine/run.ts (specStep)", "src/engine/prompts.ts (specPrompt, SPEC_SCHEMA)", "src/intake/brief.ts (renderBrief)"],
    what: "For a new program, the expert's spec turn also splits the build into 2 to 5 tasks of one short worker session each (about 300 lines and tests), with owned files and build order, and marks any part it should build itself. Those tasks become the plan with no extra planning turn; they start on the first worker rung. Acceptance runs move to the last task.",
    optional: true,
  },
  {
    id: "F66",
    key: "tier-pricing",
    name: "Long calls at their real price",
    added: "2026-11-12",
    files: ["src/backends/claude.ts (claudeParser)", "src/usage/prices.ts (estimateCost)", "src/backends/types.ts (LONG_PROMPT)"],
    what: "Claude Code calls whose prompt is over 100K tokens are counted apart and priced at the model's long-context rates (Haiku 5.5: five times). The SiteWatch run showed $0.36 where it cost about $0.80.",
    optional: true,
  },
  {
    id: "F67",
    key: "session-cap",
    name: "Fresh session past 90K",
    added: "2026-11-12",
    files: ["src/engine/run.ts (turn, SESSION_CAP)", "src/backends/claude.ts (peakPrompt)"],
    what: "A session whose largest prompt passed 90K tokens is not resumed: the next turn starts fresh from the brief and what went wrong. Only for tools that report usage per call (Claude Code).",
    optional: true,
  },
  {
    id: "F68",
    key: "split-ask",
    name: "The worker asks the expert to split",
    added: "2026-11-12",
    files: ["src/engine/run.ts (splitStep)", "src/engine/prompts.ts (splitNote, splitPrompt)"],
    what: "A worker that finds its task too big for one session, or too hard to get right, answers status \"split\". The expert divides it into worker-sized parts, keeping for itself only what needs deep reasoning (built before the parts that depend on it). The work so far is kept; whatever depended on the task depends on all the parts. Once per task; parts cannot be split again.",
    optional: true,
  },
  {
    id: "F69",
    key: "budget-handoff",
    name: "Expert parts go to a worker when the budget is spent",
    added: "2026-11-12",
    files: ["src/engine/run.ts (expertCanTake, driveTask)"],
    what: "A task the plan gives the expert goes to the top worker rung when the expert budget left cannot pay for one expert turn (estimated from this run's expert turns, at least $0.15). The same when the preset has no expert at all. An expert-owned turn stopped at the budget keeps its work; the checks decide, and any further turns on that task are the worker's, never a second expert turn.",
    optional: true,
  },
  {
    id: "F70",
    key: "cut-usage",
    name: "A stopped turn keeps the usage it streamed",
    added: "2026-11-12",
    files: ["src/engine/run.ts (once)", "src/backends/types.ts (Usage.estimated)"],
    what: "A Claude Code turn stopped before its final event (budget cut, timeout, stop) records the usage its stream reported so far: exact input and cache counts, output estimated from the text written and the thinking counts, marked estimated. It was recorded as unknown, which hid real spending.",
    optional: true,
  },
  {
    id: "F71",
    key: "one-review",
    name: "A planned build is reviewed once, as a whole",
    added: "2026-11-12",
    files: ["src/engine/run.ts (wantsTester, test step)", "src/engine/prompts.ts (testerPrompt)"],
    what: "When the spec split a new program into tasks (F65), the parts merge on their own checks and only the last one gets the tester, who reviews the whole program against the request with the acceptance runs. The earlier parts' testers could not run the unfinished program and found nothing (bookshelf run, 2026-11-12).",
    optional: true,
  },
  {
    id: "F72",
    key: "quota-log",
    name: "The usage log records the subscription quota used",
    added: "2026-11-12",
    files: ["src/usage/log.ts (quotaSpan, quotaText)", "src/engine/run.ts (once)"],
    what: "Each run records, per tool that reports it, the 5-hour and weekly quota readings at its first and last turn (Claude Code's rate-limit events), and the usage log shows them. Quota, not the API-price estimate, is what a subscription run costs.",
    optional: true,
  },
  {
    id: "F73",
    key: "heal-worktree",
    name: "Work folders are put right after an agent has been in them",
    added: "2026-11-12",
    files: ["src/workspace/workspace.ts (healWorktree)", "src/engine/run.ts (healTask)"],
    what: "Before and after every agent turn that may write, the engine checks the work folder and repairs what agents and their tools do to it: a deleted folder (made again from its branch), a stale git lock file, a half-done merge or rebase, a switched branch or detached HEAD (the branch name is put back, keeping the commits), and a git repository started inside the work, which would silently leave those files out of the result. Git commands that meet another process's lock file are tried again. Each used to end the run with an engine error or lose work. Found by the fault harness (evals/chaos.ts).",
    optional: true,
  },
  {
    id: "F74",
    key: "adapter-guard",
    name: "A crashing tool adapter is a failed turn, not a crashed run",
    added: "2026-11-12",
    files: ["src/engine/run.ts (once)"],
    what: "When a backend adapter throws (the tool could not be started, or its output broke the parser), the turn ends as an error like any other, with its usage unknown and its record kept; the fallback chain, the ladder and the expert apply as usual. It used to end the run with an engine error and leave the turn open in the event log.",
    optional: true,
  },
  {
    id: "F75",
    key: "sync-before-checks",
    name: "A task is tested with what the others have merged",
    added: "2026-11-12",
    files: ["src/engine/run.ts (syncTask)"],
    what: "Before a task's checks run, the work other tasks merged since it started is merged into its folder, and its diff is counted from there. The later of two tasks built at the same time used to be tested without the other's work: its checks failed through no fault of its own, the worker repaired nothing, the expert was called in and the task was marked failed while the merged result passed. Found by the fault harness (evals/chaos.ts).",
    optional: true,
  },
  {
    id: "F76",
    key: "leftover-stop",
    name: "A finished tool always ends its turn, and what it left running is stopped",
    added: "2026-11-12",
    files: ["src/backends/proc.ts (runProcess, taggedProcesses)"],
    what: "Every program a turn, a check or an acceptance run starts carries a tag in its environment. When the tool has exited, or was stopped at a time limit or by the person, whatever still carries the tag is stopped, and the turn ends even if its output pipe is still held open. A program the tool left running in a group of its own (a server started in the background) used to keep the turn waiting for as long as it lived, past every time limit, and survived the run. Found while reviewing the process runner for the fault harness.",
    optional: true,
  },
  {
    id: "F77",
    key: "direct-build",
    name: "A worker writes a planned part in one answer; the engine runs the checks",
    added: "2026-11-13",
    files: ["src/engine/run.ts (directApplies, directTurn, writeDirect)", "src/engine/prompts.ts (directPrompt, parseDirect)", "src/backends/claude.ts (claudeArgs)"],
    what: "Experimental, and only in presets that set \"direct\": true. For a worker's part of a program that has a spec, the worker is run with no tools: its prompt holds the spec, its task and the project's files, and its one answer holds its files. Neuromesh writes them and runs the checks; a failure goes back to it once the same way, and after that the worker gets its tools as before. One model call with a prompt of a few thousand tokens, in place of dozens of calls that each reread the whole conversation. After the owner's earlier research (a tight context and one low-effort answer) and the bookshelf run, where Haiku's agent turns were most of the quota.",
    optional: true,
  },
];

const byAny = new Map<string, Feature>();
for (const f of FEATURES) {
  byAny.set(f.id.toLowerCase(), f);
  byAny.set(f.key, f);
}

export function feature(idOrKey: string): Feature {
  const f = byAny.get(idOrKey.toLowerCase());
  if (!f) throw new Error(`Unknown feature "${idOrKey}"`);
  return f;
}

/** "F04 screen-check": how a feature is named in messages and code comments. */
export function tag(idOrKey: string): string {
  const f = feature(idOrKey);
  return `${f.id} ${f.key}`;
}

// The switched-off features for this process: NEUROMESH_DISABLE, --disable,
// and a preset's "disable" list. Optional features that fail are added too.
const disabled = new Set<string>();

function parse(list: string | string[] | undefined): Feature[] {
  const items = Array.isArray(list) ? list : (list ?? "").split(",");
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => byAny.get(s.toLowerCase()))
    .filter((f): f is Feature => f !== undefined);
}

export function disable(list: string | string[] | undefined): void {
  for (const f of parse(list)) disabled.add(f.key);
}

/** Back to the process-wide setting (NEUROMESH_DISABLE, which --disable extends). */
export function resetFeatures(): void {
  disabled.clear();
  disable(process.env.NEUROMESH_DISABLE);
}

/** Switch off everything not in `keys` (a resumed run keeps the features it started with). */
export function onlyThese(keys: string[]): void {
  for (const f of FEATURES) if (!keys.includes(f.key)) disabled.add(f.key);
}
resetFeatures();

export function isOn(idOrKey: string): boolean {
  return !disabled.has(feature(idOrKey).key);
}

export function activeKeys(): string[] {
  return FEATURES.filter((f) => !disabled.has(f.key)).map((f) => f.key);
}

/** An error raised inside a feature, carrying which one. */
export class FeatureError extends Error {
  readonly feature: Feature;
  constructor(f: Feature, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`[${f.id} ${f.key}] ${message}`, { cause });
    this.name = "FeatureError";
    this.feature = f;
  }
}

/** Run `fn` as part of a feature: any error it throws is tagged with the feature. */
export function inFeature<T>(idOrKey: string, fn: () => T): T {
  const f = feature(idOrKey);
  // Fault injection, to check that a failing feature is handled: NEUROMESH_FAULT=screen-check
  if (parse(process.env.NEUROMESH_FAULT).some((x) => x.key === f.key)) throw new FeatureError(f, new Error("injected fault (NEUROMESH_FAULT)"));
  try {
    const value = fn();
    if (value instanceof Promise) {
      return value.catch((error: unknown) => {
        throw error instanceof FeatureError ? error : new FeatureError(f, error);
      }) as T;
    }
    return value;
  } catch (error) {
    throw error instanceof FeatureError ? error : new FeatureError(f, error);
  }
}

/** What to tell the owner when a feature failed. */
export function hint(f: Feature): string {
  return `This came from ${f.id} ${f.key} (${f.name}; ${f.files[0]}). To run without it: --disable ${f.key}, or NEUROMESH_DISABLE=${f.key}.`;
}

export function featureTable(): string {
  return FEATURES.map((f) => `${f.id}  ${f.key.padEnd(22)} ${isOn(f.key) ? "on " : "OFF"}  ${f.optional ? "optional" : "core    "}  ${f.what}\n      ${f.files.join("; ")}`).join("\n");
}
