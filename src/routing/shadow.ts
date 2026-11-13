// [F88 shadow-eval] The architecture's offline check on the router: a sample
// of the work the cheap tiers passed is kept, and later, when the owner asks
// (`neuromesh routing grade`), a stronger model grades it. A pass it rejects is
// a false negative of the router (it should have started higher), and the
// calibration table (F81) counts it as a failure.
//
// The sample stays on this machine (~/.neuromesh/routing/shadow). Grading is
// live model calls, so it never runs on its own: only the command starts it.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentResult } from "../backends/types.ts";
import type { CascadeTier } from "./router.ts";

export interface ShadowItem {
  run: string;
  task: string;
  title: string;
  /** The task as the developer was given it, cut to a readable size. */
  brief: string;
  cluster?: CascadeTier;
  tier: CascadeTier;
  model?: string;
  diff: string;
  at: string;
}

/** The architecture's 1%. */
export const DEFAULT_SHADOW_RATE = 0.01;
const MAX_DIFF = 60_000;
const MAX_BRIEF = 6_000;

export function shadowDir(home: string): string {
  return join(home, "routing", "shadow");
}

/** Keep this passed task for grading later, with chance `rate`. */
export function maybeEnqueue(home: string, item: Omit<ShadowItem, "at">, rate: number, random: () => number = Math.random): string | undefined {
  if (!(rate > 0) || random() >= rate) return undefined;
  const dir = shadowDir(home);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${item.run}-${item.task.replace(/[^\w-]/g, "_")}.json`);
  const kept: ShadowItem = {
    ...item,
    brief: item.brief.slice(0, MAX_BRIEF),
    diff: item.diff.length > MAX_DIFF ? `${item.diff.slice(0, MAX_DIFF)}\n[... the rest of the diff was cut]` : item.diff,
    at: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(kept, null, 2)}\n`);
  return path;
}

/** Items waiting for a grade, oldest first. */
export function pending(home: string): { path: string; item: ShadowItem }[] {
  const dir = shadowDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => {
      try {
        return [{ path: join(dir, f), item: JSON.parse(readFileSync(join(dir, f), "utf8")) as ShadowItem }];
      } catch {
        return [];
      }
    });
}

/** A graded item moves to graded/, with its grade beside it. */
export function markGraded(home: string, path: string, grade: Grade): void {
  const done = join(shadowDir(home), "graded");
  mkdirSync(done, { recursive: true });
  const name = path.split("/").at(-1)!;
  const item = JSON.parse(readFileSync(path, "utf8")) as ShadowItem;
  writeFileSync(join(done, name), `${JSON.stringify({ ...item, grade }, null, 2)}\n`);
  renameSync(path, join(done, `${name}.done`));
}

export interface Grade {
  verdict: "pass" | "fail";
  summary: string;
}

export const GRADE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    summary: { type: "string" },
  },
  required: ["verdict", "summary"],
};

export function gradePrompt(item: ShadowItem): string {
  return `You are a senior reviewer grading work that a cheaper developer finished and that passed the project's own checks. You are checking the routing, not fixing anything: do not change any files.

The task they were given:
${item.title}
${item.brief}

Their change (a git diff):
${item.diff}

Judge only whether the change does what the task asks, correctly, including the edge cases the task states. Style is not a reason to fail it.

Give your answer in the required JSON format:
- verdict: "pass" if it is correct, "fail" if it is wrong or incomplete in a way the task cares about
- summary: one or two sentences on why`;
}

export function parseGrade(result: AgentResult): Grade | undefined {
  const raw = result.structured as Partial<Grade> | undefined;
  if (!raw || (raw.verdict !== "pass" && raw.verdict !== "fail")) return undefined;
  return { verdict: raw.verdict, summary: typeof raw.summary === "string" ? raw.summary : "" };
}
