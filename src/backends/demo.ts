// [F19 tui] A scripted backend for trying the interface without spending any
// quota: `neuromesh tui --preset demo`. Its agents pause, report activity,
// write a small file and answer in the formats the engine asks for. No model
// is called. Usage numbers are made up and its model names are priced as
// unknown, so no cost is ever shown for it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeBackend } from "./fake.ts";
import type { AgentRequest } from "./types.ts";

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

function has(r: AgentRequest, field: string): boolean {
  return Boolean((r.outputSchema?.properties as Record<string, unknown> | undefined)?.[field]);
}

export const demo = createFakeBackend(async (r) => {
  const say = async (summary: string): Promise<void> => {
    r.onActivity?.({ kind: "text", summary });
    await wait(900, r.signal);
  };
  if (has(r, "out_of_scope")) {
    await say("Reading the request");
    await say("Writing the spec and design");
    return {
      structured: { name: "Demo", summary: "A demonstration product.", features: ["Shows a greeting", "Has a test"], behaviour: ["Prints hello"], out_of_scope: ["Everything else"], design: ["One module, one test"] },
      usage: { input: 1_000, output: 400 },
    };
  }
  if (has(r, "verdict")) {
    await say("Running the checks and trying the change");
    return { structured: { verdict: "pass", summary: "The demo change does what was asked.", findings: [] }, usage: { input: 2_000, output: 150 } };
  }
  if (has(r, "tasks")) {
    await say("Planning");
    return { structured: { summary: "One task.", tasks: [{ id: "t1", title: "the demo", brief: "Write demo.txt", owned: [], depends_on: [], owner: "worker" }] }, usage: { input: 1_500, output: 200 } };
  }
  if (has(r, "diagnosis")) return { structured: { diagnosis: "Nothing is wrong.", steps: ["Carry on"] }, usage: { input: 500, output: 50 } };
  await say("Looking at the project");
  await say("Writing demo.txt");
  mkdirSync(r.cwd, { recursive: true });
  writeFileSync(join(r.cwd, "neuromesh-demo.txt"), `Written by the Neuromesh demo backend.\nRequest: ${r.prompt.split("\n").find((l) => l.trim())?.slice(0, 200) ?? ""}\n`);
  await say("Done");
  return { structured: { status: "done", summary: "Wrote neuromesh-demo.txt (a demonstration; no model was called).", notes: "", run: "" }, usage: { input: 3_000, output: 300 } };
}, "demo");
