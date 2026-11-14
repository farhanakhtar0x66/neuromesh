// [F101 blind-tests] Tests written by a developer who never sees the code.
//
// When one model writes an implementation and its tests in the same turn, the
// tests share the implementation's blind spots: both come from one reading of
// the task. A second, cheap turn that gets only the task and the signatures of
// what was written (taken from the files with no model call) reads the task on
// its own, and probes the edges and the long runs the builder did not think of.
//
// A blind test can also be wrong: it may assume behaviour the task never
// states (this project's own hidden checks did, twice). So a failing blind test
// is evidence for the builder to judge, for one turn, and never a gate by
// itself; see the blind step in src/engine/run.ts.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_PATH, symbolsOf } from "../context/packet.ts";

/** Work where a test written from the same reading most often misses what matters: state, parsing, concurrency, limits, algorithms. */
const STATEFUL =
  /\b(state(ful)?|state machines?|pars(e|es|er|ers|ing)|tokeni[sz]\w*|lexers?|grammar|concurren\w*|threads?|thread[- ]safe\w*|async\w*|race conditions?|locks?|locking|mutex\w*|queues?|buffers?|ring ?buf\w*|cach(e|es|ed|ing)|evict\w*|ttl|expir\w*|limits?|limited|bounded|unbounded|overflow\w*|capacity|retr(y|ies)|backoff|debounc\w*|throttl\w*|rate[- ]limit\w*|schedul\w*|algorithms?|sort(s|ed|ing)?|dedup\w*|de-?duplicat\w*|merg(e|es|ing)|rolling|sliding|windows?|paginat\w*|offsets?|intervals?|ranges?|round(s|ed|ing)|precision|unicode|time ?zones?|undo|redo|histor(y|ies)|compact\w*|memory leak\w*|leaks?)\b/i;

/** Whether a task is the kind worth a blind test. */
export function wantsBlindTests(task: string): boolean {
  return STATEFUL.test(task);
}

/** The signatures in the changed code files (not the tests): what a blind tester may know of the work. */
export function signaturesOf(dir: string, changed: string[], maxChars = 6_000): { text: string; files: string[] } {
  const out: string[] = [];
  const files: string[] = [];
  let used = 0;
  for (const path of changed) {
    if (TEST_PATH.test(path)) continue;
    const full = join(dir, path);
    if (!existsSync(full)) continue;
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.length > 200_000 || text.includes("\u0000")) continue;
    const symbols = symbolsOf(path, text);
    if (symbols.length === 0) continue;
    const block = [path, ...symbols.slice(0, 40).map((s) => `  ${s.line}: ${s.text}`)].join("\n");
    if (used + block.length + 1 > maxChars) break;
    out.push(block);
    files.push(path);
    used += block.length + 1;
  }
  return { text: out.join("\n"), files };
}

/**
 * The test could not even be loaded or built: it assumed a module, a name or an
 * export that is not there. That is the test's mistake about the code it could
 * not see, never a finding about the code.
 */
const BROKEN =
  /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|No module named|does not provide an export named|is not exported|unresolved import|cannot find (function|type|value|macro|struct|trait) |could not compile|undefined: \w|has no exported member|TS2305|TS2307|TS2339/;

export function brokenTest(output: string): boolean {
  return BROKEN.test(output);
}

/** A path a blind tester may write: inside the project, new, and not git's or a dependency's. */
export function blindPathOk(dir: string, path: string): boolean {
  const clean = path.replace(/^(\.\/)+/, "");
  if (clean === "" || clean.startsWith("/") || clean.split("/").includes("..") || /^(\.git|node_modules|\.venv|venv)(\/|$)/.test(clean)) return false;
  return !existsSync(join(dir, clean));
}
