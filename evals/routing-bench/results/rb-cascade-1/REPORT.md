# Routing benchmark: rb-cascade-1 against rb-frontier-1

15 prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.

## Metrics

| Metric | Value | Target | Result |
| --- | --- | --- | --- |
| CostSave, unweighted | 64.9% ($1.1643 against $3.3187) | >= 65% | FAIL |
| CostSave, weighted 50/30/16/4 | 77.8% | >= 80% | FAIL |
| Gap@Oracle | 0.8% over 15 prompts | <= 3.0% | PASS |
| WCTR | 1.4% (22,130 of 1,561,327 tokens) | <= 8.0% | PASS |
| Trap 5.1 regex bomb | hidden 13/13, path worker | survive | PASS |
| Trap 5.2 jargon wall | path senior, Tier 3/4 spend $0.0581 | survive | FAIL |
| Trap 5.3 impossible sort | Tier 2 stopped by the gate (about 840 output tokens, estimated), hidden 5/5 | survive | PASS |
| Tier 0 routed to the expected starting tier | 6/15 | | |

## Claude subscription quota

Sum over prompts of (after - before) for each window; a window that reset mid-prompt makes the sum unknown. Each prompt's reading costs one one-word Haiku call.

| Window | Cascade | Frontier |
| --- | --- | --- |
| five_hour | 10.0% | 13.0% |
| seven_day | 1.0% | 2.0% |

## Per prompt

| ID | Expected | Routed | Path (cascade) | Q cascade | Q frontier | Cost cascade | Cost frontier | Discarded tokens | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | grunt | worker | worker | 10.0 | 10.0 | $0.0071 | $0.0980 | 0 | applied/applied |
| 1.2 | grunt | worker | worker | 10.0 | 10.0 | $0.0073 | $0.0603 | 0 | applied/applied |
| 1.3 | grunt | worker | worker | 10.0 | 10.0 | $0.0025 | $0.0638 | 0 | applied/applied |
| 2.1 | worker | worker | worker | 10.0 | 10.0 | $0.0085 | $0.1141 | 0 | applied/applied |
| 2.2 | worker | senior | senior | 10.0 | 10.0 | $0.0911 | $0.0672 | 0 | applied/applied |
| 2.3 | worker | worker | worker | 8.8 | 10.0 | $0.0084 | $0.2426 | 0 | applied/applied |
| 3.1 | senior | worker | worker | 10.0 | 10.0 | $0.0150 | $0.1136 | 0 | applied/applied |
| 3.2 | senior | senior | senior | 10.0 | 10.0 | $0.0660 | $0.2013 | 0 | applied/applied |
| 3.3 | senior | senior | senior | 10.0 | 10.0 | $0.0890 | $0.5965 | 0 | applied/applied |
| 4.1 | expert | expert | expert-plan > senior > worker | 10.0 | 10.0 | $0.3304 | $0.3378 | 0 | applied/applied |
| 4.2 | expert | senior | senior | 10.0 | 10.0 | $0.4017 | $0.6344 | 10,327 | applied/applied |
| 4.3 | expert | worker | worker | 10.0 | 10.0 | $0.0174 | $0.4641 | 0 | applied/applied |
| 5.1 | cascade 1>2>3 | worker | worker | 10.0 | 10.0 | $0.0037 | $0.0967 | 0 | applied/applied |
| 5.2 | grunt | senior | senior | 10.0 | 10.0 | $0.0581 | $0.0644 | 0 | applied/applied |
| 5.3 | cascade 2>3 | worker | worker > senior | 10.0 | 10.0 | $0.0580 | $0.1639 | 11,803 | applied/applied |
