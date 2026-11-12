// Runs a child process so that a timeout or a cancel can stop the tool and
// everything it started.
//
// The tool gets its own process group, and killing that group is enough for
// most tools. Codex, however, runs each command in a separate group, so those
// commands survive a group kill. The runner therefore also keeps a list of the
// tool's descendants while it runs and stops those too.

import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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
/** After the tool itself has exited: how long its output may still drain before whatever holds it open is stopped. */
const EXIT_GRACE_MS = 1_500;
/** After everything was told to stop: how long before the turn ends anyway, with the output abandoned. */
const ABANDON_MS = 2_500;

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

/** Every program a turn starts carries this in its environment, whatever group or parent it ends up with. */
const TURN_TAG = "NEUROMESH_TURN";

/**
 * Processes whose environment carries the tag. This finds what the descendant
 * list cannot: a program that moved to its own group and lost its parent
 * before the list was first taken (a server started in the background by a
 * tool that then exits).
 */
function taggedProcesses(tag: string): number[] {
  const needle = `${TURN_TAG}=${tag}`;
  const found: number[] = [];
  if (existsSync("/proc/self/environ")) {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        if (readFileSync(`/proc/${name}/environ`, "utf8").split("\0").includes(needle)) found.push(Number(name));
      } catch {
        // Another user's process, or one that has just exited.
      }
    }
  } else {
    let out = "";
    try {
      out = execFileSync("ps", ["axeww", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return found;
    }
    for (const line of out.split("\n")) {
      if (!line.includes(needle)) continue;
      const pid = Number.parseInt(line, 10);
      if (Number.isFinite(pid)) found.push(pid);
    }
  }
  return found.filter((pid) => pid !== process.pid);
}

function signalTagged(tag: string, signal: NodeJS.Signals): void {
  for (const pid of taggedProcesses(tag)) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
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

    const tag = `${process.pid}-${randomBytes(6).toString("hex")}`;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      // PWD follows cwd: some tools (opencode) take their working folder from it.
      env: { ...(options.env ?? process.env), ...(options.cwd ? { PWD: options.cwd } : {}), [TURN_TAG]: tag },
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
    // Early looks too: a program that moves to a group of its own and whose
    // parent exits at once is only ever seen in its first moments.
    for (const ms of [150, 500]) setTimeout(() => tracker?.sample(), ms).unref();
    let stopped = false;
    let exitCode: number | null | undefined;
    let done = false;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      clearInterval(sampler);
      options.signal?.removeEventListener("abort", onAbort);
      // Children the tool left behind in its group must not outlive it.
      killGroup("SIGKILL");
      // After a cancel or timeout, or once the tool has exited, neither may commands it ran in other groups.
      if (stopped || exitCode !== undefined) {
        tracker?.signal("SIGKILL");
        signalTagged(tag, "SIGKILL");
      }
      const result = (): void => resolve({ exitCode: code, stderr, timedOut, idle, cancelled, spawnError, durationMs: Date.now() - started });
      if (log) log.end(result);
      else result();
    };
    /**
     * The turn ends even if the output never closes. A program the tool started
     * can keep the pipe open after the tool is gone (a server left running in a
     * group of its own); waiting for it would hang the run for as long as it lives.
     */
    const abandonAfter = (ms: number): void => {
      setTimeout(() => {
        if (done) return;
        child.stdout.destroy();
        child.stderr.destroy();
        finish(exitCode ?? null);
      }, ms).unref();
    };
    const stop = (): void => {
      stopped = true;
      tracker?.sample(); // one last look before the parent disappears
      killGroup("SIGTERM");
      tracker?.signal("SIGTERM");
      signalTagged(tag, "SIGTERM");
      setTimeout(() => {
        killGroup("SIGKILL");
        tracker?.signal("SIGKILL");
        signalTagged(tag, "SIGKILL");
      }, KILL_GRACE_MS).unref();
      abandonAfter(KILL_GRACE_MS + ABANDON_MS);
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
    child.on("exit", (code) => {
      exitCode = code;
      tracker?.sample();
      // The tool is gone. Its output normally closes at once; if something it
      // started still holds it, that is stopped, and the turn ends either way.
      setTimeout(() => {
        if (done) return;
        killGroup("SIGKILL");
        tracker?.sample();
        tracker?.signal("SIGKILL");
        signalTagged(tag, "SIGKILL");
        abandonAfter(ABANDON_MS);
      }, EXIT_GRACE_MS).unref();
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

    child.on("close", (code) => finish(code));
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
