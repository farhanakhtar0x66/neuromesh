// [F136 lean-runner] The command-output filter of the lean frontier runner, and the
// Claude Code hook that applies it. Pure functions only (the two small entry
// scripts, lean-hook.ts and lean-run.ts, run on import). Node built-ins only.
//
// Why: in a Claude Code session every model call reads the whole conversation
// again, so a long test log is paid for on every later call of the turn. Claude
// Code keeps its own history, so Neuromesh cannot edit a tool result after it is
// in; it can only shorten the output before the Bash tool hands it back. The
// documented PreToolUse hook (`--settings`, hooks.PreToolUse, `updatedInput`)
// rewrites each eligible Bash command to run through lean-run.ts, which runs the
// original command and prints the filtered output with the same exit code.

/** Output with at most this many lines (after cleaning) is shown whole. */
export const FILTER_HEAD = 30;
export const FILTER_TAIL = 60;
/** Failure lines kept from the middle, at most. */
export const FILTER_FAILURES = 40;
/** A line longer than this is cut (minified files, base64, one-line JSON). */
export const FILTER_LINE = 400;

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
const FAILURE = /\b(fail(ed|ure|ures)?|error(s)?|exception|traceback|panic(ked)?|assert(ion)?|expected|not ok)\b|✗|×|^E\s/i;
/** A progress-bar line: mostly bar characters or a percentage counter. */
const PROGRESS = /^\s*(\[?[#=>.\-█▏▎▍▌▋▊▉░▒▓ ]{8,}\]?|.*\b\d{1,3}%\s*(\||$)|[|/\\-]\s*$)/;

/**
 * Terminal noise out: ANSI colour and cursor codes, and carriage-return redraws
 * (only the last state of a redrawn line is kept). Deterministic.
 */
export function cleanOutput(raw: string): string {
  const noAnsi = raw.replace(ANSI, "");
  return noAnsi
    .split("\n")
    .map((line) => {
      const parts = line.replace(/\r+$/, "").split("\r");
      return parts[parts.length - 1]!;
    })
    .join("\n");
}

/** Runs of the same line, and runs of progress-bar lines, become one line and a count. */
export function collapseRepeats(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    let j = i + 1;
    if (PROGRESS.test(line) && line.trim() !== "") {
      while (j < lines.length && PROGRESS.test(lines[j]!) && lines[j]!.trim() !== "") j++;
      if (j - i > 1) {
        out.push(lines[j - 1]!, `  (${j - i - 1} earlier progress lines left out)`);
        i = j;
        continue;
      }
    }
    while (j < lines.length && lines[j] === line) j++;
    out.push(line);
    if (j - i > 2) out.push(`  (the line above repeated ${j - i - 1} more times)`);
    else if (j - i === 2) out.push(line);
    i = j;
  }
  return out;
}

const clip = (line: string): string => (line.length > FILTER_LINE ? `${line.slice(0, FILTER_LINE)}… (${line.length - FILTER_LINE} characters cut)` : line);

/**
 * What the model sees of a command's output: cleaned, repeats collapsed, and when
 * still long, the first FILTER_HEAD lines, up to FILTER_FAILURES failure lines
 * from the middle (the failure summary), and the last FILTER_TAIL lines, with a
 * notice of exactly how many lines and bytes were left out. The exit code is
 * always the last line. The same input always gives the same output.
 */
export function filterOutput(raw: string, exitCode: number | null): string {
  const exit = `[exit code ${exitCode === null ? "unknown (killed by a signal)" : exitCode}]`;
  const cleaned = cleanOutput(raw).replace(/\n+$/, "");
  if (cleaned === "") return exit;
  const lines = collapseRepeats(cleaned.split("\n")).map(clip);
  if (lines.length <= FILTER_HEAD + FILTER_TAIL + 10) return `${lines.join("\n")}\n${exit}`;
  const head = lines.slice(0, FILTER_HEAD);
  const tail = lines.slice(lines.length - FILTER_TAIL);
  const middle = lines.slice(FILTER_HEAD, lines.length - FILTER_TAIL);
  const kept = new Set<number>();
  for (let i = 0; i < middle.length && kept.size < FILTER_FAILURES; i++) if (FAILURE.test(middle[i]!)) kept.add(i);
  const failures = [...kept].map((i) => middle[i]!);
  const omittedLines = middle.length - failures.length;
  const omittedBytes = middle.reduce((n, l, i) => (kept.has(i) ? n : n + Buffer.byteLength(l, "utf8") + 1), 0);
  const rawBytes = Buffer.byteLength(raw, "utf8");
  const notice = `[Neuromesh shortened this output: ${omittedLines} of ${lines.length} lines (${omittedBytes} bytes) left out of the middle; the command printed ${rawBytes} bytes in all. Re-run with a narrower command (one test, grep, head/tail) if you need a part that is not shown.]`;
  const summary = failures.length > 0 ? [`[failure lines from the part left out (${failures.length}):]`, ...failures] : [];
  return [...head, notice, ...summary, "[last lines:]", ...tail, exit].join("\n");
}

/** Commands whose effect is on the shell itself, so running them in a child shell would lose it. */
const SHELL_STATE = /^\s*(cd|pushd|popd|export|unset|source|\.|alias|set|ulimit|umask|exec)(\s|$)/;

/**
 * Whether the hook should wrap a Bash call. Not: shell-state commands, commands
 * already shortened (nm run, the lean runner itself), commands sent to the
 * background, and empty ones.
 */
export function shouldWrap(input: { command?: unknown; run_in_background?: unknown }, runScript: string): boolean {
  const command = typeof input.command === "string" ? input.command : "";
  if (command.trim() === "") return false;
  if (input.run_in_background === true) return false;
  if (SHELL_STATE.test(command)) return false;
  if (command.includes(runScript) || /\bnm\.ts\b.*\brun\b/.test(command)) return false;
  return true;
}

/** The command the Bash tool runs instead: the original, base64 so no quoting can break it. */
export function wrapCommand(command: string, runScript: string): string {
  return `node ${quote(runScript)} ${Buffer.from(command, "utf8").toString("base64")}`;
}

/** The hook's answer: allow the call, with the command replaced. Undefined: leave the call as it is. */
export function hookAnswer(event: unknown, runScript: string): Record<string, unknown> | undefined {
  if (!event || typeof event !== "object") return undefined;
  const e = event as { tool_name?: unknown; tool_input?: unknown };
  if (e.tool_name !== "Bash" || !e.tool_input || typeof e.tool_input !== "object") return undefined;
  const input = e.tool_input as Record<string, unknown>;
  if (!shouldWrap(input, runScript)) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...input, command: wrapCommand(input.command as string, runScript) },
    },
  };
}

/** The `--settings` value that installs the hook for one Claude Code session. */
export function hookSettings(hookScript: string): string {
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node ${quote(hookScript)}`, timeout: 10 }] }] } });
}

const quote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
