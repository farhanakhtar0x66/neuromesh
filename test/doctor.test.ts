import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { AgentRequest, AgentResult } from "../src/backends/types.ts";
import { isConformant, runDoctor } from "../src/doctor/doctor.ts";

/** A fake agent that behaves the way a healthy backend should. */
function healthy(state: { marker?: string }, overrides: Partial<Record<string, (r: AgentRequest) => Partial<AgentResult>>> = {}) {
  let codeword = "";
  return createFakeBackend((request) => {
    const prompt = request.prompt;
    if (request.model === "nm-no-such-model") return { stop: "error", detail: "unknown model" };
    if (prompt.includes("ro-")) return overrides.readonly?.(request) ?? { stop: "permission", detail: "refused" };
    if (prompt.includes('answer set to "pong"')) {
      return { structured: { answer: "pong", number: 42 }, usage: { input: 100, output: 5, cacheRead: 16000 } };
    }
    if (prompt.includes("NM_WRITE_")) {
      if (overrides.write) return overrides.write(request);
      const id = /NM_WRITE_(\w+)/.exec(prompt)![1];
      codeword = /code word for later: ([\w-]+)/.exec(prompt)![1]!;
      writeFileSync(join(request.cwd, "probe.txt"), `NM_WRITE_${id}\n`);
      writeFileSync(join(request.cwd, "cmd.txt"), "NM_CMD_42");
      return { finalText: "done", usage: { input: 50, output: 3 } };
    }
    if (prompt.includes("What was the code word")) return { finalText: codeword };
    if (prompt.includes("for the sandbox")) return { finalText: "failed" };
    if (prompt.includes("NM_CANCEL_")) {
      state.marker = /NM_CANCEL_\w+/.exec(prompt)![0];
      request.signal?.addEventListener("abort", () => (state.marker = undefined));
      return new Promise<Partial<AgentResult>>(() => {}); // runs until cancelled
    }
    return { finalText: "?" };
  });
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "neuromesh-doctor-test-"));
}

test("a healthy backend passes every probe", async () => {
  const state: { marker?: string } = {};
  const workRoot = scratch();
  try {
    const report = await runDoctor(healthy(state), {
      workRoot,
      callTimeoutMs: 5_000,
      listProcesses: () => (state.marker ? [`123 node -e wait ${state.marker}`] : []),
    });
    const failed = report.probes.filter((p) => p.status !== "pass");
    assert.deepEqual(failed, []);
    assert.equal(report.probes.length, 10);
    assert.equal(report.sessionOverheadTokens, 16100);
    assert.equal(report.liveCalls, 7);
    assert.ok(isConformant(report));
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("a backend that cannot run commands fails, and resume is skipped", async () => {
  const state: { marker?: string } = {};
  const workRoot = scratch();
  try {
    const backend = healthy(state, {
      write: (request) => {
        writeFileSync(join(request.cwd, "probe.txt"), /NM_WRITE_\w+/.exec(request.prompt)![0]);
        return { stop: "permission", detail: "user denied permission to run command" };
      },
    });
    const report = await runDoctor(backend, {
      workRoot,
      callTimeoutMs: 5_000,
      only: ["readonly", "write", "resume"],
    });
    const byName = Object.fromEntries(report.probes.map((p) => [p.name, p.status]));
    assert.equal(byName["write file"], "pass");
    assert.equal(byName["run command"], "fail");
    assert.equal(byName["resume session"], "skip");
    assert.equal(isConformant(report), false);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("writing in read-only mode is caught", async () => {
  const state: { marker?: string } = {};
  const workRoot = scratch();
  try {
    const backend = healthy(state, {
      readonly: (request) => {
        writeFileSync(join(request.cwd, /ro-\w+\.txt/.exec(request.prompt)![0]), "blocked");
        return { finalText: "created" };
      },
    });
    const report = await runDoctor(backend, { workRoot, callTimeoutMs: 5_000, only: ["readonly-write"] });
    assert.equal(report.probes.find((p) => p.name === "read-only holds")?.status, "fail");
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

test("a command that never starts fails the cancel probe", async () => {
  const workRoot = scratch();
  try {
    const backend = createFakeBackend(() => ({ stop: "permission", detail: "denied" }));
    const report = await runDoctor(backend, {
      workRoot,
      callTimeoutMs: 5_000,
      cancelWaitMs: 1_000,
      only: ["cancel"],
      listProcesses: () => [],
    });
    assert.equal(report.probes.find((p) => p.name === "cancel stops everything")?.status, "fail");
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});
