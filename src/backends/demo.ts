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
    await wait(Number(process.env.NEUROMESH_DEMO_STEP_MS ?? 900) || 900, r.signal);
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
    return {
      structured: {
        summary: "Two small tasks: a greeting file, then a note about it.",
        tasks: [
          { id: "t1", title: "Write the greeting", brief: "Write neuromesh-demo-t1.txt", owned: ["neuromesh-demo-t1.txt"], depends_on: [], owner: "worker" },
          { id: "t2", title: "Write the note", brief: "Write neuromesh-demo-t2.txt", owned: ["neuromesh-demo-t2.txt"], depends_on: ["t1"], owner: "worker" },
        ],
      },
      usage: { input: 1_500, output: 200 },
    };
  }
  if (has(r, "diagnosis")) return { structured: { diagnosis: "Nothing is wrong.", steps: ["Carry on"] }, usage: { input: 500, output: 50 } };
  const task = /Your task: (.*)/.exec(r.prompt)?.[1];
  const file = task ? `neuromesh-demo-${/note/i.test(task) ? "t2" : "t1"}.txt` : "neuromesh-demo.txt";
  await say("Looking at the project");
  r.onActivity?.({ kind: "tool", summary: "$ ls -la" });
  await say(`Writing ${file}`);
  mkdirSync(r.cwd, { recursive: true });
  writeFileSync(join(r.cwd, file), `Written by the Neuromesh demo backend.\nRequest: ${r.prompt.split("\n").find((l) => l.trim())?.slice(0, 200) ?? ""}\n`);
  r.onActivity?.({ kind: "tool", summary: `edit ${file}` });
  await say("Done");
  // The report is markdown, as real agents write it.
  const summary = [
    `## What I did`,
    ``,
    `Wrote **${file}** with a greeting${task ? ` for *${task}*` : ""}. This is a demonstration: no model was called.`,
    ``,
    `- Created \`${file}\` in the project root`,
    `- Kept every other file as it was`,
    `- Ran the project's checks: all pass`,
    ``,
    `## How to try it`,
    ``,
    "```sh",
    `cat ${file}`,
    "```",
    ``,
    `| File | Lines |`,
    `| --- | --- |`,
    `| ${file} | 2 |`,
    ``,
    `> Nothing else needs doing.`,
  ].join("\n");
  return { structured: { status: "done", summary, notes: "", run: "" }, usage: { input: 3_000, output: 300 } };
}, "demo");
