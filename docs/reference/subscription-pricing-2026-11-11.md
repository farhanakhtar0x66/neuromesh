# LLM subscription pricing and usage — 11-model comparison

**Verified:** 11 November 2026  
**Scope:** consumer subscriptions and included usage in official chat/coding products — **not API token pricing**.  
**Currency:** USD/month, US web-list prices before tax, unless indicated. Local billing (including India) can differ.  
**Important:** A subscription is **not** a general-purpose API key. Included coding usage applies within the provider's authorized product (Codex, Claude Code, Google Antigravity, etc.), not automatically to arbitrary external orchestration software.

## Model-by-model comparison

| Model | Lowest verified subscription route | Higher-usage subscriptions | Included usage / reset (published) | Where you can actually use it | Important limitations |
|---|---|---|---|---|---|
| **DeepSeek V4.1 Flash** (current `V4.1-Flash-1017`) | **$0** DeepSeek web/app | **No verified fixed-price consumer subscription for developer access** | Free web/app access; model-specific message caps **not publicly fixed** | DeepSeek website and app | DeepSeek API / third-party coding harness access is **separately billed**; free website use does not create a subscription API allowance. [D1–D2] |
| **Gemini 3.8 Flash** | **$0** Google Antigravity Individual | **Google AI Pro $19.99**; **AI Ultra $100 / $200** | Individual: **weekly** baseline; Pro: **5-hour refresh + weekly cap**; Ultra: higher quotas with 5-hour refresh and weekly cap. **No fixed prompt counts published.** | Google Antigravity app/CLI/IDE; Gemini app access on AI Pro/Ultra | Google AI Pro/Ultra no longer grants Google-account login to the old **Gemini CLI** (retired for consumer accounts June 18, 2026). Use **Antigravity CLI** for subscription-based coding. [G1–G5] |
| **Claude Opus 5.5** | **Claude Pro $20**; also **paid Google AI Pro $19.99** in Antigravity | Claude **Max $100**, **Ultra $200**; Google AI Ultra $100/$200 in Antigravity | Claude Pro: **5-hour + weekly limits**; Max: **5× Pro every 5 hours and week**; Ultra: **10× Pro weekly**, with **no 5-hour cap on verified accounts**. Antigravity has its **own** limits. | Claude chat / Claude Code; Google Antigravity on eligible paid plans | Opus often consumes included Claude usage faster than Sonnet; **no guaranteed model-specific prompt count**. Paid Google AI Pro (not trial) is required for Opus 5.5 in Antigravity. [C1–C5, G3] |
| **Claude Sonnet 5.5** | **$0** Claude Free (limited chat); **Claude Pro $20** for Code | Claude Max $100, Ultra $200; also **paid Google AI Pro $19.99** in Antigravity | Claude paid limits shared across Claude/Claude Code: **5-hour + weekly** (Ultra exception above); Antigravity: plan-based 5-hour/weekly | Claude chat; Claude Code on paid Claude plans; Google Antigravity on paid Pro/Ultra | Claude Free chat does **not** imply unlimited/free Claude Code. [C1–C5, G3] |
| **Claude Haiku 5.5** | **$0** Claude Free (limited chat) | Claude Pro $20, Max $100, Ultra $200 | Shared Claude account usage, **not an independent Haiku bucket**; provider does **not** publish a fixed messages-per-hour guarantee | Claude chat; Claude Code | Usually suitable for focused worker tasks, but subscription access is **not** transferable to another orchestrator via generic API. [C3–C5] |
| **GPT-6 Astra** | **ChatGPT Plus $20** (limited Astra in **Work/Codex**) | **Pro $100 / $200 / $500**; $100+ unlocks GPT-6 Pro in regular Chat | **Plus: ~5–45 local Codex/Work messages per 5 hours** (estimate, **not guaranteed**), plus applicable weekly cap. **Pro tiers currently have no 5-hour Work/Codex cap**, but retain usage allowance. | Codex and ChatGPT Work on Plus/Pro; GPT-6 Pro in Chat on Pro | Astra is quota-heavy. Plus **does not** include GPT-6 Pro in regular Chat. $500 Pro has optional Ultrafast; this consumes **8×** included allowance at standard-equivalent rates. [O1–O4] |
| **GPT-6 Luna** | **$0** regular ChatGPT Free; limited Codex access varies by plan | ChatGPT Plus $20, Pro $100/$200/$500 | **Plus: ~350–3,000 local Codex/Work messages per 5 hours** (estimate), with weekly limits. Regular Chat is a **separate experience** with different limits. | ChatGPT; Work/Codex on eligible accounts | No single guaranteed daily message count. Very efficient for bounded tasks, but less suited to highest-difficulty planning. [O1–O3] |
| **GPT-6.1 Sol** | **ChatGPT Plus $20** (eligible rollout) | Pro $100/$200/$500 | **Plus: ~15–160 local Codex/Work messages per 5 hours** (estimate), plus weekly cap; Pro Work/Codex has no five-hour cap currently | **Work and Codex**, **not ordinary Chat** | Usage depends heavily on reasoning effort, context, tools, and task complexity; $500 Pro includes optional Ultrafast at higher allowance burn. [O1–O4] |
| **GPT-6.1 Terra** | **ChatGPT Plus $20** (eligible Work/Codex access) | Pro $100/$200/$500 | **Shared Work/Codex allowance**, with 5-hour and/or weekly limits depending on plan; **no official Terra-specific message range published** | **Work and Codex**, **not ordinary Chat** | Cannot safely infer a Terra message cap by scaling Sol's estimate. [O1–O3] |
| **Claude Opus 4.6** | **$0** in **Google Antigravity** (Individual); legacy Anthropic model access depends on picker/product | Google AI Pro $19.99 (Antigravity); Claude paid plans **only if model is still selectable** | Antigravity Individual: **weekly** quota; Pro: **5-hour + weekly**. **No model-specific quota published.** | Google Antigravity; legacy Claude selections where still offered | **Antigravity access is scheduled for removal Nov 18, 2026**; not a safe long-term subscription choice. [G3, C6] |
| **Claude Sonnet 4.6** | **$0** in **Google Antigravity** (Individual); legacy Anthropic model access depends on picker/product | Google AI Pro $19.99 (Antigravity); Claude paid plans **only if model is still selectable** | Antigravity Individual: **weekly** quota; Pro: **5-hour + weekly**. **No model-specific quota published.** | Google Antigravity; legacy Claude selections where still offered | **Antigravity access is scheduled for removal Nov 18, 2026**; not a safe long-term subscription choice. [G3, C6] |

**Reading the table:** A “lowest route” may be chat-only or vendor-specific. It does **not** mean all the listed models can be run under a single subscription from an arbitrary CLI. Model availability and actual remaining quota must be checked in the signed-in product.

## Subscription tier comparison

| Provider / plan | Monthly price | Included access particularly relevant to these models | Published usage rule | Coding-agent route |
|---|---:|---|---|---|
| **DeepSeek Web/App** | **$0** | DeepSeek V4.1 Flash | Dynamic; no public fixed message allotment | No subscription-funded generic API entitlement |
| **Google Antigravity Individual** | **$0** | Gemini 3.8 Flash; temporary Opus/Sonnet 4.6 | Weekly cap; dynamic compute-based use | Antigravity CLI/app/IDE |
| **Google AI Pro** | **$19.99** | Gemini 3.8 Flash; **Claude Opus/Sonnet 5.5 in Antigravity (paid, non-trial)** | Higher 5-hour/weekly Antigravity allowances; specific prompt totals unpublished | Antigravity CLI/app/IDE |
| **Google AI Ultra (developer tier)** | **$100** | Same family with more quota | **5× Pro** usage limits in Google Gemini/Antigravity, subject to product rules | Antigravity |
| **Google AI Ultra (top tier)** | **$200** | Same family, highest Google subscription quota | **20× Pro** usage limits in Google Gemini/Antigravity, subject to product rules | Antigravity |
| **Claude Free** | **$0** | Sonnet 5.5 and Haiku 5.5 chat | Limited; dynamic | Paid Claude plan required for subscription-based Claude Code |
| **Claude Pro** | **$20** | Opus/Sonnet/Haiku 5.5; available older models vary | Standard account-level 5-hour + weekly allowance | Claude Code |
| **Claude Max** | **$100** | Claude 5.5 family | **5× Pro** allowance per 5-hour window and week | Claude Code |
| **Claude Ultra** | **$200** | Claude 5.5 family | **10× Pro weekly**; no 5-hour cap for verified accounts | Claude Code |
| **ChatGPT Plus** | **$20** | Astra (limited Work/Codex); GPT-6 Luna; GPT-6.1 Sol/Terra (Work/Codex, eligible rollout) | 5-hour and weekly usage; published **model-dependent ranges** below | Codex CLI / Codex app / Work |
| **ChatGPT Pro 100** | **$100** | Plus models + GPT-6 Pro (Astra) in Chat | More included Work/Codex use; currently no 5-hour limit, but usage allowance applies | Codex / Work |
| **ChatGPT Pro 200** | **$200** | Same, higher quota | Higher included allowance; currently no 5-hour Work/Codex cap | Codex / Work |
| **ChatGPT Pro 500** | **$500** | Same, highest included quota + Astra/Sol Ultrafast | No 5-hour Work/Codex cap currently; Ultrafast burns included usage **8×** faster than Standard | Codex / Work |

### OpenAI’s published **Plus** local-message estimates (per five-hour window)

| Model | Estimated local messages / 5 hours | Confidence / qualification |
|---|---:|---|
| GPT-6 Astra | **5–45** | Official *range*, not guarantee |
| GPT-6.1 Sol | **15–160** | Official *range*, not guarantee |
| GPT-6.1 Terra | **Not published** | Uses shared allowance; cannot extrapolate |
| GPT-6 Luna | **350–3,000** | Official *range*, not guarantee |

Cloud tasks, long contexts, high reasoning effort, repeated tools, and multi-agent workflows can exhaust the allowance sooner; an account can hit its **weekly** cap even after a five-hour window resets. Pro plan tiers have no five-hour limit *currently* but are **not unlimited Work/Codex**. Check **Settings → Usage** for account-specific remaining balances and reset times. [O1–O3]

### What subscription quotas mean for agent orchestration

- **Five-hour cap:** Some plans replenish session capacity five hours after the relevant window begins. Reaching it blocks further included use in that window.
- **Weekly cap:** Another limit that can be hit even if a five-hour window has refreshed. Max/Ultra products differ in how they apply five-hour restrictions.
- **Shared allowance:** Using multiple models under one provider often spends the *same* plan balance. Switching from Astra to Luna or Opus to Haiku is not a fresh independent subscription.
- **Dynamic task cost:** A short, low-effort text edit and a 20-minute tool-heavy code agent run do not consume equivalent quota. Most providers do **not** publish stable messages/day per model.
- **Provider interoperability:** Google Antigravity includes some Claude models **inside Antigravity**, but that does not give you a Claude API key or Claude Code Max plan. Likewise, ChatGPT Plus can fund Codex only via supported ChatGPT sign-in, not by exporting credentials or treating a plan as unlimited API usage.
- **Extra charges:** Google AI/Claude/OpenAI can offer optional credits or overages, but those are **not included unlimited subscription use**. Disable auto-overages if strictly avoiding API/usage-based costs.

## Quick take for a subscription-only coding setup

1. **$0:** Antigravity Individual offers Gemini 3.8 Flash with weekly quota. DeepSeek Web/App offers V4.1 Flash but not a generic subscription-funded API. Older Claude 4.6 models in Antigravity have a Nov 18 end date.
2. **~$20/month:** ChatGPT Plus is the most directly documented route to **Astra/Sol/Terra/Luna within Codex**. Google AI Pro additionally unlocks **Opus/Sonnet 5.5** in Antigravity on paid non-trial accounts. Claude Pro supports its own **Claude Code** workflow.
3. **$100–$200/month:** If usage is the constraint, assess **real completed tasks per weekly allowance**, not the largest model name. Claude Max/Ultra, Google Ultra, and ChatGPT Pro measure and reset consumption differently.
4. **For NeuroMesh-like orchestration:** Verify that your chosen vendor's subscription authentication is **supported for the precise CLI/harness**. A model listed in a chat product or another provider's app is *not* proof that an external agent manager can legally or technically call it under that subscription.

## Primary sources (official)

**DeepSeek**
- [D1] [DeepSeek V4.1 Flash 1017: website, app and API](https://api-docs.deepseek.com/news/news261017/)
- [D2] [DeepSeek API quickstart — API key and model identifier](https://api-docs.deepseek.com/quick_start/faq)

**Google**
- [G1] [Google AI subscription tiers, May 2026 — Pro, Ultra $100/$200, 5×/20×](https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/)
- [G2] [Google Antigravity plans and quota rules](https://antigravity.google/docs/plans)
- [G3] [Antigravity model availability (including Claude 5.5; Claude 4.6 retirement date)](https://antigravity.google/docs/models)
- [G4] [Google Gemini 3.8 Flash availability announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/)
- [G5] [Gemini CLI consumer sign-in retirement](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)

**Anthropic**
- [C1] [Claude Pro, Max and Claude Code usage](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- [C2] [Claude Max $100 and 5× usage](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)
- [C3] [Claude Ultra $200, 10× weekly and verified-account exception](https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan)
- [C4] [Claude Opus 5.5 availability](https://www.anthropic.com/claude/opus)
- [C5] [Claude Sonnet 5.5 / Haiku 5.5 availability](https://www.anthropic.com/claude/sonnet) · [Haiku](https://www.anthropic.com/claude/haiku) · [Shared usage limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)
- [C6] [Anthropic model lifecycle, including Opus/Sonnet 4.6](https://docs.anthropic.com/en/docs/about-claude/model-deprecations)

**OpenAI**
- [O1] [Work/Codex usage ranges for Astra, Sol and Luna](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex)
- [O2] [Work/Codex model availability, sharing and Ultrafast rules](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)
- [O3] [Pro $100 / $200 / $500](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)
- [O4] [ChatGPT Plus $20 and subscription/API separation](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)

*Figures are a dated snapshot. Vendor limits, tiers, model selections and rollout access can change without guaranteed per-user allotments.*
