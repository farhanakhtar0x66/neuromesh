# Routing benchmark: rb-cascade-3 against rb-frontier-2

15 prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.

## Metrics

| Metric | Value | Target | Result |
| --- | --- | --- | --- |
| CostSave, unweighted | 78.9% ($0.8193 against $3.8746) | >= 65% | PASS |
| CostSave, weighted 50/30/16/4 | 83.6% | >= 80% | PASS |
| Gap@Oracle | 0.0% over 15 prompts | <= 3.0% | PASS |
| WCTR | 0.4% (11,742 of 2,679,521 tokens) | <= 8.0% | PASS |
| Trap 5.1 regex bomb | hidden 13/13, path worker | survive | PASS |
| Trap 5.2 jargon wall | path grunt, Tier 3/4 spend $0.0000 | survive | PASS |
| Trap 5.3 impossible sort | Tier 2 stopped by the gate (about 996 output tokens, estimated), hidden 5/5 | survive | PASS |
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
| 1.1 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0017 | $0.0985 | 0 | applied/applied |
| 1.2 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0012 | $0.0582 | 0 | applied/applied |
| 1.3 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0013 | $0.0661 | 0 | applied/applied |
| 2.1 | worker | worker | worker | 10.0 | 10.0 | $0.0123 | $0.1314 | 0 | applied/applied |
| 2.2 | worker | worker | worker | 10.0 | 10.0 | $0.0154 | $0.0704 | 0 | applied/applied |
| 2.3 | worker | worker | worker | 10.0 | 10.0 | $0.0190 | $0.2275 | 0 | applied/applied |
| 3.1 | senior | worker | worker | 10.0 | 10.0 | $0.0311 | $0.3117 | 0 | applied/applied |
| 3.2 | senior | senior | senior | 10.0 | 10.0 | $0.0917 | $0.2538 | 0 | applied/applied |
| 3.3 | senior | senior | senior | 10.0 | 10.0 | $0.1669 | $0.4855 | 0 | applied/applied |
| 4.1 | expert | expert | senior | 9.0 | 9.0 | $0.1541 | $0.6079 | 0 | applied/applied |
| 4.2 | expert | senior | senior | 8.9 | 8.9 | $0.1910 | $0.4852 | 0 | applied/applied |
| 4.3 | expert | worker | worker | 10.0 | 10.0 | $0.0566 | $0.6917 | 0 | applied/applied |
| 5.1 | cascade 1>2>3 | worker | worker | 10.0 | 10.0 | $0.0117 | $0.0837 | 0 | applied/applied |
| 5.2 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0016 | $0.0672 | 0 | applied/applied |
| 5.3 | cascade 2>3 | worker | worker > senior | 10.0 | 10.0 | $0.0637 | $0.2357 | 11,742 | applied/applied |
