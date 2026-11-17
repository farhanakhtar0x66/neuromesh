// remindly next <rule.json> --from <ISO instant> [--count <n>]
// Prints the next occurrences at or after the instant. Exit status: 0 done, 1 bad rule, 2 bad usage.

import { readFileSync } from "node:fs";
import { RuleError } from "./errors.ts";
import { formatOccurrence } from "./format.ts";
import { occurrences } from "./schedule.ts";
import type { Rule } from "./types.ts";

export function run(argv: string[], out: (line: string) => void, err: (line: string) => void): number {
  const [command, file, ...rest] = argv;
  if (command !== "next" || !file) {
    err("usage: remindly next <rule.json> --from <ISO instant> [--count <n>]");
    return 2;
  }
  let from: Date | undefined;
  let count = 5;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--from") from = new Date(rest[++i] ?? "");
    else if (rest[i] === "--count") count = Number(rest[++i]);
    else {
      err(`unknown option ${rest[i]}`);
      return 2;
    }
  }
  if (!from || Number.isNaN(from.getTime())) {
    err("--from needs an ISO instant such as 2026-03-01T00:00:00Z");
    return 2;
  }
  if (!Number.isInteger(count) || count < 1) {
    err("--count must be a positive integer");
    return 2;
  }
  let rule: Rule;
  try {
    rule = JSON.parse(readFileSync(file, "utf8")) as Rule;
  } catch {
    err(`cannot read a rule from ${file}`);
    return 2;
  }
  try {
    for (const t of occurrences(rule, { from, limit: count })) out(formatOccurrence(rule.zone, t));
  } catch (e) {
    if (e instanceof RuleError) {
      err(`remindly: ${e.message}`);
      return 1;
    }
    throw e;
  }
  return 0;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(2), (l) => console.log(l), (l) => console.error(l));
