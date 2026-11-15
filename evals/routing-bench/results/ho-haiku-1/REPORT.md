# Routing benchmark: ho-haiku-1 against ho-frontier-1

15 prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.

## Metrics

| Metric | Value | Target | Result |
| --- | --- | --- | --- |
| CostSave, unweighted | 89.0% ($0.7591 against $6.8997) | >= 65% | PASS |
| CostSave, weighted 50/30/16/4 | 91.2% | >= 80% | PASS |
| Gap@Oracle | 6.7% over 15 prompts | <= 3.0% | FAIL |
| WCTR | 0.0% (0 of 5,588,006 tokens) | <= 8.0% | PASS |
| Trap H5.1 prose-wrapped numeric spec | hidden 7/7, path haiku | survive | PASS |
| Trap H5.2 multi-buzzword decoy | path haiku, Tier 3/4 turns 0, spend $0.0000, hidden 7/7 | survive | PASS |
| Trap H5.3 impossible lock upgrade | Tier 2 not stopped, hidden 6/6 | survive | PASS |
| Tier 0 routed to the expected starting tier | 0/15 | | |

## Claude subscription quota

Sum over prompts of (after - before) for each window; a window that reset mid-prompt makes the sum unknown. Each prompt's reading costs one one-word Haiku call.

| Window | Cascade | Frontier |
| --- | --- | --- |
| five_hour | 5.0% | 38.0% |
| seven_day | 0.0% | 3.0% |

## Per prompt

| ID | Expected | Routed | Path (cascade) | Q cascade | Q frontier | Cost cascade | Cost frontier | Discarded tokens | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1.1 | grunt | haiku | haiku | 10.0 | 10.0 | $0.0021 | $0.1044 | 0 | applied/applied |
| H1.2 | grunt | haiku | haiku | 10.0 | 10.0 | $0.0048 | $0.0647 | 0 | applied/applied |
| H1.3 | grunt or worker | haiku | haiku | 10.0 | 10.0 | $0.0072 | $0.1040 | 0 | applied/applied |
| H2.1 | worker | haiku | haiku | 10.0 | 10.0 | $0.0370 | $0.3441 | 0 | applied/applied |
| H2.2 | worker | haiku | haiku | 10.0 | 10.0 | $0.0391 | $0.4103 | 0 | applied/applied |
| H2.3 | worker or senior | haiku | haiku | 0.0 | 10.0 | $0.0146 | $0.1542 | 0 | failed/applied |
| H3.1 | senior | haiku | haiku | 10.0 | 10.0 | $0.0305 | $0.5664 | 0 | applied/applied |
| H3.2 | senior | haiku | haiku | 10.0 | 10.0 | $0.0402 | $0.5350 | 0 | applied/applied |
| H3.3 | senior | haiku | haiku | 10.0 | 10.0 | $0.0415 | $0.6120 | 0 | applied/applied |
| H4.1 | expert | haiku | haiku | 10.0 | 10.0 | $0.0979 | $1.2978 | 0 | applied/applied |
| H4.2 | senior | haiku | haiku | 10.0 | 10.0 | $0.0555 | $0.4832 | 0 | applied/applied |
| H4.3 | expert | haiku | haiku | 10.0 | 10.0 | $0.3318 | $1.5498 | 0 | applied/applied |
| H5.1 | worker or senior | haiku | haiku | 10.0 | 10.0 | $0.0080 | $0.1443 | 0 | applied/applied |
| H5.2 | grunt or worker | haiku | haiku | 10.0 | 10.0 | $0.0020 | $0.0559 | 0 | applied/applied |
| H5.3 | cascade 2>3 | haiku | haiku | 10.0 | 10.0 | $0.0469 | $0.4737 | 0 | applied/applied |
