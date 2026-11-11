# LLM API pricing and capabilities — November 11, 2026

**Scope:** The 11 models requested, not a verified ranking by usage. Prices are **USD per 1 million tokens** at each provider's **standard/direct API rates** (not reseller pricing, subscriptions, Batch/Flex/Fast tiers, or tool fees). `Cache` means the charge for reading/reusing cached input, **not** writing new cache entries. Values were checked against official provider documentation on November 11, 2026.

## Pricing

| Model | Input / 1M | Cached input / 1M | Output / 1M | Price condition |
|---|---:|---:|---:|---|
| DeepSeek V4.1 Flash | **$0.15 / $0.30** | **$0.003 / $0.006** | **$0.60 / $1.20** | Off-peak / peak (see notes) |
| Gemini 3.8 Flash | $0.75 | $0.075 | $3.75 | Promotional until Dec 31, 2026 |
| Claude Opus 5.5 | $4.00 | $0.20 | $20.00 | Standard |
| Claude Sonnet 5.5 | $2.00 | $0.10 | $10.00 | Standard |
| Claude Haiku 5.5 | **$0.10 / $0.50** | **$0.01 / $0.05** | **$0.50 / $2.50** | Prompt length <=100K / >100K tokens |
| GPT-6 Astra | $10.00 | $1.00 | $50.00 | Short-context standard tier |
| GPT-6 Luna | $0.10 | $0.01 | $0.50 | Short-context standard tier |
| GPT-6.1 Sol | $2.00 | $0.10 | $10.00 | Short-context standard tier |
| GPT-6.1 Terra | $1.00 | $0.05 | $5.00 | Short-context standard tier |
| Claude Opus 4.6 | $5.00 | $0.50 | $25.00 | Legacy model; still active |
| Claude Sonnet 4.6 | $3.00 | $0.30 | $15.00 | Legacy model; still active |

## Capabilities

| Model | API model ID | Context window | Max output | Reasoning / thinking | Input modalities | Supported tools and typical use | Status |
|---|---|---:|---:|---|---|---|---|
| DeepSeek V4.1 Flash | `deepseek-flash` | 1M | 384K | Thinking (default) or non-thinking | Text, images | Tool calling, JSON, FIM completion (beta); low-cost coding and agent workloads | Active |
| Gemini 3.8 Flash | `gemini-3.8-flash` | 1,048,576 | 65,536 | Low / medium / high | Text, images, audio, video, PDF | Function calling, code execution, search grounding, computer use (preview); multimodal and long-running agents | Stable |
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | 128K | Adaptive, always on | Text, images | Tool use; long-horizon agentic coding, architecture, refactoring, computer use | Latest |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 1M | 128K | Adaptive | Text, images | Tool use; everyday coding, data analysis, general agents | Latest |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 1M | 128K | Adaptive | Text, images | Tool use; routing, classification, extraction, fast subagents | Latest |
| GPT-6 Astra | `gpt-6-astra` | 1,050,000 | 128K | Low / medium / high / xhigh / max | Text, images | Functions, web/file search, computer use; hardest reasoning and coding | Flagship |
| GPT-6 Luna | `gpt-6-luna` | 1,050,000 | 128K | None / low / medium / high / xhigh / max | Text, images | Functions, web/file search, computer use; focused, high-volume tasks | Current |
| GPT-6.1 Sol | `gpt-6.1-sol` | 1,050,000 | 128K | Low / medium / high / xhigh / max | Text, images | Functions, web/file search, computer use; complex coding and orchestration | Current |
| GPT-6.1 Terra | `gpt-6.1-terra` | 1,050,000 | 128K | None / low / medium / high / xhigh / max | Text, images | Functions, web/file search, computer use; UI automation, visual reasoning, scoped code fixes | Current |
| Claude Opus 4.6 | `claude-opus-4-6` | 1M | 128K | Adaptive (older extended-thinking mode deprecated) | Text, images | Tool use; older complex reasoning/coding workflows | Legacy |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 128K | Adaptive (older extended-thinking mode deprecated) | Text, images | Tool use; older general coding and agent workflows | Legacy |

## Pricing qualifications

1. **DeepSeek:** Rates above are **off-peak / peak**. Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays, excluding Chinese public holidays. All other times, weekends, and Chinese public holidays are off-peak. The provider currently resolves `deepseek-flash` to **DeepSeek-V4.1-Flash-1017**.
2. **Gemini:** Rates above expire **December 31, 2026**. From **January 1, 2027**, published standard prices rise to **$1.50 input / $0.15 cached input / $7.50 output** per 1M. Google also charges for explicit context-cache storage (currently $0.50 per 1M tokens per hour). Gemini 3.8 Flash offers a free API tier subject to limits; this does not mean unlimited free usage.
3. **Claude Haiku 5.5:** The lower price applies when the **entire request prompt** is at most **100,000 tokens**; the higher price applies to the **whole request** when its prompt exceeds 100,000 tokens, including its output. This is *not* marginal/tiered pricing for only the excess tokens. Cached and uncached prompt tokens count toward the threshold.
4. **Claude cache writes:** Anthropic bills cache creation separately. A 5-minute cache write costs 1.25× the listed input price; a 1-hour write costs 2×. The pricing table lists **cache reads**, not cache writes. Anthropic Batch API discounts input and output by 50%.
5. **GPT-6 long context:** The listed OpenAI prices are for requests with **up to 272K input tokens**. Long-context Standard prices are higher: **Astra $20/$100**, **Luna $0.20/$1.00**, **Sol $4/$20**, and **Terra $2/$10** (input/output per 1M, respectively); cached-input costs also rise. Other processing tiers have different prices.
6. **Different feature limits:** OpenAI tool access and multi-agent features depend on API endpoint and model; computer use may require Responses API. Gemini computer use is preview. Claude's 300K maximum output through Batch API is a special beta mode, **not** the ordinary max output above. Tools, search, caching storage, and hosting may add charges beyond token prices.
7. **Model strength is workload-dependent:** The 'typical use' column summarizes official positioning and features, **not a cross-provider benchmark ranking**. A cheaper per-token model can cost more per completed coding task if it requires extra reasoning, retries, or tool calls.

## Official sources

- [DeepSeek — Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Gemini — Pricing](https://ai.google.dev/gemini-api/docs/pricing) and [Gemini 3.8 Flash specifications](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Anthropic — Claude model pricing](https://platform.claude.com/docs/en/about-claude/pricing) and [model comparison](https://platform.claude.com/docs/en/models/overview)
- [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview), [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
- [Claude Opus 4.6](https://platform.claude.com/docs/en/models/opus-4-6/overview), [Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview)
- [OpenAI — API pricing](https://developers.openai.com/api/docs/pricing) and [model catalogue](https://developers.openai.com/api/docs/models)

**Note:** API token charges are not the same as usage quotas in ChatGPT, Claude, Gemini subscriptions, or coding-agent subscriptions.
