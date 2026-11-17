// track list [--search <query>] [--user <handle>] [--today <YYYY-MM-DD>] [--data <file>]
// Lists issues from a JSON file (default ./issues.json). Exit status: 0 done, 1 failure, 2 bad usage.

import { readFileSync } from "node:fs";
import { formatList } from "./format.ts";
import { Store } from "./store.ts";
import type { Issue, SearchContext } from "./types.ts";

const USAGE = "usage: track list [--search <query>] [--user <handle>] [--today <YYYY-MM-DD>] [--data <file>]";

export function run(argv: string[], out: (line: string) => void, err: (line: string) => void): number {
  const [command, ...rest] = argv;
  if (command !== "list") {
    err(USAGE);
    return 2;
  }
  let search = "";
  let data = "issues.json";
  const context: SearchContext = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const value = rest[++i];
    if (value === undefined) {
      err(`${flag} needs a value`);
      return 2;
    }
    if (flag === "--search") search = value;
    else if (flag === "--user") context.user = value;
    else if (flag === "--data") data = value;
    else if (flag === "--today") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        err("--today must be a date YYYY-MM-DD");
        return 2;
      }
      context.clock = () => new Date(`${value}T12:00:00Z`);
    } else {
      err(`unknown option ${flag}`);
      return 2;
    }
  }
  let issues: Issue[];
  try {
    issues = JSON.parse(readFileSync(data, "utf8")) as Issue[];
  } catch {
    err(`track: cannot read issues from ${data}`);
    return 1;
  }
  try {
    for (const line of formatList(new Store(issues).search(search, context))) out(line);
  } catch (e) {
    err(`track: ${(e as Error).message}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exitCode = run(process.argv.slice(2), (l) => console.log(l), (l) => console.error(l));
