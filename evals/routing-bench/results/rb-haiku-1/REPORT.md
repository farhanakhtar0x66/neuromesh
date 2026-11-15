# Routing benchmark: rb-haiku-1 against rb-frontier-2

15 prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.

## Metrics

| Metric | Value | Target | Result |
| --- | --- | --- | --- |
| CostSave, unweighted | 94.6% ($0.2088 against $3.8746) | >= 65% | PASS |
| CostSave, weighted 50/30/16/4 | 94.8% | >= 80% | PASS |
| Gap@Oracle | 3.9% over 15 prompts | <= 3.0% | FAIL |
| WCTR | 0.0% (0 of 2,073,820 tokens) | <= 8.0% | PASS |
| Trap 5.1 regex bomb | hidden 13/13, path haiku | survive | PASS |
| Trap 5.2 jargon wall | path haiku, Tier 3/4 spend $0.0000 | survive | FAIL |
| Trap 5.3 impossible sort | Tier 2 not stopped, hidden 5/5 | survive | FAIL |
| Tier 0 routed to the expected starting tier | 0/15 | | |

## Claude subscription quota

Sum over prompts of (after - before) for each window; a window that reset mid-prompt makes the sum unknown. Each prompt's reading costs one one-word Haiku call.

| Window | Cascade | Frontier |
| --- | --- | --- |
| five_hour | 2.0% | 21.0% |
| seven_day | 0.0% | 2.0% |

## Per prompt

| ID | Expected | Routed | Path (cascade) | Q cascade | Q frontier | Cost cascade | Cost frontier | Discarded tokens | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | grunt | haiku | haiku | 10.0 | 10.0 | $0.0020 | $0.0985 | 0 | applied/applied |
| 1.2 | grunt | haiku | haiku | 10.0 | 10.0 | $0.0023 | $0.0582 | 0 | applied/applied |
| 1.3 | grunt | haiku | haiku | 10.0 | 10.0 | $0.0022 | $0.0661 | 0 | applied/applied |
| 2.1 | worker | haiku | haiku | 9.1 | 10.0 | $0.0067 | $0.1314 | 0 | applied/applied |
| 2.2 | worker | haiku | haiku | 10.0 | 10.0 | $0.0022 | $0.0704 | 0 | applied/applied |
| 2.3 | worker | haiku | haiku | 10.0 | 10.0 | $0.0195 | $0.2275 | 0 | applied/applied |
| 3.1 | senior | haiku | haiku | 10.0 | 10.0 | $0.0163 | $0.3117 | 0 | applied/applied |
| 3.2 | senior | haiku | haiku | 10.0 | 10.0 | $0.0111 | $0.2538 | 0 | applied/applied |
| 3.3 | senior | haiku | haiku | 10.0 | 10.0 | $0.0300 | $0.4855 | 0 | applied/applied |
| 4.1 | expert | haiku | haiku | 10.0 | 9.0 | $0.0366 | $0.6079 | 0 | applied/applied |
| 4.2 | expert | haiku | haiku | 8.9 | 8.9 | $0.0215 | $0.4852 | 0 | applied/applied |
| 4.3 | expert | haiku | haiku | 10.0 | 10.0 | $0.0393 | $0.6917 | 0 | applied/applied |
| 5.1 | cascade 1>2>3 | haiku | haiku | 10.0 | 10.0 | $0.0046 | $0.0837 | 0 | applied/applied |
| 5.2 | grunt | haiku | haiku | 4.0 | 10.0 | $0.0026 | $0.0672 | 0 | applied/applied |
| 5.3 | cascade 2>3 | haiku | haiku | 10.0 | 10.0 | $0.0121 | $0.2357 | 0 | applied/applied |
