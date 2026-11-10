// Backend conformance. Before any preset may use a backend, it has to prove on
// this machine that it can do what a role needs: answer in a fixed shape,
// write files, run commands, stay inside its folder, report usage, resume a
// session, stop when cancelled, and fail loudly instead of hanging.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentBackend, AgentRequest, AgentResult, Usage } from "../backends/types.ts";
import { addUsage } from "../backends/types.ts";

export type ProbeStatus = "pass" | "fail" | "warn" | "skip";

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  detail: string;
}

export interface DoctorReport {
  backend: string;
  version?: string;
  requestedModel?: string;
  answeredBy?: string;
  probes: ProbeResult[];
  /** Input tokens (fresh plus cached) of the smallest call: the price of just starting a session. */
  sessionOverheadTokens?: number;
  liveCalls: number;
  usage: Usage;
  quotaUsed?: Record<string, number>;
}

export const CALLS = ["readonly", "readonly-write", "write", "resume", "containment", "cancel", "error"] as const;
export type CallName = (typeof CALLS)[number];

export interface DoctorOptions {
  model?: string;
  effort?: string;
  /** Scratch folder; a git repository for the backend is created inside it. */
  workRoot: string;
  only?: CallName[];
  callTimeoutMs?: number;
  /** How long to wait for the cancel probe's command to appear. */
  cancelWaitMs?: number;
  onProgress?: (probe: ProbeResult) => void;
  /** Lists running processes as "pid command" lines. Replaced in tests. */
  listProcesses?: () => string[];
}

const PROMPT_TAG = "neuromesh tool check";

const ANSWER_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, number: { type: "integer" } },
  required: ["answer", "number"],
  additionalProperties: false,
};

function psLines(): string[] {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n");
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function totalInput(usage: Usage): number | undefined {
  if (usage.input === undefined && usage.cacheRead === undefined && usage.cacheWrite === undefined) return undefined;
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

function describe(result: AgentResult): string {
  const detail = result.detail ? `: ${result.detail.replace(/\s+/g, " ").slice(0, 220)}` : "";
  return `ended as "${result.stop}"${detail}`;
}

export async function runDoctor(backend: AgentBackend, options: DoctorOptions): Promise<DoctorReport> {
  const id = Math.random().toString(36).slice(2, 10);
  const timeoutMs = options.callTimeoutMs ?? 180_000;
  const wanted = new Set<CallName>(options.only ?? CALLS);
  const listProcesses = options.listProcesses ?? psLines;

  const report: DoctorReport = {
    backend: backend.id,
    requestedModel: options.model,
    probes: [],
    liveCalls: 0,
    usage: {},
  };
  const record = (name: string, status: ProbeStatus, detail: string): void => {
    const probe = { name, status, detail };
    report.probes.push(probe);
    options.onProgress?.(probe);
  };

  report.version = await backend.version();
  if (report.version === undefined) {
    record("installed", "fail", "the command was not found or did not report a version");
    return report;
  }
  record("installed", "pass", report.version.split("\n")[0] ?? "");

  const repo = join(options.workRoot, backend.id);
  const logs = join(options.workRoot, "logs");
  mkdirSync(repo, { recursive: true });
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(repo, "README.md"), "Scratch repository for the Neuromesh doctor.\n");
  const git = (...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=neuromesh", "-c", "user.email=neuromesh@localhost", ...args], {
      cwd: repo,
      stdio: "ignore",
    });
  };
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  const call = async (name: CallName, request: Partial<AgentRequest> & Pick<AgentRequest, "prompt" | "access">) => {
    report.liveCalls += 1;
    const result = await backend.run({
      cwd: repo,
      model: options.model,
      effort: options.effort,
      timeoutMs,
      logPath: join(logs, `${backend.id}-${name}.jsonl`),
      ...request,
    });
    report.usage = addUsage(report.usage, result.usage);
    if (result.quotaUsed) report.quotaUsed = result.quotaUsed;
    return result;
  };

  // 1. Read-only call: fixed-shape answer and usage numbers.
  if (wanted.has("readonly")) {
    const result = await call("readonly", {
      access: "read-only",
      outputSchema: ANSWER_SCHEMA,
      prompt: `This is a ${PROMPT_TAG}. Give your final answer with answer set to "pong" and number set to 42.`,
    });
    report.answeredBy = result.model;
    const answer = result.structured as { answer?: unknown; number?: unknown } | undefined;
    if (result.stop === "done" && answer?.answer === "pong" && answer.number === 42) {
      record("structured answer", "pass", "the final answer matched the JSON schema");
    } else {
      record("structured answer", "fail", `${describe(result)}; got ${JSON.stringify(result.structured ?? result.finalText).slice(0, 160)}`);
    }
    const input = totalInput(result.usage);
    if (input !== undefined && result.usage.output !== undefined) {
      report.sessionOverheadTokens = input;
      record("reports usage", "pass", `input ${input} (fresh ${result.usage.input ?? "unknown"}), output ${result.usage.output}`);
    } else {
      record("reports usage", "fail", `usage was ${JSON.stringify(result.usage)}`);
    }
  }

  // A separate call, because some tools drop the whole answer when an action is refused.
  if (wanted.has("readonly-write")) {
    const file = `ro-${id}.txt`;
    const result = await call("readonly-write", {
      access: "read-only",
      prompt:
        `This is a ${PROMPT_TAG}. Try once to create a file named ${file} in the current directory ` +
        `containing the word blocked. It is fine and expected if you are not allowed to; do not ask for approval ` +
        `and do not try other ways. Final answer: one word, created or refused.`,
    });
    if (existsSync(join(repo, file))) {
      rmSync(join(repo, file), { force: true });
      record("read-only holds", "fail", "the agent created a file while in read-only mode");
    } else {
      record("read-only holds", "pass", `no file was created in read-only mode (${result.stop})`);
    }
  }

  // 2. Write call: create a file and run a command. 3. Resume it.
  const codeword = `kestrel-${id}`;
  let writeSession: string | undefined;
  if (wanted.has("write")) {
    const result = await call("write", {
      access: "write",
      prompt:
        `This is a ${PROMPT_TAG}. Do these steps in order. ` +
        `1) Create a file named probe.txt in the current directory containing exactly: NM_WRITE_${id} ` +
        `2) Run this shell command exactly: node -e "require('fs').writeFileSync('cmd.txt','NM_CMD_'+(6*7))" ` +
        `3) Remember this code word for later: ${codeword}. ` +
        `Final answer: the single word done.`,
    });
    writeSession = result.stop === "done" ? result.sessionId : undefined;
    const read = (name: string): string | undefined =>
      existsSync(join(repo, name)) ? readFileSync(join(repo, name), "utf8") : undefined;
    const written = read("probe.txt");
    if (written?.includes(`NM_WRITE_${id}`)) record("write file", "pass", "probe.txt was created with the right content");
    else record("write file", "fail", `probe.txt was ${written === undefined ? "not created" : "wrong"}; ${describe(result)}`);
    const ran = read("cmd.txt");
    if (ran === "NM_CMD_42") record("run command", "pass", "the shell command ran and its output file is correct");
    else record("run command", "fail", `cmd.txt was ${ran === undefined ? "not created" : JSON.stringify(ran.slice(0, 40))}; ${describe(result)}`);
  }

  if (wanted.has("resume")) {
    if (!writeSession) {
      record("resume session", "skip", "needs a successful write call with a session id");
    } else {
      const result = await call("resume", {
        access: "write",
        resumeSessionId: writeSession,
        prompt: `This is a ${PROMPT_TAG}. What was the code word I asked you to remember? Final answer: only the code word.`,
      });
      if (result.stop === "done" && result.finalText.includes(codeword)) {
        record("resume session", "pass", `remembered the code word; cached input ${result.usage.cacheRead ?? "unknown"}`);
      } else {
        record("resume session", "fail", `${describe(result)}; answer was ${JSON.stringify(result.finalText.slice(0, 80))}`);
      }
    }
  }

  // 4. Containment: can a write-mode agent touch files outside its folder?
  if (wanted.has("containment")) {
    const outside = join(homedir(), `.neuromesh-doctor-escape-${id}.txt`);
    const result = await call("containment", {
      access: "write",
      prompt:
        `This is a ${PROMPT_TAG} for the sandbox. Run this shell command exactly once: ` +
        `node -e "require('fs').writeFileSync('${outside}','x')" ` +
        `It is expected to fail if you are sandboxed. Do not ask for approval and do not try other ways. ` +
        `Final answer: one word, worked or failed.`,
    });
    if (existsSync(outside)) {
      rmSync(outside, { force: true });
      record("stays in its folder", "warn", "a command wrote a file in the home folder; this mode is not sandboxed");
    } else {
      record("stays in its folder", "pass", `could not write outside the working folder (${result.stop})`);
    }
  }

  // 5. Cancel: start a long command, cancel, and make sure nothing survives.
  if (wanted.has("cancel")) {
    const marker = `NM_CANCEL_${id}`;
    const controller = new AbortController();
    const targets = (): string[] => listProcesses().filter((l) => l.includes(marker) && !l.includes(PROMPT_TAG));
    let finished: AgentResult | undefined;
    const running = call("cancel", {
      access: "write",
      signal: controller.signal,
      prompt:
        `This is a ${PROMPT_TAG}. Run this shell command exactly and wait for it to finish: ` +
        `node -e "setTimeout(()=>{},120000)" ${marker}`,
    }).then((result) => {
      finished = result;
      return result;
    });

    const deadline = Date.now() + (options.cancelWaitMs ?? 90_000);
    let seen = false;
    while (Date.now() < deadline && !finished) {
      if (targets().length > 0) {
        seen = true;
        break;
      }
      await sleep(500);
    }
    controller.abort();
    const result = await running;

    if (!seen) {
      record("cancel stops everything", "fail", `the long command never started; ${describe(result)}`);
    } else {
      let leftovers = listProcesses().filter((l) => l.includes(marker));
      for (let i = 0; i < 16 && leftovers.length > 0; i++) {
        await sleep(500);
        leftovers = listProcesses().filter((l) => l.includes(marker));
      }
      if (result.stop === "cancelled" && leftovers.length === 0) {
        record("cancel stops everything", "pass", "the agent and the command it started were both gone after cancel");
      } else {
        record(
          "cancel stops everything",
          "fail",
          `stop was "${result.stop}", ${leftovers.length} process(es) left: ${leftovers.map((l) => l.trim().slice(0, 70)).join(" | ")}`,
        );
        for (const line of leftovers) {
          const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
          if (Number.isInteger(pid) && pid > 1) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // Already gone.
            }
          }
        }
      }
    }
  }

  // 6. Errors: a bad request must fail quickly with a message, not hang.
  if (wanted.has("error")) {
    report.liveCalls += 1;
    const result = await backend.run({
      cwd: repo,
      model: "nm-no-such-model",
      access: "read-only",
      prompt: `This is a ${PROMPT_TAG}. Reply with the word pong.`,
      timeoutMs: 60_000,
      logPath: join(logs, `${backend.id}-error.jsonl`),
    });
    if (result.stop === "done") {
      record("errors are reported", "warn", `an unknown model name was accepted; answered by ${result.model ?? "unknown"}`);
    } else if (result.stop === "timeout") {
      record("errors are reported", "fail", "an unknown model name made the tool hang until the time limit");
    } else {
      record("errors are reported", "pass", describe(result));
    }
  }

  return report;
}

export function formatReports(reports: DoctorReport[]): string {
  const icon: Record<ProbeStatus, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP" };
  const lines: string[] = [];
  for (const report of reports) {
    lines.push("");
    lines.push(
      `${report.backend}  ${report.version?.split("\n")[0] ?? "not installed"}` +
        `  model: ${report.requestedModel ?? "default"}` +
        (report.answeredBy && report.answeredBy !== report.requestedModel ? ` (answered by ${report.answeredBy})` : ""),
    );
    for (const probe of report.probes) {
      lines.push(`  ${icon[probe.status]}  ${probe.name.padEnd(24)} ${probe.detail}`);
    }
    const u = report.usage;
    lines.push(
      `  live calls: ${report.liveCalls}` +
        `   tokens: input ${u.input ?? "unknown"}, cache read ${u.cacheRead ?? "unknown"}, output ${u.output ?? "unknown"}` +
        (report.sessionOverheadTokens !== undefined ? `   session overhead: about ${report.sessionOverheadTokens}` : ""),
    );
    if (report.quotaUsed) {
      const parts = Object.entries(report.quotaUsed).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`);
      lines.push(`  subscription window used: ${parts.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** A backend is usable for a role only when nothing failed. */
export function isConformant(report: DoctorReport): boolean {
  return report.probes.length > 1 && report.probes.every((p) => p.status !== "fail");
}
