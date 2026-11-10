// Command-line entry point. M0 has one command: doctor.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { backends } from "../backends/index.ts";
import { CALLS, formatReports, isConformant, runDoctor } from "../doctor/doctor.ts";
import type { CallName, DoctorReport } from "../doctor/doctor.ts";

// The cheapest model of each backend is enough to test the plumbing.
const DOCTOR_DEFAULTS: Record<string, { model?: string; effort?: string }> = {
  agy: { model: "gemini-3.8-flash-low" },
  claude: { model: "claude-haiku-5-5" },
  codex: { effort: "low" },
};

const HELP = `neuromesh doctor [options]

Checks that each model backend can do what a role needs, using a few small
live calls per backend (these spend subscription quota).

  --backend a,b     backends to check (default: agy,claude,codex)
  --model a=m,b=m   model to use per backend
  --only x,y        run only these calls: ${CALLS.join(", ")}
  --keep            keep the scratch folder and raw logs
  --json            print the report as JSON
`;

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      i++;
    } else {
      flags.set(arg.slice(2), "true");
    }
  }
  return flags;
}

async function doctor(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const ids = (flags.get("backend") ?? Object.keys(backends).join(",")).split(",").filter(Boolean);
  const models = new Map<string, string>();
  for (const pair of (flags.get("model") ?? "").split(",").filter(Boolean)) {
    const [backend, model] = pair.split("=");
    if (backend && model) models.set(backend, model);
  }
  const only = flags.get("only")?.split(",").filter((c): c is CallName => (CALLS as readonly string[]).includes(c));

  for (const id of ids) {
    if (!backends[id]) {
      console.error(`unknown backend "${id}". Known: ${Object.keys(backends).join(", ")}`);
      return 2;
    }
  }

  // Not the system temp folder: Antigravity's sandbox refuses writes there, and
  // real work will not happen there either.
  const home = join(homedir(), ".neuromesh");
  mkdirSync(home, { recursive: true });
  const workRoot = mkdtempSync(join(home, "doctor-"));
  const reports: DoctorReport[] = await Promise.all(
    ids.map((id) => {
      const backend = backends[id]!;
      const defaults = DOCTOR_DEFAULTS[id] ?? {};
      return runDoctor(backend, {
        model: models.get(id) ?? defaults.model,
        effort: defaults.effort,
        workRoot,
        only,
        onProgress: (probe) => console.error(`[${id}] ${probe.status.toUpperCase()} ${probe.name}: ${probe.detail}`),
      });
    }),
  );

  mkdirSync(".neuromesh", { recursive: true });
  const saved = join(".neuromesh", "conformance.json");
  writeFileSync(saved, JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2) + "\n");

  if (flags.has("json")) console.log(JSON.stringify(reports, null, 2));
  else console.log(formatReports(reports));
  console.error(`\nSaved to ${saved}.` + (flags.has("keep") ? ` Scratch folder kept at ${workRoot}` : ""));
  if (!flags.has("keep")) rmSync(workRoot, { recursive: true, force: true });

  return reports.every(isConformant) ? 0 : 1;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "doctor" && !rest.includes("--help")) {
    process.exitCode = await doctor(rest);
    return;
  }
  console.log(HELP);
  process.exitCode = command === undefined || command === "help" || rest.includes("--help") ? 0 : 2;
}

await main();
