// [F136 lean-runner] Claude Code PreToolUse hook: reads the hook event on standard
// input and, for an eligible Bash call, answers with the command rewritten to run
// through lean-run.ts. Any failure here prints nothing and exits 0, which leaves
// the call as the model wrote it (a hook error never blocks the tool).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hookAnswer } from "./leanfilter.ts";

const RUN_SCRIPT = fileURLToPath(new URL("./lean-run.ts", import.meta.url));

try {
  const answer = hookAnswer(JSON.parse(readFileSync(0, "utf8")), RUN_SCRIPT);
  if (answer) process.stdout.write(JSON.stringify(answer));
} catch {
  // Leave the call unchanged.
}
process.exit(0);
