// [F54 work-env] A working environment for the code the agents write.
//
// The python-bot run (docs/12-python-bot-run.md) failed on one fact: the
// worker could not install the package its own design named, because Codex's
// sandbox has no network and the system Python refuses `pip install`. The
// checks then "passed" with the converter's tests skipped, and the expert was
// called in to rebuild everything. Published work agrees that agents set up
// environments badly (SetupBench: 39% to 57%), so the engine does it.
//
// For a Python project the engine makes `.venv` in the work folder and
// installs what requirements*.txt or pyproject.toml declare; for Node, what
// package.json declares. The folders never enter the diff. Agents and checks
// use them; a marker file inside each records what was installed, so a later
// call installs again only when the declarations change.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runProcess } from "../backends/proc.ts";

export const VENV = ".venv";
/** Python bytecode never belongs in the diff (the logstat run applied two .pyc files). */
export const BYTECODE = "*.pyc";
export const NODE_MODULES = "node_modules";
const MARKER = ".neuromesh-installed";
const INSTALL_TIMEOUT_MS = 6 * 60_000;

export interface EnvOutcome {
  /** Folders the engine made, to be left out of the diff. */
  folders: string[];
  /** What was installed this time, for the event log. */
  installed: string[];
  /** Set when an install failed: the tool's last lines. */
  failed?: string;
}

let uvCache: boolean | undefined;
function hasUv(): boolean {
  uvCache ??= spawnSync("uv", ["--version"], { encoding: "utf8" }).status === 0;
  return uvCache;
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Python source or declarations at the top or one folder down. */
export function looksPython(dir: string): boolean {
  const top = listDir(dir);
  if (top.some((f) => /^requirements.*\.txt$|^pyproject\.toml$|^setup\.(py|cfg)$/.test(f))) return true;
  for (const f of top) {
    if (f.startsWith(".") || f === NODE_MODULES) continue;
    if (f.endsWith(".py")) return true;
    const sub = join(dir, f);
    try {
      if (statSync(sub).isDirectory() && listDir(sub).some((g) => g.endsWith(".py"))) return true;
    } catch {
      // Gone or unreadable.
    }
  }
  return false;
}

/** Dependencies a pyproject.toml declares in [project] dependencies (a simple reading, enough for new projects). */
export function pyprojectDependencies(text: string): string[] {
  const project = /^\[project\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text)?.[1] ?? "";
  const list = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(project)?.[1] ?? "";
  return [...list.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** What the project declares, and a fingerprint of it. */
function pythonDeclarations(dir: string): { args: string[][]; key: string; names: string[] } {
  const files = listDir(dir).filter((f) => /^requirements.*\.txt$/.test(f)).sort();
  const args: string[][] = files.map((f) => ["-r", f]);
  const names = [...files];
  const pyproject = read(join(dir, "pyproject.toml"));
  const deps = pyproject ? pyprojectDependencies(pyproject) : [];
  if (deps.length > 0) {
    args.push(deps);
    names.push(`pyproject.toml (${deps.length})`);
  }
  const hash = createHash("sha256");
  for (const f of files) hash.update(f).update(read(join(dir, f)) ?? "");
  hash.update(JSON.stringify(deps));
  return { args, key: hash.digest("hex").slice(0, 16), names };
}

function nodeDeclarations(dir: string): { key: string; count: number } | undefined {
  const text = read(join(dir, "package.json"));
  if (!text) return undefined;
  try {
    const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const count = Object.keys(all).length;
    if (count === 0) return undefined;
    return { key: createHash("sha256").update(JSON.stringify(all)).digest("hex").slice(0, 16), count };
  } catch {
    return undefined;
  }
}

async function run(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<{ ok: boolean; tail: string }> {
  const lines: string[] = [];
  const proc = await runProcess({
    command,
    args,
    cwd,
    timeoutMs: INSTALL_TIMEOUT_MS,
    signal,
    env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1", NO_COLOR: "1", npm_config_fund: "false", npm_config_audit: "false" },
    onLine: (l) => {
      lines.push(l);
      if (lines.length > 80) lines.shift();
    },
  });
  const tail = [...lines, proc.stderr.trim()].join("\n").trim().slice(-1_500);
  return { ok: proc.exitCode === 0 && !proc.timedOut && !proc.cancelled, tail: proc.spawnError ? `could not start ${command}: ${proc.spawnError}` : tail };
}

/**
 * Make or update the environment in `dir`. `python` says the work will be in
 * Python even before any Python file exists (a new program whose request names
 * it), so the worker's very first turn has the environment.
 */
export async function ensureEnv(dir: string, options: { python?: boolean; signal?: AbortSignal } = {}): Promise<EnvOutcome> {
  const outcome: EnvOutcome = { folders: [], installed: [] };
  if (options.python || looksPython(dir)) {
    const venv = join(dir, VENV);
    const python = join(venv, "bin", "python");
    if (!existsSync(python)) {
      const made = hasUv() ? await run("uv", ["venv", "--quiet", "--python", "python3", VENV], dir, options.signal) : await run("python3", ["-m", "venv", VENV], dir, options.signal);
      if (!made.ok || !existsSync(python)) return { ...outcome, failed: `could not create ${VENV}: ${made.tail}` };
    }
    outcome.folders.push(VENV, BYTECODE);
    const decl = pythonDeclarations(dir);
    const marker = join(venv, MARKER);
    if (decl.args.length > 0 && read(marker) !== decl.key) {
      for (const a of decl.args) {
        const r = hasUv() ? await run("uv", ["pip", "install", "--quiet", "--python", python, ...a], dir, options.signal) : await run(python, ["-m", "pip", "install", "--quiet", ...a], dir, options.signal);
        if (!r.ok) return { ...outcome, failed: `installing ${a.join(" ")} failed:\n${r.tail}` };
      }
      writeFileSync(marker, decl.key);
      outcome.installed.push(...decl.names);
    }
  }
  const node = nodeDeclarations(dir);
  if (node) {
    const marker = join(dir, NODE_MODULES, MARKER);
    if (read(marker) !== node.key) {
      const r = await run("npm", ["install", "--no-save", "--no-package-lock", "--ignore-scripts"], dir, options.signal);
      if (!r.ok) return { ...outcome, failed: `npm install failed:\n${r.tail}` };
      if (existsSync(join(dir, NODE_MODULES))) writeFileSync(marker, node.key);
      outcome.installed.push(`package.json (${node.count})`);
    }
    if (existsSync(join(dir, NODE_MODULES))) outcome.folders.push(NODE_MODULES);
  }
  return outcome;
}

/** Environment variables that put the work folder's environment first, for checks and acceptance runs. */
export function envVars(dir: string): Record<string, string> {
  const bin = join(dir, VENV, "bin");
  // No __pycache__ folders from the agents, the checks or the acceptance runs.
  if (!existsSync(bin)) return { PYTHONDONTWRITEBYTECODE: "1" };
  return { PATH: `${bin}:${process.env.PATH ?? ""}`, VIRTUAL_ENV: join(dir, VENV), PYTHONDONTWRITEBYTECODE: "1" };
}

/** The note every writing agent gets, so it uses the environment instead of fighting the system's Python. */
export function envNote(dir: string): string {
  const parts: string[] = [];
  if (existsSync(join(dir, VENV, "bin", "python"))) {
    parts.push(
      `Neuromesh made a Python environment in \`${VENV}\` for this work. Run Python as \`${VENV}/bin/python\` (and pip as \`${VENV}/bin/python -m pip\`); never install into the system Python. Declare every third-party package in requirements.txt: Neuromesh installs what it declares before every check, and the checks run with \`${VENV}\` first on PATH.`,
    );
  }
  if (existsSync(join(dir, "package.json"))) {
    parts.push("Declare every npm package in package.json: Neuromesh installs them into node_modules before every check.");
  }
  return parts.length > 0 ? `\n\nEnvironment: ${parts.join(" ")}` : "";
}

/** Phrases in a worker's report or a check's output that mean the environment, not the code, is at fault. */
const ENV_TROUBLE =
  /No module named ['"]?([\w.]+)|ModuleNotFoundError|Cannot find module ['"]([^'"]+)|externally[- ]managed|could not (?:resolve|reach|install|download)|failed to resolve|nodename nor servname|Name or service not known|Temporary failure in name resolution|not installed in this environment|cannot (?:install|reach|resolve)|no network|network (?:is )?(?:unavailable|blocked|access)|sandbox (?:blocks|denied|prevents)/i;

/** True when this text says something could not be installed or reached. */
export function environmentTrouble(text: string | undefined): boolean {
  return Boolean(text && ENV_TROUBLE.test(text));
}

/** A module the output says is missing, when it names one. */
export function missingModule(text: string | undefined): string | undefined {
  const m = text ? /No module named ['"]?([\w.]+)|Cannot find module ['"]([^'"./][^'"]*)/.exec(text) : null;
  return m ? (m[1] ?? m[2])?.split(".")[0] : undefined;
}
