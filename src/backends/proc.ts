// Runs a child process so that a timeout or a cancel can stop the tool and
// everything it started.
//
// The tool gets its own process group, and killing that group is enough for
// most tools. Codex, however, runs each command in a separate group, so those
// commands survive a group kill. The runner therefore also keeps a list of the
// tool's descendants while it runs and stops those too.

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

export interface ProcOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Stop the program when it prints nothing for this long. */
  idleMs?: number;
  signal?: AbortSignal;
  /** Text to send on standard input. */
  stdin?: string;
  /** Raw standard output is appended here. */
  logPath?: string;
  onLine?: (line: string) => void;
  /** Called with the process id once the program has started. */
  onSpawn?: (pid: number) => void;
  env?: NodeJS.ProcessEnv;
}

export interface ProcResult {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  /** Stopped for printing nothing for idleMs. */
  idle: boolean;
  cancelled: boolean;
  /** Set when the program could not be started at all. */
  spawnError?: string;
  durationMs: number;
}

const STDERR_LIMIT = 64_000;
const KILL_GRACE_MS = 3_000;
const SAMPLE_MS = 1_500;

interface ProcessRow {
  ppid: number;
  command: string;
}

function processTable(): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>();
  let out: string;
  try {
    out = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return table;
  }
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]), command: match[3] ?? "" });
  }
  return table;
}

/**
 * Remembers every process that descends from a root, including ones whose
 * parent has since exited. A process is only ever signalled if its command
 * line still matches what was recorded, so a reused pid is never touched.
 */
class DescendantTracker {
  private readonly seen = new Map<number, string>();
  private readonly root: number;

  constructor(root: number) {
    this.root = root;
  }

  sample(): void {
    const table = processTable();
    const parents = new Set<number>([this.root]);
    for (const [pid, command] of this.seen) {
      if (table.get(pid)?.command === command) parents.add(pid);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const [pid, row] of table) {
        if (parents.has(row.ppid) && !parents.has(pid)) {
          parents.add(pid);
          this.seen.set(pid, row.command);
          grew = true;
        }
      }
    }
  }

  signal(signal: NodeJS.Signals): void {
    const table = processTable();
    for (const [pid, command] of this.seen) {
      if (table.get(pid)?.command !== command) continue;
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
  }
}

export function runProcess(options: ProcOptions): Promise<ProcResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let timedOut = false;
    let idle = false;
    let cancelled = false;
    let stderr = "";
    let spawnError: string | undefined;

    if (options.signal?.aborted) {
      resolve({ exitCode: null, stderr: "", timedOut: false, idle: false, cancelled: true, durationMs: 0 });
      return;
    }

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      // PWD follows cwd: some tools (opencode) take their working folder from it.
      env: { ...(options.env ?? process.env), ...(options.cwd ? { PWD: options.cwd } : {}) },
      detached: true, // new process group; see killGroup
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (child.pid !== undefined) options.onSpawn?.(child.pid);

    let log: ReturnType<typeof createWriteStream> | undefined;
    if (options.logPath) {
      mkdirSync(dirname(options.logPath), { recursive: true });
      log = createWriteStream(options.logPath, { flags: "a" });
    }

    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is already gone.
      }
    };
    const tracker = child.pid === undefined ? undefined : new DescendantTracker(child.pid);
    const sampler = setInterval(() => tracker?.sample(), SAMPLE_MS);
    sampler.unref();
    let stopped = false;
    const stop = (): void => {
      stopped = true;
      tracker?.sample(); // one last look before the parent disappears
      killGroup("SIGTERM");
      tracker?.signal("SIGTERM");
      setTimeout(() => {
        killGroup("SIGKILL");
        tracker?.signal("SIGKILL");
      }, KILL_GRACE_MS).unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    let idleTimer: NodeJS.Timeout | undefined;
    const touch = (): void => {
      if (!options.idleMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idle = true;
        timedOut = true;
        stop();
      }, options.idleMs);
    };
    touch();
    const onAbort = (): void => {
      cancelled = true;
      stop();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.stdin.on("error", () => {
      // The tool closed its input early; nothing to do.
    });
    child.stdin.end(options.stdin ?? "");

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      touch();
      log?.write(line + "\n");
      if (line.trim() !== "") options.onLine?.(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(idleTimer);
      clearInterval(sampler);
      options.signal?.removeEventListener("abort", onAbort);
      // Children the tool left behind in its group must not outlive it.
      killGroup("SIGKILL");
      // After a cancel or timeout, neither may commands it ran in other groups.
      if (stopped) tracker?.signal("SIGKILL");
      const finish = (): void =>
        resolve({
          exitCode: code,
          stderr,
          timedOut,
          idle,
          cancelled,
          spawnError,
          durationMs: Date.now() - started,
        });
      if (log) log.end(finish);
      else finish();
    });
  });
}

/** Run a short command and return its trimmed output, or undefined on failure. */
export async function capture(command: string, args: string[], timeoutMs = 15_000): Promise<string | undefined> {
  let out = "";
  const result = await runProcess({
    command,
    args,
    cwd: process.cwd(),
    timeoutMs,
    onLine: (line) => {
      out += line + "\n";
    },
  });
  if (result.spawnError || result.exitCode !== 0) return undefined;
  return out.trim();
}
