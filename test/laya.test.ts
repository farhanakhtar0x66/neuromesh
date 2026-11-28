// [F139 laya-gate] The Laya client against an in-process mock server, and the gate's decisions.
// No Laya, no model calls, no network beyond 127.0.0.1.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { disable, enable, resetFeatures } from "../src/features.ts";
import { LayaClient, ROUTING_QUESTIONS, layaConfig, parseLayaResponse } from "../src/routing/laya-client.ts";
import type { LayaConfig, LayaDecision } from "../src/routing/laya-client.ts";
import { decisive, evaluateGate, hardOrUnclear } from "../src/routing/laya-policy.ts";
import type { ProbeFacts } from "../src/routing/probe.ts";
import { conformal, startMockLaya } from "./support/mock-laya.ts";
import type { MockLaya } from "./support/mock-laya.ts";

let laya: MockLaya;
before(async () => {
  laya = await startMockLaya();
});
after(async () => {
  await laya.close();
  resetFeatures();
});
beforeEach(() => {
  resetFeatures();
  enable("laya-gate");
  laya.requests.length = 0;
  laya.health = { json: { ok: true } };
});

const config = (extra: Partial<LayaConfig> = {}): LayaConfig => ({ ...layaConfig({}), url: laya.url, ...extra });
const answers = (mech: boolean, inv: boolean, cheap: boolean, extra: Record<string, Record<string, unknown>> = {}) => ({
  version: "0.5.0",
  answers: [conformal("is_mechanical_or_localized", mech, extra.is_mechanical_or_localized), conformal("has_implied_invariants", inv, extra.has_implied_invariants), conformal("cheap_will_resolve", cheap, extra.cheap_will_resolve)],
});

/** Probe facts of an easy edit (small, low coupling, mechanical, named code) and of a hard one. */
const EASY = { truncated: false, couplingSignal: "low", mechanicalScore: 0.8, resolvedHits: [{ name: "UserDto", files: ["src/dto/UserDto.ts"] }], complexitySignals: [] } as unknown as ProbeFacts;
const HARD = { truncated: false, couplingSignal: "high", mechanicalScore: 0.2, resolvedHits: [], complexitySignals: ["async or concurrent code"] } as unknown as ProbeFacts;

async function ask(reply: MockLaya["reply"], extra: Partial<LayaConfig> = {}): Promise<LayaDecision> {
  laya.reply = reply;
  return new LayaClient(config(extra)).decideRouting("A small repository, with low cross-module coupling on the code the request names.");
}

// ---------------------------------------------------------------------------
// Conformal "auto" answers

test("auto: will resolve, nothing implied: the cheap model continues", async () => {
  const d = await ask({ json: answers(true, false, true) });
  assert.equal(d.status, "ok");
  const g = evaluateGate(HARD, d);
  assert.equal(g.action, "continue_cheap", "decisive conformal answers win over the probe's caution");
  assert.equal(g.conformalAuto, true);
  // One request, the three questions, the state text, JSON.
  assert.equal(laya.requests.length, 1);
  const r = laya.requests[0]!;
  assert.equal(r.method, "POST");
  assert.equal(r.path, "/v1/systemone");
  // laya's documented body: the state, and the questions keyed by id with type and instructions.
  const body = r.body as { state: string; questions: Record<string, { type: string; instructions: string }>; min_confidence?: number };
  assert.deepEqual(Object.entries(body.questions).map(([id, q]) => [id, q.type, q.instructions]), ROUTING_QUESTIONS.map((q) => [q.id, "noul", q.question]));
  assert.match(body.state, /small repository/);
  assert.equal(body.min_confidence, undefined, "no gate asked for unless configured");
  assert.equal(r.headers.authorization, undefined, "no key, no header");
});

test("auto: will not resolve, nothing implied: escalate to Sonnet", async () => {
  const g = evaluateGate(HARD, await ask({ json: answers(false, false, false) }));
  assert.equal(g.action, "escalate_sonnet");
  assert.equal(g.conformalAuto, true);
});

test("auto: will not resolve, invariants implied, but mechanical: escalate to Sonnet", async () => {
  assert.equal(evaluateGate(HARD, await ask({ json: answers(true, true, false) })).action, "escalate_sonnet");
});

test("auto: will not resolve, invariants implied, not mechanical: escalate to Opus", async () => {
  const g = evaluateGate(EASY, await ask({ json: answers(false, true, false) }));
  assert.equal(g.action, "escalate_opus");
  assert.equal(g.conformalAuto, true);
});

test("auto: will resolve but invariants are implied: escalate (never cheap)", async () => {
  assert.equal(evaluateGate(EASY, await ask({ json: answers(false, true, true) })).action, "escalate_opus");
  assert.equal(evaluateGate(EASY, await ask({ json: answers(true, true, true) })).action, "escalate_sonnet");
});

// ---------------------------------------------------------------------------
// Not decisive

test("abstain: escalates conservatively, by the probe, never cheap", async () => {
  const d = await ask({ json: answers(true, false, true, { cheap_will_resolve: { abstain: true } }) });
  assert.equal(d.status, "ok");
  const hard = evaluateGate(HARD, d);
  assert.equal(hard.action, "escalate_opus");
  assert.equal(hard.conformalAuto, false);
  assert.match(hard.reason, /not decisive on cheap_will_resolve/);
  assert.equal(evaluateGate(EASY, d).action, "escalate_sonnet");
  assert.equal(evaluateGate(undefined, d).action, "escalate_opus", "no probe is unclear");
});

test("route review: escalates conservatively", async () => {
  const d = await ask({ json: answers(true, false, true, { has_implied_invariants: { route: "review" } }) });
  assert.equal(evaluateGate(HARD, d).action, "escalate_opus");
  assert.equal(evaluateGate(EASY, d).action, "escalate_sonnet");
});

test("a prediction set of two answers is not decisive, even with route auto", async () => {
  const d = await ask({ json: answers(true, false, true, { cheap_will_resolve: { noul: undefined, prediction_set: ["yes", "no"] } }) });
  assert.notEqual(evaluateGate(EASY, d).action, "continue_cheap");
});

test("unbound true with route auto does not misfire: the decision is the same as without it", async () => {
  const flagged = { unbound: true };
  const d = await ask({ json: answers(true, false, true, { is_mechanical_or_localized: flagged, has_implied_invariants: flagged, cheap_will_resolve: flagged }) });
  assert.equal(d.status === "ok" && d.answers.cheap_will_resolve.unbound, true, "kept for the record");
  const g = evaluateGate(HARD, d);
  assert.equal(g.action, "continue_cheap");
  assert.equal(g.conformalAuto, true);
});

// ---------------------------------------------------------------------------
// Fail-safe: never throws, never blocks, always review

test("a reply slower than the timeout is unavailable, within about the timeout", async () => {
  const started = Date.now();
  const d = await ask({ json: answers(true, false, true), delayMs: 1_500 }, { timeoutMs: 300 });
  const took = Date.now() - started;
  assert.equal(d.status, "unavailable");
  assert.equal(d.status === "unavailable" && d.route, "review");
  assert.match(d.status === "unavailable" ? d.reason : "", /no answer within 300 ms/);
  assert.ok(took < 1_200, `${took} ms`);
  assert.equal(evaluateGate(HARD, d).action, "escalate_opus");
});

test("the default timeout is 500 ms", async () => {
  assert.equal(layaConfig({}).timeoutMs, 500);
  const started = Date.now();
  const d = await ask({ json: answers(true, false, true), delayMs: 900 });
  assert.equal(d.status, "unavailable");
  assert.ok(Date.now() - started < 850);
});

test("HTTP 500 is unavailable", async () => {
  const d = await ask({ status: 500, raw: "Internal Server Error" });
  assert.deepEqual(d.status === "unavailable" && [d.route, d.reason], ["review", "HTTP 500"]);
});

test("malformed JSON and malformed answers are unavailable", async () => {
  const notJson = await ask({ raw: "{answers: oops" });
  assert.match(notJson.status === "unavailable" ? notJson.reason : "", /not JSON/);
  for (const json of [[], { answers: "x" }, { answers: [conformal("cheap_will_resolve", true)] }, answers(true, false, true, { cheap_will_resolve: { route: "maybe" } }), answers(true, false, true, { cheap_will_resolve: { abstain: "no" } }), answers(true, false, true, { cheap_will_resolve: { prediction_set: "yes" } })]) {
    const d = await ask({ json });
    assert.equal(d.status, "unavailable", JSON.stringify(json));
    assert.equal(evaluateGate(EASY, d).action, "escalate_sonnet");
  }
});

test("a server that is not running is unavailable, and is not asked again until the health result expires", async () => {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  let t = 1_000;
  let calls = 0;
  const realFetch = fetch as unknown as ConstructorParameters<typeof LayaClient>[1];
  const counting: typeof realFetch = (url, init) => {
    calls += 1;
    return realFetch!(url, init);
  };
  const client = new LayaClient({ ...layaConfig({}), url: `http://127.0.0.1:${port}` }, counting, () => t);
  const first = await client.decideRouting("x");
  assert.equal(first.status, "unavailable");
  assert.match(first.status === "unavailable" ? first.reason : "", /ECONNREFUSED/);
  const second = await client.decideRouting("x");
  assert.match(second.status === "unavailable" ? second.reason : "", /not asked again yet/);
  assert.equal(calls, 1, "the down sidecar was not asked twice");
  assert.equal(await client.isAvailable(), false);
  t += 31_000;
  await client.decideRouting("x");
  assert.equal(calls, 2, "asked again once the health result expired");
});

test("isAvailable checks the health path once per window; the API key goes as a bearer token", async () => {
  let t = 0;
  const client = new LayaClient(config({ apiKey: "test-key" }), undefined, () => t);
  assert.equal(await client.isAvailable(), true);
  assert.equal(await client.isAvailable(), true);
  assert.equal(laya.requests.filter((r) => r.path === "/health").length, 1);
  assert.equal(laya.requests[0]!.headers.authorization, "Bearer test-key");
  laya.health = { status: 503 };
  t += 31_000;
  assert.equal(await client.isAvailable(), false);
});

test("with F139 off the client asks nothing", async () => {
  disable("laya-gate");
  const d = await ask({ json: answers(true, false, true) });
  assert.equal(d.status, "unavailable");
  assert.equal(laya.requests.length, 0);
});

// ---------------------------------------------------------------------------
// Laya 0.3/0.4 and the parser

test("a Laya 0.3/0.4 answer (no route or abstain) is review, unless the owner calibrated it", () => {
  const legacy = { answers: { is_mechanical_or_localized: { noul: "yes" }, has_implied_invariants: { noul: "no" }, cheap_will_resolve: { value: true } } };
  const d = parseLayaResponse(legacy, { legacyCalibrated: false });
  assert.equal(d.status, "ok");
  assert.equal(d.status === "ok" && d.answers.cheap_will_resolve.route, "review");
  assert.equal(evaluateGate(EASY, d).action, "escalate_sonnet");
  const calibrated = parseLayaResponse(legacy, { legacyCalibrated: true });
  assert.equal(evaluateGate(HARD, calibrated).action, "continue_cheap");
  const unknown = parseLayaResponse({ answers: { ...legacy.answers, cheap_will_resolve: { noul: "unknown" } } }, { legacyCalibrated: true });
  assert.equal(unknown.status === "ok" && unknown.answers.cheap_will_resolve.abstain, true, "unknown is an abstention");
  assert.equal(layaConfig({ NEUROMESH_LAYA_LEGACY_CALIBRATED: "1" }).legacyCalibrated, true);
});

test("decisive needs auto, no abstention, one answer and a yes or no", () => {
  const base = { id: "cheap_will_resolve" as const, value: true, route: "auto" as const, abstain: false, conformal: true };
  assert.equal(decisive(base), true);
  assert.equal(decisive({ ...base, predictionSet: ["yes"] }), true);
  assert.equal(decisive({ ...base, predictionSet: [] }), undefined);
  assert.equal(decisive({ ...base, route: "review" }), undefined);
  assert.equal(decisive({ ...base, abstain: true }), undefined);
  assert.equal(decisive({ ...base, value: undefined }), undefined);
  assert.equal(decisive({ ...base, unbound: true }), true, "unbound never changes it");
  assert.equal(hardOrUnclear(EASY), false);
  assert.equal(hardOrUnclear({ ...EASY, truncated: true }), true);
});

test("configuration comes from the environment, with safe defaults", () => {
  const d = layaConfig({});
  assert.deepEqual([d.url, d.apiKey, d.timeoutMs, d.askPath, d.healthPath, d.legacyCalibrated], ["http://127.0.0.1:8787", undefined, 500, "/v1/systemone", "/health", false]);
  assert.equal(d.minConfidence, undefined);
  assert.equal(layaConfig({ NEUROMESH_LAYA_MIN_CONFIDENCE: "0.8" }).minConfidence, 0.8);
  assert.equal(layaConfig({ NEUROMESH_LAYA_MIN_CONFIDENCE: "2" }).minConfidence, undefined, "outside 0 to 1 is ignored");
  const c = layaConfig({ NEUROMESH_LAYA_URL: "http://127.0.0.1:9000/", NEUROMESH_LAYA_API_KEY: "k", NEUROMESH_LAYA_TIMEOUT_MS: "250", NEUROMESH_LAYA_ASK_PATH: "/ask" });
  assert.deepEqual([c.url, c.apiKey, c.timeoutMs, c.askPath], ["http://127.0.0.1:9000", "k", 250, "/ask"]);
  assert.equal(layaConfig({ NEUROMESH_LAYA_TIMEOUT_MS: "nonsense" }).timeoutMs, 500);
});

test("license boundary: no runtime dependency, and nothing in src names vegaml-learn", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.ok(!Object.keys(pkg.devDependencies ?? {}).some((d) => /vegaml|laya/i.test(d)));
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  for (const file of walk(join(root, "src"))) assert.ok(!/vegaml/i.test(readFileSync(file, "utf8")), file);
});

// Stock laya-serve (the classic Router), as its HTTP API documents it: answers keyed by id, noul the probability
// of yes, confidence fields, and no conformal route or abstain.
const classic = (p: [number, number, number], extra: Record<string, unknown>[] = [{}, {}, {}]) => ({
  model: "typed-decisions",
  answers: Object.fromEntries(ROUTING_QUESTIONS.map((q, i) => [q.id, { type: "noul", noul: p[i], confidence: 0.9, answer_confidence: 0.9, action: { act_probability: 0.5 }, ...extra[i] }])),
  usage: { input_tokens: 80, output_tokens: 3 },
  routing: { model: "typed-decisions" },
});

test("stock laya-serve: a probability of yes is read, but with no conformal fields every answer is review unless calibrated", () => {
  const d = parseLayaResponse(classic([0.91, 0.08, 0.77]), { legacyCalibrated: false });
  assert.equal(d.status, "ok");
  if (d.status !== "ok") return;
  assert.deepEqual(ROUTING_QUESTIONS.map((q) => [d.answers[q.id].value, d.answers[q.id].route, d.answers[q.id].conformal]), [[true, "review", false], [false, "review", false], [true, "review", false]]);
  assert.equal(evaluateGate(EASY, d).conformalAuto, false, "the gate does not act on it");
  // Exactly 0.5 is no answer.
  const half = parseLayaResponse(classic([0.5, 0.1, 0.9]), { legacyCalibrated: true });
  assert.ok(half.status === "ok" && half.answers.is_mechanical_or_localized.value === undefined && half.answers.is_mechanical_or_localized.route === "review");
});

test("stock laya-serve, calibrated by the owner: its min_confidence gate decides; abstained or unevaluated is review", () => {
  const calibrated = parseLayaResponse(classic([0.91, 0.08, 0.77]), { legacyCalibrated: true });
  assert.equal(evaluateGate(HARD, calibrated).action, "continue_cheap");
  const gated = parseLayaResponse(classic([0.91, 0.08, 0.77], [{ abstention: "passed" }, { abstention: "abstained", low_confidence: true }, { abstention: "unevaluated" }]), { legacyCalibrated: true });
  assert.ok(gated.status === "ok");
  if (gated.status !== "ok") return;
  assert.deepEqual(ROUTING_QUESTIONS.map((q) => [gated.answers[q.id].route, gated.answers[q.id].abstain]), [["auto", false], ["review", true], ["review", false]]);
  assert.equal(evaluateGate(HARD, gated).action, "escalate_opus", "not decisive: escalate by the probe");
});

test("min_confidence goes in the request body when configured", async () => {
  const client = new LayaClient({ ...layaConfig({}), url: laya.url, minConfidence: 0.85 });
  laya.reply = { json: classic([0.9, 0.1, 0.9]) };
  await client.decideRouting("state");
  assert.equal((laya.requests.at(-1)!.body as { min_confidence?: number }).min_confidence, 0.85);
});

test("laya.Agent's conformal answer: a one-answer prediction set is the answer, over the noul probability", () => {
  const body = { answers: Object.fromEntries(ROUTING_QUESTIONS.map((q) => [q.id, { type: "noul", noul: 0.4, route: "auto", abstain: false, prediction_set: ["yes"], unbound: false }])) };
  const d = parseLayaResponse(body, { legacyCalibrated: false });
  assert.ok(d.status === "ok" && ROUTING_QUESTIONS.every((q) => d.answers[q.id].value === true && d.answers[q.id].conformal));
});
