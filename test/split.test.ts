// F106 input-split (plan item M5): a turn's input shared out in five parts. No model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SplitTracker, addSplit, splitFromLog, splitParts } from "../src/usage/split.ts";

const call = (id: string, total: number, blocks: unknown[]) => ({
  type: "assistant",
  message: { id, usage: { input_tokens: 2, cache_read_input_tokens: total - 2 - 100, cache_creation_input_tokens: 100 }, content: blocks },
});
const result = (id: string, chars: number) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "x".repeat(chars) }] } });
const use = (id: string, name: string) => ({ type: "tool_use", id, name, input: {} });

/** start-up 1,000; prompt 2,000 chars = 500 tokens; then a Read of 400 tokens, a Bash of 200, and 60 of the model's own words. */
function stream(): Record<string, unknown>[] {
  return [
    call("m1", 1500, [use("t1", "Read")]),
    result("t1", 1600),
    call("m2", 1500 + 400 + 5, [use("t2", "Bash")]),
    result("t2", 800),
    call("m3", 1500 + 400 + 5 + 200 + 60, [{ type: "text", text: "y".repeat(240) }]),
  ];
}

test("F106: the parts of each call add up to the call's prompt, and the five parts are told apart", () => {
  const t = new SplitTracker({ promptChars: 2000 });
  for (const e of stream()) t.onEvent(e);
  const s = t.result()!;
  assert.equal(s.estimated, true);
  assert.equal(s.startup, 3000); // 1,000 in each of three calls
  assert.equal(s.prompt, 1500); // 500 in each of three calls
  assert.equal(s.files, 400 * 2); // read before calls 2 and 3
  assert.equal(s.commands, 200); // run before call 3
  assert.ok(s.earlier >= 5 && s.earlier <= 70, `earlier ${s.earlier}`);
  const total = 1500 + 1905 + 2165;
  assert.ok(Math.abs(Object.entries(s).filter(([k]) => ["startup", "prompt", "files", "commands", "earlier"].includes(k)).reduce((n, [, v]) => n + (v as number), 0) - total) <= 3, "the parts add up to what the calls read");
});

test("F106: without the prompt's size, start-up and prompt stay together; a resumed session's carry-over is its own part; nothing is made up", () => {
  const log = stream().map((e) => JSON.stringify(e)).join("\n");
  const old = splitFromLog(log)!;
  assert.equal(old.startup, undefined);
  assert.equal(old.prompt, undefined);
  assert.equal(old.startupAndPrompt, 1500 * 3);
  const resumed = splitFromLog(log, { promptChars: 2000, resumed: true })!;
  assert.equal(resumed.startup, undefined);
  assert.equal(resumed.resumed, 1000 * 3);
  assert.deepEqual(splitParts(old).map((p) => p[0]), ["start-up + prompt", "files read", "command output", "earlier turns"]);
});

test("F106: a stream with no per-call usage has no split; splits add", () => {
  assert.equal(splitFromLog('{"type":"result"}\nnot json'), undefined);
  const a = new SplitTracker({ promptChars: 2000 });
  for (const e of stream()) a.onEvent(e);
  const s = a.result()!;
  const two = addSplit(s, s)!;
  assert.equal(two.files, 1600);
  assert.equal(addSplit(undefined, s), s);
});
