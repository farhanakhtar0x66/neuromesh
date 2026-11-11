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
    files: ["src/tui/app.ts", "src/tui/view.ts", "src/tui/model.ts", "src/tui/term.ts", "src/tui/composer.ts", "src/tui/text.ts", "src/tui/theme.ts"],
    what: "The full-screen interface: a landing canvas, then a live workspace with the pipeline, transcript, agents and cost, and an outcome card to apply, diff, discard and rate.",
    optional: false,
  },
  {
    id: "F20",
    key: "tui-working",
    name: "Working indicator",
    added: "2026-11-12",
    files: ["src/tui/view.ts (workingLines)"],
    what: "While a run works: an animated glyph and a shimmering verb for the stage, with time, tokens and how to stop; one line per active agent under it.",
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
    files: ["src/tui/app.ts (openSession, resume)", "src/tui/view.ts (pickerOverlay)"],
    what: "Ctrl+S or /sessions reopens a past run of this folder from its event log: review, apply, discard or resume it.",
    optional: true,
  },
  {
    id: "F25",
    key: "tui-presets",
    name: "Preset picker",
    added: "2026-11-12",
    files: ["src/tui/app.ts (choosePreset)", "src/tui/view.ts (pickerOverlay)"],
    what: "/preset lists presets with what each does; the choice applies to the next runs in this TUI.",
    optional: true,
  },
  {
    id: "F26",
    key: "tui-details",
    name: "Agent details",
    added: "2026-11-12",
    files: ["src/tui/model.ts (detail items)", "src/tui/view.ts"],
    what: "Ctrl+O shows or hides what each agent did step by step (commands, edits, messages).",
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
