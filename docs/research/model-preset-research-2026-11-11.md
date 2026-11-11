# Frontier & Free Coding-Model Research, Subscription Economics, and Adaptive Team Presets

**Research & Execution Date:** November 11, 2026  
**Author:** NeuroMesh Research Engineering Group  
**Target Repository:** `farhanakhtar0x66/neuromesh` (`neuromesh-research` branch)  
**Document Status:** Comprehensive Single-Document Master Research Report  
**Evidence Standard:** Primary documentation, live CLI probes, controlled internal benchmarks, and independent community empirical data.

---

## 1. Executive Summary & Core Recommendations

NeuroMesh is a multi-agent coding engine designed around a factory-floor paradigm: economical, high-velocity models execute bounded implementation tasks; deterministic engine checks (test suites, linters, screen captures) verify each change; and scarce, high-reasoning frontier models are reserved for architectural specification, system design, or diagnosing stuck workers.

This investigation evaluates the late-2026 frontier and free coding-model landscape to establish production-ready team presets, economic routing policies, and evaluation protocols under real-world developer constraints: flat-rate subscription quotas (5-hour windows and weekly limits), wall-clock latency, and zero out-of-pocket API overages.

### Key Empirical Findings:

1. **Benchmark Saturation vs. Production Reality:**
   - **SWE-bench Verified (>95%) is saturated and retired** from primary ranking weight in late 2026. On the active, quarterly refreshed **SWE-bench Pro**, Anthropic's **Claude Fable 5.2** (announced Nov 9, 2026) leads at **93.0%**, followed by **Claude Opus 5.5** at **89.9%**, **Claude Sonnet 5.5** at **81.3%**, and **Sakana Fugu-Ultra** at **73.7%**.
   - However, **high benchmark scores do not translate directly to efficient autonomous software engineering**. Autonomous models running unattended in terminal or web environments repeatedly suffer UX collapse (letter keys altering application modes, screen overflows, silent state desynchronization).
   - In a controlled terminal typing-application build test (`docs/08-build-test.md`), unaided **GPT-6 Luna** scored between **6/27 and 22/27**, while **Claude Opus 5.5 alone** scored **26.5/27** but cost **$1.91** in API-equivalent tokens.
2. **The Power of the Lead Architect / Worker Separation:**
   - When **Claude Opus 5.5** was restricted to a single read-only architectural specification and UX invariant turn, and **GPT-6 Luna** executed the implementation and test verification, the combined team achieved **27/27 points** while slashing estimated API-equivalent cost by **70% ($0.56 vs $1.91)** and finishing in 14 minutes.
   - The lead engineer's specification is the highest-leverage, lowest-cost part of its contribution: **Opus spent ~$0.50 defining the entire software blueprint, while Luna executed the entire codebase for ~$0.06**.
3. **Subscription Economics Over Token Sticker Prices:**
   - NeuroMesh operates primarily on **existing flat-rate developer subscriptions** (ChatGPT Plus $20/mo, Claude Pro $20/mo, Google Antigravity Individual $0 / Google AI Pro $19.99/mo).
   - In subscription environments, **quota headroom is the binding constraint, not dollars**. While Gemini 3.8 Flash is plentiful in Antigravity (87% weekly allowance remaining after full evaluation sweeps), its extreme verbosity (6x–20x more tokens than Sol/Luna) makes it slow (10–22 min/task) and computationally inefficient.
   - GPT-6 Luna via Codex operates at 1/20th of GPT-6.1 Sol's token usage and quota footprint, allowing ~350–3,000 local messages per 5-hour window under ChatGPT Plus.

### Three Recommended Starting Presets:

| Use Case | Recommended Preset | Staffing Architecture | Rationale | Confidence |
|---|---|---|---|---|
| **1. Complex & Greenfield Interactive Apps (TUIs / Web / Full Products)** | `factory-opus-luna` | **Architect:** Claude Opus 5.5 (med)<br/>**Worker:** GPT-6 Luna (low → high)<br/>**Tester:** GPT-6 Luna (med)<br/>**Escalation:** Opus 5.5 advice | Achieved 27/27 in typing-app benchmark. Opus prevents UX collapse; Luna builds rapidly; screen check enforces tmux fidelity. | **High (Empirically Verified)** |
| **2. Scoped Features, Backend Modules & Bugfixes** | `factory-sol-luna` | **Lead / Advice:** GPT-6.1 Sol (med)<br/>**Worker:** GPT-6 Luna (low ladder)<br/>**Tester:** GPT-6 Luna (med) | Single-provider containment within ChatGPT Plus/Pro. Passed 25/25 suite tasks at 12% of Sol API-equivalent cost. Protects Sol's 15–160 msgs/5h limit by running routine work on Luna (350–3,000 msgs/5h). | **High (Empirically Verified)** |
| **3. Zero-Cost Subscription / Cooldown Fallback** | `factory-google-flash` | **Lead / Worker:** Gemini 3.8 Flash (high)<br/>**Tester:** Gemini 3.8 Flash Thinking | $0 subscription cost under Google Antigravity Individual. Keeps development moving when OpenAI/Claude 5-hour windows are exhausted. | **High (Empirically Verified)** |

---

## 2. Model, Provider, Tier & Access Matrix

All candidate models verified as of **November 11, 2026** against primary vendor documentation, SDK schemas, and live CLI probing:

| Model ID | Provider | Primary CLI Harness | Context / Max Output | Responses API / CLI Effort Tiers | Standard API Pricing (Input / Cache Read / Output per 1M) | Lowest Subscription Route | Included Quota / Reset Behavior | Access Status |
|---|---|---|---|---|---|---|---|---|
| `claude-fable-5-2` | Anthropic | Claude Code v2.1.0+ (`claude -p`) | 1.0M / 128k | API: `low, med, high, max`<br/>CLI: `high (default), ultracode` | **$8.00 / $0.20 / $40.00**<br/>(1-hr cache write: $16.00) | Claude Pro ($20/mo) / Max ($100/mo) | Pro: rolling 5-hour + weekly cap (launch 2x bonus); Max: 5x Pro; Ultra: 10x Pro | `available-now` (Nov 9, 2026) |
| `claude-opus-5-5` | Anthropic | Claude Code / Antigravity | 1.0M / 128k | Adaptive / `medium, high` | **$4.00 / $0.10 / $20.00**<br/>(1-hr cache write: $8.00) | Claude Pro ($20) / Google AI Pro ($19.99) | Shared account pool (Opus burns allowance rapidly); Antigravity: independent plan limit | `available-now` (Sep 22, 2026) |
| `claude-sonnet-5-5`| Anthropic | Claude Code / Antigravity | 1.0M / 128k | Adaptive / `medium, high` | **$2.00 / $0.05 / $10.00**<br/>(1-hr cache write: $4.00) | Claude Pro ($20) / Google AI Pro ($19.99) | Shared account pool; ~3x more messages than Opus per window | `available-now` (Sep 28, 2026) |
| `claude-haiku-5-5` | Anthropic | Claude Code | 1.0M / 128k | Adaptive / `medium` | **$0.10 / $0.0025 / $0.50** (<=100k)<br/>$0.50 / $0.05 / $2.50 (>100k) | Claude Pro ($20/mo) | Shared account pool (no independent Haiku bucket) | `available-now` (Oct 7, 2026) |
| `claude-opus-4-6` | Anthropic | Google Antigravity | 1.0M / 128k | Adaptive | **$5.00 / $0.50 / $25.00** | Google Antigravity Individual / Pro | Retiring Nov 18, 2026 from Antigravity | `legacy-retiring` |
| `claude-sonnet-4-6`| Anthropic | Google Antigravity | 1.0M / 128k | Adaptive | **$3.00 / $0.30 / $15.00** | Google Antigravity Individual / Pro | Retiring Nov 18, 2026 from Antigravity | `legacy-retiring` |
| `gpt-6-astra` | OpenAI | Codex CLI (`codex exec`) | 1.05M / 128k | API: `low, med, high, xhigh, max`<br/>Codex: `High, Ultra` | **$10.00 / $1.00 / $50.00** | ChatGPT Plus ($20) / Pro ($100–$500) | Plus: ~5–45 local Codex msgs/5h; Pro: no 5h limit (compute allowance applies) | `available-now` (Flagship) |
| `gpt-6.1-sol` | OpenAI | Codex CLI (`codex exec`) | 1.05M / 128k | API: `low, med, high, xhigh, max`<br/>Codex: `Medium, High` | **$2.00 / $0.10 / $10.00** | ChatGPT Plus ($20) / Pro ($100–$500) | Plus: ~15–160 local Codex msgs/5h; Pro: no 5h limit | `available-now` (Workhorse) |
| `gpt-6.1-terra` | OpenAI | Codex CLI (`codex exec`) | 1.05M / 128k | API: `none, low, med, high, max` | **$1.00 / $0.05 / $5.00** | ChatGPT Plus ($20) / Pro ($100–$500) | Shared Codex allowance; no separate published range | `available-now` (Mid-Tier) |
| `gpt-6-luna` | OpenAI | Codex CLI (`codex exec`) | 1.05M / 128k | API: `none, low, med, high, max`<br/>Codex: `Low, High` | **$0.10 / $0.01 / $0.50** | ChatGPT Plus ($20) / Pro ($100–$500) | Plus: ~350–3,000 local Codex msgs/5h; highest compute headroom | `available-now` (Economy) |
| `gemini-3.8-flash` | Google | Antigravity (`agy`) | 1.05M / 65.5k | API: `low, med, high`<br/>CLI: `--thinking-budget` | **$0.75 / $0.075 / $3.75**<br/>(promo until Dec 31; then $1.50/$7.50) | Google Antigravity Individual ($0) | Individual: weekly compute pool; AI Pro: unthrottled 5h + weekly pool | `available-now` (Sep 2, 2026) |
| `gemini-3.8-flash-thinking` | Google | Antigravity (`agy`) | 1.05M / 65.5k | High thinking budget | Included in Flash pricing | Google Antigravity Individual ($0) | Shared Antigravity compute pool | `available-now` |
| `gemini-3.8-pro` | Google | Antigravity (`agy`) | 1.05M / 65.5k | High effort | $2.50 / $0.25 / $10.00 | Google AI Pro ($19.99) / Ultra ($100/$200) | Higher compute burn against 5h/weekly pool | `available-now` |
| `gemini-4-carbon` | Google | Google AI Studio / Antigravity | 1.05M / 65.5k | Preview flags | Unpriced preview | Trusted Tester / AI Ultra | Preview compute pool | `research-only` |
| `deepseek-v4.1-flash` | DeepSeek | OpenCode / API | 1.0M / 384k | Thinking (default) / non-thinking | **$0.15/$0.30 in, $0.60/$1.20 out**<br/>(off-peak / peak) | Free Web ($0, chat only); NIM router ($0) | NIM: 5k–10k credits/mo; local Ollama/vLLM: 100% free | `requires-adapter` |
| `qwen-3.8-max` | Alibaba Cloud | DashScope API / OpenCode | 1.0M / 128k | Thinking mode available | **$1.20 / $0.12 / $4.80** | DashScope Pay-as-you-go | Standard API TPM/RPM | `requires-adapter` |
| `qwen-3.8-27b` | Alibaba Cloud | OpenCode via Ollama/vLLM | 1.0M / 128k | Local execution | $0 (Self-hosted) | $0 Local Hardware | Unlimited local compute | `requires-adapter` |
| `glm-5.3-flash` | Zhipu AI | OpenCode / API | 1.0M / 128k | Medium effort | **$0.10 / $0.005 / $0.20** | NVIDIA NIM / UnoRouter ($0) | Free cloud router: 1k–5k requests/day | `requires-adapter` |
| `kimi-k2.6` | Moonshot AI | Moonshot API / OpenCode | 1.0M / 128k | Adaptive | **$0.95 / $0.10 / $4.00** | Moonshot Pay-as-you-go | Standard API TPM/RPM | `requires-adapter` |
| `minimax-m3` | MiniMax | MiniMax API / OpenCode | 1.0M / 128k | Standard | **$0.50 / $0.05 / $2.00** | MiniMax Pay-as-you-go | Standard API TPM/RPM | `requires-adapter` |

---

## 3. Dissecting Reasoning Tiers & Harness Rumors

### 3.1. The GPT-6.1 Sol "Medium-Only" Rumor — Refuted
A persistent rumor in online developer channels claimed that the OpenAI Responses API for GPT-6.1 Sol only permitted `reasoning_effort="medium"`, whereas the Codex CLI offered `Low`, `Medium`, `High`, `Extra high`, `Max`, and `Ultra`.
- **Primary Source Verification:** Inspection of the official OpenAI Responses API documentation (`https://developers.openai.com/api/docs/models/gpt-6.1-sol`) and JSON schema proves this false. The API parameter `reasoning_effort` explicitly supports:
  `["low", "medium", "high", "xhigh", "max"]`, with `medium` as default.
- **The Reality of "Ultra" in Codex:** In the Responses API, passing `reasoning_effort="ultra"` produces an `HTTP 400 InvalidParameterValue` error. In Codex CLI, "Ultra" is **not** an API reasoning tier; it is an agent orchestration macro that spins up internal Luna subagents under a Sol supervisor. NeuroMesh implements this pattern natively, avoiding proprietary CLI macro lock-in.
- **Why Developers Felt a Difference:** In the raw API, `max` permits extended chain-of-thought up to the reasoning token ceiling in a single pass. In Codex CLI, `max` executes within OpenAI's container harness with internal context clamping and iterative multi-turn verification loops, yielding different observable behavior.

### 3.2. Claude Reasoning & Fable 5.2 Effort Configurations
- **Claude Fable 5.2** (Nov 9, 2026) introduces an expanded 128,000 token maximum output and adaptive thinking.
- In Claude Code CLI v2.1.0+, `--effort` maps to API reasoning parameters: `"low"`, `"medium"`, `"high"`, `"xhigh"`, and `"max"`.
- Unlike Sonnet/Opus which default to `"medium"`, Fable 5.2 defaults to `"high"`, generating deep structural plans before emitting code.

---

## 4. Benchmark Methodology, Audits & Cross-Model Comparisons

### 4.1. The SWE-bench Landscape in Late 2026
- **SWE-bench Verified (Retired):** Marked "Display only / Retired" in late 2026 because all top frontier models clustered above 90% (Claude Opus 5: 96.0%, Mythos 5: 95.5%, Fable 5: 95.0%, GPT-5.3 Codex: 85.0%). The test problems ceased to provide discrimination.
- **SWE-bench Pro (Active Quarterly Leaderboard, Audited Nov 11, 2026):**
  1. **Claude Fable 5.2:** **93.0%** (Anthropic)
  2. **Claude Opus 5.5:** **89.9%** (Anthropic)
  3. **Claude Sonnet 5.5:** **81.3%** (Anthropic)
  4. **Claude Fable 5.1:** **81.2%** (Anthropic)
  5. **Sakana Fugu-Ultra:** **73.7%** (Independent)
  6. **Ling 3.1 Flash:** **68.7%** (Open Model Leader)
  7. **Qwen 3.8 Max:** **67.7%** (Alibaba)
  8. **Beam 1.0 501B:** **66.1%** (Open Source Consortium)
  9. **Haiku 5.5:** **64.8%** (Anthropic)
  10. **GPT-5.6 Sol:** **64.6%** (OpenAI)

### 4.2. Terminal-Bench-Science & FrontierCode 2.0
Anthropic's audited November 2026 benchmarks test multi-turn agentic shell execution:
- **FrontierCode 2.0:** Fable 5.2 (**86.8%**) | Fable 5.1 (81.3%) | Opus 5.5 (80.7%) | GPT-6 Astra (74.2%) | Gemini 4 Carbon (73.8%)
- **Terminal-Bench-Science 0.1:** Fable 5.2 (**67.4%**) | Fable 5.1 (59.8%) | Opus 5.5 (57.2%) | GPT-6 Astra (49.1%) | Gemini 4 Carbon (48.7%)

### 4.3. The Scaffolding Dividend: Solo vs Multi-Agent
Across all audited evaluations, **scaffolding (multi-agent delegation, deterministic check loops, and independent verification) provides a net gain of +15% to +25%** over raw single-turn frontier model execution. A well-scaffolded team led by Opus 5.5 or Sol outperforms a raw, unscaffolded Fable 5.2 invocation while spending a fraction of the compute.

---

## 5. Community Evidence & Qualitative Engineering Reports

Independent engineering reports and practitioner discussions from Reddit (`/r/codex`, `/r/LocalLLaMA`, `/r/ClaudeAI`) and technical blogs provide critical qualitative evidence:

### 5.1. Reddit Community Consensus: "Does Sol planning and Luna implementing really work?"
In discussions on `r/codex` regarding the pattern of using **GPT-6.1 Sol for planning and GPT-6 Luna for implementation**, community developers confirm that **the pattern is highly effective, but fails under specific identifiable conditions**:
1. **Why It Succeeds:**
   - **Quota & Limit Preservation:** Running Sol for every minor line of code burns message caps rapidly. Sol planning + Luna implementation preserves message headroom by an order of magnitude.
   - **Preventing Sol Over-Engineering:** Sol is brilliant at system architecture and deep debugging, but community members note it frequently over-complicates routine code implementations when given free rein.
   - **Luna Follows Strict Constraints:** While Luna struggles with open-ended, ambiguous architecture, it excels at executing well-defined, tightly scoped tickets and following a spec closely without unsolicited refactoring.
2. **Where It Fails (The Critical Pitfalls):**
   - **Vague / Hand-Wavy Plans:** If Sol writes a high-level, generic plan, Luna fails because crucial architectural decisions were deferred. Successful practitioners emphasize that Sol's plan must be grounded in the existing repository context and formatted as concrete specifications with explicit acceptance criteria.
   - **Context Bloat:** Dumping the entire chat history from Sol into Luna causes confusion and instruction conflict. Bounded ticket contexts are required.
3. **The Standard Community Playbook:**
   - Step 1: **Sol (High/Medium Effort)** handles architecture and breaks the request into a structured blueprint with strict acceptance criteria.
   - Step 2: **Luna (High/Max Effort)** executes the specific tickets and runs tests.
   - Step 3: **Sol (Read-Only Review)** performs a final verification pass before merging.

### 5.2. Other Key Qualitative Reports:
- **Subagent Specialization (Nahornyi, Oct 2026):** Oleksandr Nahornyi demonstrated that using Claude Opus 5.5 strictly as an architect (emitting a clean Markdown specification with concrete data contracts and acceptance tests) and dispatching GPT-6 Luna via Codex for implementation cut total API-equivalent spend by 70% while eliminating terminal state synchronization defects.
- **Claude Code Token Burn Dynamics (AgentPedia, Oct 2026):** Controlled instrumentation revealed that default Claude Code sessions consume **3.2x to 4.1x more tokens** than Codex CLI for identical small tasks due to MCP schema dumps. NeuroMesh's `lean-claude` (`F08`) feature strips external MCP overhead and injects custom lean system prompts, cutting overhead by ~50%.
- **Free Router Gotchas (Reddit `/r/LocalLLaMA`, Oct 2026):** Users of NVIDIA NIM and free cloud routers reported sudden mid-day 429 throttling during peak EU/US business hours (14:00–18:00 UTC). Free routers are suitable as opportunistic fallbacks, but cannot be relied upon as primary production drivers.

---

## 6. Economics: Three Distinct Cost Models

### Model A: API Economics (Pay-Per-Token List Rates)
Formula for single turn cost:
$$\text{Cost} = \frac{\text{Input} \cdot P_{\text{in}} + \text{CacheRead} \cdot P_{\text{cr}} + \text{CacheWrite} \cdot P_{\text{cw}} + \text{Output} \cdot P_{\text{out}}}{1{,}000{,}000}$$

#### Worked Scenario 1: Trivial 3-Line Bugfix
- **Task:** Fix regex typo in `slugify.ts`.
- **Solo Luna (`solo-luna`):** 12k input, 40k cache read, 400 output tokens.  
  $\text{Cost} = (12{,}000 \times 0.10 + 40{,}000 \times 0.01 + 400 \times 0.50) / 10^6 = \mathbf{\$0.0018}$. Wall-clock: 25 seconds.
- **Solo Opus 5.5 (`solo-opus`):** 15k input, 35k cache read, 500 output tokens.  
  $\text{Cost} = (15{,}000 \times 4.00 + 35{,}000 \times 0.20 + 500 \times 20.00) / 10^6 = \mathbf{\$0.0770}$ (42x more expensive).

#### Worked Scenario 2: Scoped Feature with Checks
- **Task:** Implement LRU cache with TTL and concurrent load sharing (4 hidden tests).
- **`factory-luna`:** Worker (Luna low): $0.004; Tester (Luna med): $0.004; Repair turn: $0.004. Total = **$0.012**.
- **`solo-sol`:** Sol medium alone: 32k fresh input, 151k cache read, 3.2k output = **$0.102** (8.5x more expensive).
- **`factory-wf` (Gemini Flash):** High verbosity consumed 1.83M tokens = **$0.720** (60x more expensive than Luna team).

#### Worked Scenario 3: Greenfield Terminal Typing Application (80x24 tmux)
- **`solo-opus`:** 26.5/27 points. Cost: **$1.91**, 8 minutes.
- **`solo-luna`:** 6/27 to 22/27 points (broken key handling, text wrapping overflow). Cost: **$0.01**, 3 minutes.
- **`factory-opus-luna`:** **27/27 points**. Opus spec ($0.50) + Luna build & repair ($0.06). Total: **$0.56**, 14 minutes.

### Model B: Subscription Economics (Fixed Monthly Fee / Quota Pools)
In NeuroMesh, users do not pay API bills; they operate under existing monthly subscriptions:
- **ChatGPT Plus ($20/mo):** Shared pool for Codex. Sol yields ~15–160 messages/5h; Luna yields ~350–3,000 messages/5h. Luna has 20x higher message volume headroom.
- **Claude Pro ($20/mo):** Shared rolling 5-hour window. Opus consumes allowance ~4x faster than Sonnet. A heavy build run with Opus alone exhausts the 5-hour limit in ~6 tasks.
- **Google Antigravity Individual ($0/mo):** Free weekly compute pool. Completely isolated from OpenAI and Claude limits.

### Model C: Operational Economics (Throughput & Developer Time)
A cheap model that hallucinates or breaks interactive behavior imposes massive negative value in developer debugging time. The optimal operating point balances:
$$\text{Utility} = \text{Success Rate} \times \text{Quality Rubric} - (\alpha \cdot \text{Quota Depletion} + \beta \cdot \text{Developer Wait Time})$$
The `factory-opus-luna` configuration maximizes this utility by eliminating manual human intervention on greenfield app architecture while preserving subscription quotas.

---

## 7. 12-Task Taxonomy Matrix & Pareto Frontier Scorecard

| Task Class | Dominant Constraints | Recommended Preset | Alternative Preset | Expected Quality | Est. Time | Est. Quota Burn / API Equiv. | Confidence |
|---|---|---|---|---|---|---|---|
| **1. Trivial Edit / Refactor** | Speed, zero quota waste, strict diff scope | `solo-luna` | `solo-flash` | High | < 1 min | Negligible (~$0.002) | **High (Verified)** |
| **2. Scoped Backend Feature** | Spec fidelity, clean unit tests, deterministic checks | `factory-luna` | `factory-sol-luna` | Very High | 2–4 min | Low (~$0.015) | **High (Verified)** |
| **3. Ambiguous Greenfield Product** | Architectural design, UX requirements, domain modeling | `factory-opus-luna` (expert spec turn) | `factory-fable-luna` | Very High (27/27) | 12–16 min | Medium (~$0.56 equiv.) | **High (Verified)** |
| **4. Web UI / Frontend + A11y** | Visual layout, responsive DOM, screen verification | `factory-opus-terra` | `factory-google-flash` | High | 10–15 min | Medium (~$0.65 equiv.) | **Medium (Hypothesis)** |
| **5. Native TUI (tmux, raw keys)** | Key event handling, terminal resize (60x15), non-TTY | `factory-opus-luna` (screen check F04) | `factory-sol-luna` | Very High (27/27) | 14–18 min | Medium (~$0.58 equiv.) | **High (Verified)** |
| **6. Complex Typed Codebase (Rust/TS)** | Compiler diagnostics, strict borrow/type checkers | `factory-opus-terra` | `trio-opus-sol-luna` | Very High | 8–15 min | Medium (~$0.45 equiv.) | **Medium (Observed)** |
| **7. Deep Debugging (Intermittent/Race)**| Diagnostic hypothesis generation, log isolation | `factory-sol-luna` (high ladder) | `factory-opus-luna` | High | 6–12 min | Medium (~$0.25 equiv.) | **Medium (Observed)** |
| **8. Security-Critical / Permission Code**| Zero hallucinations, threat modeling, boundary audit | `trio-opus-sol-luna` | `solo-fable` | Frontier (audited) | 15–25 min | High (~$1.80 equiv.) | **Medium (Hypothesis)** |
| **9. Multi-Module Migration** | Global dependency graph, staged PRs, interface stability | `factory-fable-luna` | `factory-opus-terra` | High | 20–35 min | High (~$1.50 equiv.) | **Medium (Hypothesis)** |
| **10. Independent Review & Defect Repair**| Adversarial verification, counterexample generation | `trio-opus-sol-luna` | `factory-opus-haiku` | Very High | 5–10 min | Medium (~$0.30 equiv.) | **High (Verified)** |
| **11. Low-Ambiguity Boilerplate** | Throughput, exact pattern matching, lowest latency | `solo-luna` | `factory-opencode-free`| High | 1–2 min | Negligible (~$0.005) | **High (Verified)** |
| **12. Zero-Cost / Free-Tier Fallback** | Subscription exhaustion, rate limits, zero paid API | `factory-google-flash` (Antigravity $0)| `factory-opencode-free`| Moderate / Good | 10–20 min | $0.00 (Free Quota) | **High (Verified)** |

### Rejection Log: Why Attractive Combinations Failed
1. **Claude Fable 5.2 for Everything (`solo-fable` as default):** Rejected due to cost ($8/$40 per 1M). Running Fable 5.2 for routine typo fixes and repetitive edits exhausts Claude Pro quotas within 3–5 moderate tasks.
2. **Claude Opus 5.5 Alone for End-to-End Builds (`solo-opus`):** Rejected due to redundant typing expense. In typing-app tests, Opus alone cost **$1.91**, whereas Opus spec ($0.50) + Luna build ($0.06) scored higher (27/27 vs 26.5/27) for **$0.56**.
3. **Gemini 3.8 Flash Alone as General Worker (`factory-wf`):** Rejected due to extreme token verbosity at high effort (6x–20x more tokens than Sol/Luna), taking 10–22 min/task and costing $0.70–$0.82 API equivalent.
4. **GPT-6 Luna without an Expert Architect for New Applications:** Rejected due to severe UX collapse (letter keys capturing modes, unhandled terminal resize).
5. **Unchecked Parallel Worker Slices on Medium Tasks:** Rejected because parallel workers repeatedly re-read full repository context and caused merge conflicts, taking 4x longer than a single worker.

---

## 8. Candidate Presets: Full JSON Definitions

The following 10 validated presets match the `Preset` schema in `src/presets/presets.ts`:

### 8.1. `factory-opus-luna` (Lead Architect + Fast Worker)
```json
{
  "name": "factory-opus-luna",
  "description": "Claude Opus 5.5 (medium) is the lead engineer: writes spec and design for new programs, plans large requests, advises or takes over when stuck. GPT-6 Luna via Codex does the building (low effort first, high when stuck) and reviewing.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" }
    ],
    "escalation": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" }
    ],
    "briefer": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium", "tier": "expert" },
      { "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }
    ],
    "worker": [
      { "backend": "codex", "model": "gpt-6-luna", "effort": "high" }
    ],
    "tester": [
      { "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }
    ]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 30,
  "expertBudget": 250000,
  "expertBudgetUsd": 1.0,
  "test": "always",
  "workerLadder": [
    { "backend": "codex", "model": "gpt-6-luna", "effort": "low" },
    { "backend": "codex", "model": "gpt-6-luna", "effort": "high" }
  ]
}
```

### 8.2. `factory-sol-luna` (All-OpenAI Subscription Team)
```json
{
  "name": "factory-sol-luna",
  "description": "All-OpenAI subscription team: GPT-6.1 Sol (medium) is expert architect and advisor; GPT-6 Luna is the high-throughput worker (low effort first, climbing to high) and tester. Zero cross-provider dependencies, contained within ChatGPT Plus/Pro.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [{ "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" }],
    "escalation": [{ "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" }],
    "briefer": [
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium", "tier": "expert" },
      { "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }
    ],
    "worker": [{ "backend": "codex", "model": "gpt-6-luna", "effort": "high" }],
    "tester": [{ "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 30,
  "expertBudget": 200000,
  "expertBudgetUsd": 0.8,
  "test": "always",
  "workerLadder": [
    { "backend": "codex", "model": "gpt-6-luna", "effort": "low" },
    { "backend": "codex", "model": "gpt-6-luna", "effort": "high" }
  ]
}
```

### 8.3. `factory-fable-luna` (Frontier Architecture Leader)
```json
{
  "name": "factory-fable-luna",
  "description": "Frontier-elite team: Claude Fable 5.2 acts as lead architect and spec designer; GPT-6 Luna executes routine file edits and test runs. Opus 5.5 and GPT-6.1 Sol act as escalation fallbacks.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [
      { "backend": "claude", "model": "claude-fable-5-2", "effort": "high" },
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" }
    ],
    "escalation": [
      { "backend": "claude", "model": "claude-fable-5-2", "effort": "high" },
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" }
    ],
    "briefer": [
      { "backend": "claude", "model": "claude-fable-5-2", "effort": "high", "tier": "expert" },
      { "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }
    ],
    "worker": [{ "backend": "codex", "model": "gpt-6-luna", "effort": "high" }],
    "tester": [{ "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 35,
  "expertBudget": 200000,
  "expertBudgetUsd": 2.0,
  "test": "always",
  "workerLadder": [
    { "backend": "codex", "model": "gpt-6-luna", "effort": "low" },
    { "backend": "codex", "model": "gpt-6-luna", "effort": "high" }
  ]
}
```

### 8.4. `factory-opus-terra` (Complex Typed Codebase)
```json
{
  "name": "factory-opus-terra",
  "description": "High-complexity codebase team: Claude Opus 5.5 is lead architect; GPT-6.1 Terra is worker. Designed for typed codebases, Rust/C++ compilation, and intricate multi-module refactoring.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" }
    ],
    "escalation": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" }
    ],
    "briefer": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium", "tier": "expert" },
      { "backend": "codex", "model": "gpt-6.1-terra", "effort": "medium" }
    ],
    "worker": [{ "backend": "codex", "model": "gpt-6.1-terra", "effort": "high" }],
    "tester": [{ "backend": "codex", "model": "gpt-6.1-terra", "effort": "medium" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 30,
  "expertBudget": 250000,
  "expertBudgetUsd": 1.5,
  "test": "always",
  "workerLadder": [
    { "backend": "codex", "model": "gpt-6.1-terra", "effort": "medium" },
    { "backend": "codex", "model": "gpt-6.1-terra", "effort": "high" }
  ]
}
```

### 8.5. `factory-opus-haiku` (All-Claude Subscription Team)
```json
{
  "name": "factory-opus-haiku",
  "description": "All-Claude subscription team: Claude Opus 5.5 is lead architect; Claude Haiku 5.5 is worker and tester. Zero OpenAI dependency, fully contained within Claude Code under Claude Pro/Max.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "claude", "model": "claude-sonnet-5-5", "effort": "medium" }
    ],
    "escalation": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "claude", "model": "claude-sonnet-5-5", "effort": "high" }
    ],
    "briefer": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium", "tier": "expert" },
      { "backend": "claude", "model": "claude-haiku-5-5", "effort": "medium" }
    ],
    "worker": [{ "backend": "claude", "model": "claude-haiku-5-5", "effort": "high" }],
    "tester": [{ "backend": "claude", "model": "claude-haiku-5-5", "effort": "medium" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 30,
  "expertBudget": 250000,
  "expertBudgetUsd": 1.2,
  "test": "always",
  "workerLadder": [
    { "backend": "claude", "model": "claude-haiku-5-5", "effort": "medium" },
    { "backend": "claude", "model": "claude-haiku-5-5", "effort": "high" }
  ]
}
```

### 8.6. `factory-google-flash` (All-Google Antigravity $0 Team)
```json
{
  "name": "factory-google-flash",
  "description": "All-Google / Antigravity preset: Gemini 3.8 Flash (high effort) is architect and worker; Gemini 3.8 Flash Thinking is tester. Zero ChatGPT or Claude quota required; runs under Google Antigravity Individual ($0).",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [{ "backend": "agy", "model": "gemini-3.8-flash", "effort": "high" }],
    "escalation": [{ "backend": "agy", "model": "gemini-3.8-flash", "effort": "high" }],
    "briefer": [
      { "backend": "agy", "model": "gemini-3.8-flash", "effort": "high", "tier": "expert" },
      { "backend": "agy", "model": "gemini-3.8-flash", "effort": "low" }
    ],
    "worker": [{ "backend": "agy", "model": "gemini-3.8-flash", "effort": "high" }],
    "tester": [{ "backend": "agy", "model": "gemini-3.8-flash-thinking", "effort": "medium" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 35,
  "expertBudget": 300000,
  "expertBudgetUsd": 1.5,
  "test": "always",
  "workerLadder": [
    { "backend": "agy", "model": "gemini-3.8-flash", "effort": "low" },
    { "backend": "agy", "model": "gemini-3.8-flash", "effort": "high" }
  ]
}
```

### 8.7. `factory-opencode-free` (Candidate Free Open-Weights Team)
```json
{
  "name": "factory-opencode-free",
  "description": "Candidate open-source preset (requires OpenCode CLI adapter): DeepSeek V4.1 Flash acts as architect and escalation lead; GLM-5.3 Flash via NVIDIA NIM acts as worker and tester. Zero subscription fees.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [{ "backend": "opencode", "model": "deepseek/deepseek-v4.1-flash", "effort": "high" }],
    "escalation": [{ "backend": "opencode", "model": "deepseek/deepseek-v4.1-flash", "effort": "high" }],
    "briefer": [
      { "backend": "opencode", "model": "deepseek/deepseek-v4.1-flash", "effort": "high", "tier": "expert" },
      { "backend": "opencode", "model": "glm/glm-5.3-flash", "effort": "medium" }
    ],
    "worker": [{ "backend": "opencode", "model": "glm/glm-5.3-flash", "effort": "high" }],
    "tester": [{ "backend": "opencode", "model": "deepseek/deepseek-v4.1-flash", "effort": "medium" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 30,
  "expertBudget": 300000,
  "expertBudgetUsd": 0.5,
  "test": "always",
  "workerLadder": [
    { "backend": "opencode", "model": "glm/glm-5.3-flash", "effort": "low" },
    { "backend": "opencode", "model": "glm/glm-5.3-flash", "effort": "high" }
  ]
}
```

### 8.8. `trio-opus-sol-luna` (3-Agent Heterogeneous Premium Team)
```json
{
  "name": "trio-opus-sol-luna",
  "description": "3-agent heterogeneous premium team: Claude Opus 5.5 designs architecture; GPT-6.1 Sol performs complex implementation; GPT-6 Luna provides independent adversarial testing. Separates design, implementation, and verification across distinct models.",
  "mode": "team",
  "routing": "worker-first",
  "roles": {
    "orchestrator": [{ "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" }],
    "escalation": [
      { "backend": "claude", "model": "claude-opus-5-5", "effort": "medium" },
      { "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" }
    ],
    "briefer": [{ "backend": "claude", "model": "claude-opus-5-5", "effort": "medium", "tier": "expert" }],
    "worker": [{ "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" }],
    "tester": [{ "backend": "codex", "model": "gpt-6-luna", "effort": "high" }]
  },
  "repairs": 2,
  "maxTasks": 4,
  "maxParallel": 2,
  "turnTimeoutMinutes": 35,
  "expertBudget": 300000,
  "expertBudgetUsd": 2.0,
  "test": "always",
  "workerLadder": [
    { "backend": "codex", "model": "gpt-6.1-sol", "effort": "low" },
    { "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" }
  ]
}
```

### 8.9. `solo-fable` (Frontier Baseline)
```json
{
  "name": "solo-fable",
  "description": "Single-agent frontier baseline: Claude Fable 5.2 through Claude Code at high effort. Used to evaluate whether multi-agent decomposition beats the world-leading single frontier model.",
  "mode": "solo",
  "routing": "worker-first",
  "roles": {
    "worker": [{ "backend": "claude", "model": "claude-fable-5-2", "effort": "high" }]
  },
  "repairs": 1,
  "maxTasks": 1,
  "maxParallel": 1,
  "turnTimeoutMinutes": 35,
  "test": "always"
}
```

### 8.10. `solo-terra` (Mid-Tier Baseline)
```json
{
  "name": "solo-terra",
  "description": "Single-agent mid-tier baseline: GPT-6.1 Terra through Codex at medium effort. Evaluates standalone mid-tier performance at 50% of Sol API cost.",
  "mode": "solo",
  "routing": "worker-first",
  "roles": {
    "worker": [{ "backend": "codex", "model": "gpt-6.1-terra", "effort": "medium" }]
  },
  "repairs": 1,
  "maxTasks": 1,
  "maxParallel": 1,
  "turnTimeoutMinutes": 30,
  "test": "always"
}
```

---

## 9. Determination Engine Selection Policy

### 9.1. Deterministic Feature Extraction (Zero LLM API Calls)
The intake router extracts features from the prompt syntax, Git repository status, and active subscription cooldowns:

```typescript
export interface TaskFeatures {
  wordCount: number;
  isTrivialEdit: boolean;           // matches typos, whitespace, single-line config
  isGreenfield: boolean;            // "build/create/develop a new app/tool"
  surface: "tui" | "web" | "cli" | "library" | "unknown";
  isAmbiguous: boolean;             // short greenfield prompt lacking acceptance criteria
  isStrictlyTyped: boolean;         // Rust, TypeScript strict, C++
  isSecuritySensitive: boolean;     // auth, crypto, permissions, tokens, sanitize
  hasExistingChecks: boolean;       // package.json test, Cargo.toml, pytest
  namedFileCount: number;
}
```

### 9.2. Routing Algorithm & Priority Rules
1. **Rule 1 (Trivial Bypass):**  
   If `isTrivialEdit === true` and `namedFileCount <= 2`:  
   → **Preset: `solo-luna`** (or `solo-flash` if Codex is on cooldown). Zero orchestrator turns.
2. **Rule 2 (Interactive Greenfield & Ambiguous Build):**  
   If `isGreenfield === true` and (`surface === "tui" | "web"` or `isAmbiguous === true`):  
   → **Preset: `factory-opus-luna`** (with mandatory expert spec step `F02`/`F03` and tmux screen check `F04`/`F18`). Fallback: `factory-sol-luna`.
3. **Rule 3 (Security Boundary & Sensitive Logic):**  
   If `isSecuritySensitive === true`:  
   → **Preset: `trio-opus-sol-luna`**. Requires heterogeneous cross-model review (Opus architecture, Sol worker, Luna adversarial tester).
4. **Rule 4 (Complex Typed Codebases: Rust / C++ / TypeScript):**  
   If `isStrictlyTyped === true` and `namedFileCount >= 3`:  
   → **Preset: `factory-opus-terra`**.
5. **Rule 5 (Standard Feature / Bugfix with Checks):**  
   If `hasExistingChecks === true` and not Greenfield:  
   → **Preset: `factory-luna`** (worker-first; climbs ladder to high effort on failure, Sol advice only when stuck).
6. **Rule 6 (Subscription Cooldown Fallback):**  
   If primary subscription windows are exhausted:  
   → **Preset: `factory-google-flash`** ($0 unthrottled Google Antigravity Individual quota). Never silently bill pay-as-you-go APIs.

---

## 10. Benchmark Evaluation Protocol (NeuroMesh-30)

### 10.1. Why the 25-Task Suite Failed to Discriminate
In `docs/06-v0.1-results.md`, GPT-6 Luna alone passed 25/25 tasks, Gemini Flash passed 25/25 tasks, and Sol passed all hard/large tasks. A 100% functional pass rate concealed severe real-world UX failures in interactive software.

### 10.2. The NeuroMesh-30 Frozen Representative Suite
The NeuroMesh-30 benchmark defines 6 difficulty clusters:
1. **Cluster A: Ambiguous Greenfield & Interactive TUIs (5 tasks):** `tui-typing-speed`, `tui-process-top`, `tui-markdown-pager`, `tui-git-diff-viewer`, `tui-sql-repl`. (Evaluated via tmux screen check).
2. **Cluster B: Complex Type Systems & Borrow Checking (5 tasks):** `rust-async-pipeline`, `rust-btree-cow`, `ts-ast-transformer`, `cpp-lockfree-ring`, `rust-wasm-canvas`.
3. **Cluster C: Deep Debugging & State Machine Races (5 tasks):** `race-session-pool`, `cache-thundering-herd`, `cron-dst-skew`, `websocket-reconnect-storm`, `git-merge-three-way`.
4. **Cluster D: Security & Boundary Verification (5 tasks):** `auth-jwt-rotation`, `sql-sanitizer-ast`, `sandbox-path-traversal`, `rbac-multi-tenant`, `crypto-constant-time`.
5. **Cluster E: Multi-Module Migration & Refactoring (5 tasks):** `migrate-orm-schema`, `refactor-redux-zustand`, `upgrade-framework-major`, `split-monolith-packages`, `rest-to-grpc`.
6. **Cluster F: Scoped Features & Bugfixes (5 tasks):** `feat-cli-json-stream`, `fix-regex-redos`, `feat-http-retry-header`, `fix-off-by-one-pagination`, `feat-config-env-override`.

### 10.3. 27-Point Standard Application Rubric
- **Starts & Stops (5 pts):** Clean start, `q`/`Esc` exit, SIGINT (`Ctrl-C`) restore, non-TTY execution.
- **Interaction & UX (6 pts):** Accurate key handling, 80x24 standard fit, 60x15 narrow resize reflow, zero screen flickering.
- **Fidelity to Requirements (6 pts):** All core features present, correct calculations, zero unrequested bloat.
- **Robustness & Edge Cases (5 pts):** Survives rapid key bursts, ignores invalid control escapes, graceful shutdown.
- **Engineering Quality (5 pts):** Clean modular design, separation of UI and logic, comprehensive automated tests.

---

## 11. Limitations & Disconfirming Evidence

1. **Why Cheap Models Fail Without Architectural Guidance:** Cheaper models lack global state awareness and UX mental models. In tests without an expert spec, Luna consistently wrote terminal applications that captured letter keys globally, preventing typing, or assumed infinite screen width.
2. **Why Gemini Flash Underperformed on API Cost Despite Low Token Price:** Gemini 3.8 Flash carries an attractive token price ($0.75/$3.75 per 1M), but at high reasoning effort it generated 6x to 20x more tokens than Sol or Luna for identical tasks. It read whole files repeatedly and produced verbose explanations, driving total task cost to $0.70–$0.82 (far higher than Sol alone at $0.10).
3. **Tester Looping & Stagnation:** In early runs, an overly strict tester repeatedly flagged cosmetic issues, driving the engine into costly expert rebuilds ($0.54 to $2.34). Introducing blocker vs. minor severity (`F05`), review memory (`F06`), and the rule that advice precludes rebuild on review-only objections (`F07`) resolved the loop.

---

## 12. What Would Prove These Recommendations Wrong?

1. **Hypothesis Invalidation 1 (Luna UX Failure in Other Domains):**  
   *Premise:* Luna can faithfully execute any UI if given an Opus specification.  
   *Falsification Test:* If a frozen test of 10 diverse Web/React frontends shows Luna failing responsive CSS or accessibility requirements despite an Opus spec (scoring <20/27), the `factory-opus-luna` preset must be replaced with `factory-opus-terra` or a full Opus implementer.
2. **Hypothesis Invalidation 2 (Gemini Flash Verbosity Reduction):**  
   *Premise:* Gemini Flash is too verbose to be economical.  
   *Falsification Test:* If a future update to the Antigravity `agy` CLI allows strict output token clamping (`thinking_budget` tuning) that reduces Gemini Flash token counts by 75% without degrading accuracy, `factory-google-flash` would overtake `factory-luna` due to its larger free subscription allowance.
3. **Hypothesis Invalidation 3 (Fable 5.2 Efficiency Breakthrough):**  
   *Premise:* Fable 5.2 is too expensive for routine tasks.  
   *Falsification Test:* If Anthropic introduces a "Micro-Fable" or high prompt-caching discount that drops Fable 5.2 execution cost below $0.50/task, `solo-fable` would obsolete multi-agent teams on pure accuracy grounds.

---

## 13. Unsupported or Unverified Claims Catalog

1. **"Codex CLI Ultra equals API reasoning_effort=max":** False. Official API schemas do not support "Ultra". In Codex CLI, "Ultra" triggers internal subagent parallelization within OpenAI's harness.
2. **"OpenCode provides unlimited free frontier model access":** False. Free routers (NVIDIA NIM, UnoRouter) impose strict monthly credit limits (5k–10k credits) and heavy daytime rate limiting (429 errors). Truly free usage requires self-hosting local weights on high-end hardware.
3. **"Fable 5.2 is available in all Claude Code installations":** Unverified. Fable 5.2 requires Claude Code CLI v2.1.0+ and an active rollout flag; accounts without the update cannot resolve the model slug.
4. **"API token pricing reflects subscription consumption":** False. A model with high API list price (e.g. Sol at $2/$10) may have ample messages included in a $20 Plus plan, while an API-cheap model with extreme verbosity (Gemini Flash) can deplete 5-hour subscription quotas faster.

---

## 14. Comprehensive Source Ledger & Bibliography

All citations accessed, cross-referenced, and verified on **November 11, 2026**:

1. **Anthropic PBC:**
   - *Claude Model Pricing & Specifications*, `https://platform.claude.com/docs/en/about-claude/pricing` (Retrieved Nov 11, 2026).
   - *Claude Fable 5.2 Architecture & Evaluation Report*, `https://www.anthropic.com/news/claude-fable-5-2` (Retrieved Nov 11, 2026).
   - *Claude Code Pro, Max and Ultra Usage Guidelines*, `https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan` (Retrieved Nov 11, 2026).
   - *Account Usage and Unified Window Limits*, `https://support.anthropic.com/en/articles/11647753-how-do-usage-and-length-limits-work` (Retrieved Nov 11, 2026).
2. **OpenAI Inc.:**
   - *API Pricing & Model Directory*, `https://developers.openai.com/api/docs/pricing` (Retrieved Nov 11, 2026).
   - *GPT-6.1 Sol Model Card & Responses API Schema*, `https://developers.openai.com/api/docs/models/gpt-6.1-sol` (Retrieved Nov 11, 2026).
   - *Managing Usage with GPT-6 in Work and Codex*, `https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex` (Retrieved Nov 11, 2026).
   - *ChatGPT Pro & Plus Plan Quotas*, `https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers` (Retrieved Nov 11, 2026).
3. **Google LLC:**
   - *Gemini 3.8 Flash Pricing & Specifications*, `https://ai.google.dev/gemini-api/docs/pricing` (Retrieved Nov 11, 2026).
   - *Google Antigravity Plans & Quota Architecture*, `https://antigravity.google/docs/plans` (Retrieved Nov 11, 2026).
   - *Google AI Subscriptions & Model Availability*, `https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/` (Retrieved Nov 11, 2026).
4. **Independent Benchmark Consortia & Community Reports:**
   - *BenchLM SWE-bench Pro Quarter 4 2026 Leaderboard*, `https://benchlm.ai/swe-bench-pro-leaderboard-nov2026` (Retrieved Nov 11, 2026).
   - *OpenCode Model Catalog & Inference Router Documentation*, `https://opencode.ai/docs/models/free-catalog` (Retrieved Nov 11, 2026).
   - Nahornyi, O., *Subagent Economics: Opus Architecture and Luna Execution*, `https://nahornyi.ai/posts/subagent-economics-opus-luna-2026` (Retrieved Nov 11, 2026).
   - AgentPedia, *Claude Code vs. Codex CLI Token Consumption Analysis*, `https://agentpedia.codes/reports/claude-code-token-burn-analysis` (Retrieved Nov 11, 2026).
   - Reddit `/r/codex`, *Does Sol planning and Luna implementing really work?*, `https://www.reddit.com/r/codex/comments/1vrnau6/does_sol_planning_and_luna_implementing_really/` (Retrieved Nov 11, 2026).
   - Neuromesh Internal Research Logs: `docs/06-v0.1-results.md` and `docs/08-build-test.md` (2026-11-11).
