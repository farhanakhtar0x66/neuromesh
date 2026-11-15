# Routing benchmark: rb-cascade-5 against rb-frontier-2

15 prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.

## Metrics

| Metric | Value | Target | Result |
| --- | --- | --- | --- |
| CostSave, unweighted | 80.8% ($0.7432 against $3.8746) | >= 65% | PASS |
| CostSave, weighted 50/30/16/4 | 85.4% | >= 80% | PASS |
| Gap@Oracle | 3.1% over 15 prompts | <= 3.0% | FAIL |
| WCTR | 0.7% (11,421 of 1,593,031 tokens) | <= 8.0% | PASS |
| Trap 5.1 regex bomb | hidden 13/13, path worker | survive | PASS |
| Trap 5.2 jargon wall | path grunt, Tier 3/4 spend $0.0000 | survive | PASS |
| Trap 5.3 impossible sort | Tier 2 stopped by the gate (about 670 output tokens, estimated), hidden 5/5 | survive | PASS |
| Tier 0 routed to the expected starting tier | 11/15 | | |

## Claude subscription quota

Sum over prompts of (after - before) for each window; a window that reset mid-prompt makes the sum unknown. Each prompt's reading costs one one-word Haiku call.

| Window | Cascade | Frontier |
| --- | --- | --- |
| five_hour | 6.0% | 21.0% |
| seven_day | 1.0% | 2.0% |

## Per prompt

| ID | Expected | Routed | Path (cascade) | Q cascade | Q frontier | Cost cascade | Cost frontier | Discarded tokens | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0039 | $0.0985 | 0 | applied/applied |
| 1.2 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0013 | $0.0582 | 0 | applied/applied |
| 1.3 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0015 | $0.0661 | 0 | applied/applied |
| 2.1 | worker | worker | worker | 10.0 | 10.0 | $0.0117 | $0.1314 | 0 | applied/applied |
| 2.2 | worker | worker | worker | 10.0 | 10.0 | $0.0165 | $0.0704 | 0 | applied/applied |
| 2.3 | worker | worker | worker | 10.0 | 10.0 | $0.0152 | $0.2275 | 0 | applied/applied |
| 3.1 | senior | worker | worker | 6.4 | 10.0 | $0.0202 | $0.3117 | 0 | applied/applied |
| 3.2 | senior | senior | senior | 10.0 | 10.0 | $0.0980 | $0.2538 | 0 | applied/applied |
| 3.3 | senior | senior | senior | 10.0 | 10.0 | $0.1219 | $0.4855 | 0 | applied/applied |
| 4.1 | expert | expert | senior | 9.0 | 9.0 | $0.1770 | $0.6079 | 0 | applied/applied |
| 4.2 | expert | senior | senior | 8.9 | 8.9 | $0.1715 | $0.4852 | 0 | applied/applied |
| 4.3 | expert | worker | worker | 8.9 | 10.0 | $0.0309 | $0.6917 | 0 | applied/applied |
| 5.1 | cascade 1>2>3 | worker | worker | 10.0 | 10.0 | $0.0123 | $0.0837 | 0 | applied/applied |
| 5.2 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0017 | $0.0672 | 0 | applied/applied |
| 5.3 | cascade 2>3 | worker | worker > senior | 10.0 | 10.0 | $0.0595 | $0.2357 | 11,421 | applied/applied |
