// [F53 write-sandbox] Agents may write only where their work is.
//
// Codex confines its own agents (`-s workspace-write`). Claude Code,
// Antigravity and opencode, run headless with edits and commands allowed,
// could write anywhere the user can. On macOS each of them now runs under the
// system's own sandbox (sandbox-exec, the same mechanism Codex uses), with a
// profile that allows writing only in:
//   - the turn's own folders: the run's copy of the repository, and the
//     repository's shared git objects (git add needs them);
//   - temporary and cache folders;
//   - each tool's own state (sessions, logs, settings), which it cannot run
//     without.
// Reading and the network are unchanged. Elsewhere (Linux, or with the feature
// off) agents run as before, in their own worktree, and you review the diff.

import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Where each tool keeps its own state, under the home folder. */
const TOOL_STATE = [
  ".claude",
  ".gemini",
  ".cache",
  ".npm",
  ".config/opencode",
  ".config/claude",
  ".local/share/opencode",
  ".local/state/opencode",
  "Library/Caches",
  "Library/Application Support/Claude",
  "Library/Application Support/claude",
  "Library/Application Support/Antigravity",
];

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

const quote = (p: string): string => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The sandbox profile for a turn that may write in `writable` (besides temp, caches and tool state). */
export function sandboxProfile(writable: string[], home = homedir()): string {
  const paths = new Set<string>();
  for (const p of writable) paths.add(real(p));
  for (const p of [tmpdir(), "/private/tmp", "/private/var/folders", "/dev"]) paths.add(real(p));
  for (const p of TOOL_STATE) paths.add(join(real(home), p));
  const allow = [...paths].map((p) => `  (subpath ${quote(p)})`).join("\n");
  // Claude Code also writes ~/.claude.json and its backups beside it.
  const files = `  (regex ${quote(`^${real(home).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.claude\\.json`)})`;
  return `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write*\n${allow}\n${files})\n`;
}

/** True where this sandbox can be used. */
export function sandboxAvailable(): boolean {
  return process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
}

/** The command line that runs `command` inside the sandbox. */
export function sandboxed(command: string, args: string[], writable: string[]): { command: string; args: string[] } {
  return { command: "/usr/bin/sandbox-exec", args: ["-p", sandboxProfile(writable), command, ...args] };
}
