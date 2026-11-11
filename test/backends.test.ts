import assert from "node:assert/strict";
import { test } from "node:test";
import { antigravityArgs, antigravityParser } from "../src/backends/antigravity.ts";
import { claudeArgs, claudeParser } from "../src/backends/claude.ts";
import { codexArgs, codexParser } from "../src/backends/codex.ts";
import { addUsage, classifyFailure } from "../src/backends/types.ts";
import type { AgentRequest } from "../src/backends/types.ts";

const base: AgentRequest = { cwd: "/repo", prompt: "hi", access: "read-only", timeoutMs: 1000 };

function feed(parser: { onEvent(e: Record<string, unknown>): void }, events: unknown[]): void {
  for (const event of events) parser.onEvent(event as Record<string, unknown>);
}

test("classifyFailure recognises quota, login and permission messages", () => {
  assert.equal(classifyFailure("You've hit your usage limit. Try again at 2:22 PM."), "quota");
  assert.equal(classifyFailure("429 RESOURCE_EXHAUSTED"), "quota");
  assert.equal(
    classifyFailure("Error authenticating: IneligibleTierError: This client is no longer supported"),
    "auth",
  );
  assert.equal(classifyFailure('permission check failed for unsandboxed "node"'), "permission");
  assert.equal(classifyFailure("something else broke"), "error");
});

test("addUsage keeps unknown values unknown", () => {
  assert.deepEqual(addUsage({ input: 1 }, { input: 2, output: 5 }), {
    input: 3,
    output: 5,
    reasoning: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  });
});

// Event shapes below are trimmed copies of real output captured on 2026-11-11.

test("antigravity: successful run with a structured answer", () => {
  const parser = antigravityParser({});
  feed(parser, [
    { event: "init", conversation_id: "c1", init: { model: "gemini-3.8-flash-low", cwd: "/repo" } },
    { event: "step_update", step_update: { step_index: 0, state: "DONE", step_type: "user_input" } },
    {
      event: "result",
      result: {
        conversation_id: "c1",
        status: "SUCCESS",
        response: "ok\n",
        structured_output: { answer: "pong", number: 42 },
        usage: { input_tokens: 21130, output_tokens: 333, thinking_tokens: 0, cache_read_tokens: 29274 },
      },
    },
  ]);
  const run = parser.result();
  assert.equal(run.stop, "done");
  assert.equal(run.sessionId, "c1");
  assert.equal(run.model, "gemini-3.8-flash-low");
  assert.deepEqual(run.structured, { answer: "pong", number: 42 });
  assert.deepEqual(run.usage, { input: 21130, output: 333, reasoning: 0, cacheRead: 29274 });
});

test("antigravity: a denied command is a permission stop even though status is SUCCESS", () => {
  const parser = antigravityParser({});
  feed(parser, [
    {
      event: "step_update",
      step_update: {
        state: "ERROR",
        step_type: "tool",
        tool_name: "run_command",
        tool_info: { error: { type: "TOOL_ERROR", message: "permission check failed for unsandboxed \"node\"" } },
      },
    },
    {
      event: "result",
      result: {
        status: "SUCCESS",
        response: "",
        usage: { input_tokens: 15704, output_tokens: 139 },
        denied_actions: [{ action: "command", display_name: "RunCommand" }],
      },
    },
  ]);
  const run = parser.result();
  assert.equal(run.stop, "permission");
  assert.match(run.detail ?? "", /permission check failed/);
});

test("antigravity: write access uses accept-edits with a session-only allow rule", () => {
  const args = antigravityArgs({ ...base, access: "write", model: "m", resumeSessionId: "c9" });
  assert.deepEqual(args.slice(0, 2), ["-p", "hi"]);
  assert.ok(!args.includes("--sandbox"));
  assert.equal(args[args.indexOf("--settings") + 1], '{"permissions":{"allow":["command(*)"]}}');
  const narrow = antigravityArgs({ ...base, access: "write", allowCommands: ["node", "npm"] });
  assert.equal(narrow[narrow.indexOf("--settings") + 1], '{"permissions":{"allow":["command(node)","command(npm)"]}}');
  assert.equal(args[args.indexOf("--mode") + 1], "accept-edits");
  assert.equal(args[args.indexOf("--conversation") + 1], "c9");
  assert.equal(antigravityArgs(base)[antigravityArgs(base).indexOf("--mode") + 1], "plan");
});

test("claude: result carries structured output, cost, real model and quota", () => {
  const activity: string[] = [];
  const parser = claudeParser({ onActivity: (a) => activity.push(a.summary) });
  feed(parser, [
    { type: "system", subtype: "init", session_id: "s1", model: "claude-haiku-5-5" },
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "StructuredOutput", input: { answer: "pong" } }] },
    },
    {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        unifiedWindows: { five_hour: { utilization: 0.25 }, seven_day: { utilization: 0.2 } },
      },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "s1",
      result: '{"answer":"pong","number":42}',
      structured_output: { answer: "pong", number: 42 },
      total_cost_usd: 0.134876,
      usage: { input_tokens: 2, output_tokens: 74, cache_read_input_tokens: 0, cache_creation_input_tokens: 33533 },
      modelUsage: { "claude-sonnet-5-5": { outputTokens: 74 } },
      permission_denials: [],
    },
  ]);
  const run = parser.result();
  assert.equal(run.stop, "done");
  assert.equal(run.model, "claude-sonnet-5-5");
  assert.deepEqual(run.structured, { answer: "pong", number: 42 });
  assert.equal(run.costUsdEquivalent, 0.134876);
  assert.equal(run.usage.cacheWrite, 33533);
  assert.deepEqual(run.quotaUsed, { five_hour: 0.25, seven_day: 0.2 });
  assert.equal(activity.length, 1);
});

test("claude: a rejected rate limit turns an error into a quota stop", () => {
  const parser = claudeParser({});
  feed(parser, [
    { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
    { type: "result", subtype: "error_during_execution", is_error: true, result: "request failed" },
  ]);
  assert.equal(parser.result().stop, "quota");
});

test("claude: the prompt is never placed on the command line", () => {
  const args = claudeArgs({ ...base, access: "write", prompt: "SECRET-PROMPT" });
  assert.ok(!args.includes("SECRET-PROMPT"));
  assert.deepEqual(args.slice(-4), ["--allowedTools", "Bash", "Edit", "Write"]);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", "Bash,Edit,Write,Read,Grep,Glob"]);
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--disable-slash-commands"), "no MCP servers or skills from the user's setup");
  const read = claudeArgs(base);
  assert.deepEqual(read.slice(read.indexOf("--tools"), read.indexOf("--tools") + 2), ["--tools", "Read,Grep,Glob"]);
  assert.ok(read.includes("--system-prompt"), "a short system prompt for read-only turns");
});

test("codex: cached input is separated from fresh input, and the answer is parsed", () => {
  const parser = codexParser({ outputSchema: {} });
  feed(parser, [
    { type: "thread.started", thread_id: "t1" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "item_0", type: "agent_message", text: '{"answer":"pong","number":42}' } },
    {
      type: "turn.completed",
      usage: { input_tokens: 20841, cached_input_tokens: 800, cache_write_input_tokens: 0, output_tokens: 19, reasoning_output_tokens: 0 },
    },
  ]);
  const run = parser.result();
  assert.equal(run.stop, "done");
  assert.equal(run.sessionId, "t1");
  assert.equal(run.usage.input, 20041);
  assert.equal(run.usage.cacheRead, 800);
  assert.deepEqual(run.structured, { answer: "pong", number: 42 });
});

test("codex: a failed turn is classified from its message", () => {
  const parser = codexParser({});
  feed(parser, [{ type: "turn.failed", error: { message: "You've hit your usage limit." } }]);
  assert.equal(parser.result().stop, "quota");
});

test("codex: resume sets the sandbox through config", () => {
  assert.deepEqual(codexArgs({ ...base, access: "write" }), ["exec", "--json", "-C", "/repo", "-s", "workspace-write", "-"]);
  const resumed = codexArgs({ ...base, access: "write", resumeSessionId: "t1" });
  assert.deepEqual(resumed.slice(0, 4), ["exec", "resume", "t1", "--json"]);
  assert.ok(resumed.includes('sandbox_mode="workspace-write"'));
});
