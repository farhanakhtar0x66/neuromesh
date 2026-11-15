# Routing benchmark: ho-cascade-1 against ho-frontier-1

15 prompts scored. Dollar figures are estimates at API list prices (src/usage/prices.ts), not money spent. Quality is the hidden check's share of passed items, 0 to 10.

## Metrics

| Metric | Value | Target | Result |
| --- | --- | --- | --- |
| CostSave, unweighted | 82.3% ($1.2233 against $6.8997) | >= 65% | PASS |
| CostSave, weighted 50/30/16/4 | 85.8% | >= 80% | PASS |
| Gap@Oracle | 0.0% over 15 prompts | <= 3.0% | PASS |
| WCTR | 0.0% (0 of 2,741,562 tokens) | <= 8.0% | PASS |
| Trap H5.1 prose-wrapped numeric spec | hidden 7/7, path worker | survive | PASS |
| Trap H5.2 multi-buzzword decoy | path senior, Tier 3/4 turns 1, spend $0.0325, hidden 7/7 | survive | FAIL |
| Trap H5.3 impossible lock upgrade | Tier 2 not stopped, hidden 6/6 | survive | PASS |
| Tier 0 routed to the expected starting tier | 8/15 | | |

## Claude subscription quota

Sum over prompts of (after - before) for each window; a window that reset mid-prompt makes the sum unknown. Each prompt's reading costs one one-word Haiku call.

| Window | Cascade | Frontier |
| --- | --- | --- |
| five_hour | 9.0% | 38.0% |
| seven_day | 1.0% | 3.0% |

## Per prompt

| ID | Expected | Routed | Path (cascade) | Q cascade | Q frontier | Cost cascade | Cost frontier | Discarded tokens | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H1.1 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0058 | $0.1044 | 0 | applied/applied |
| H1.2 | grunt | grunt | grunt | 10.0 | 10.0 | $0.0061 | $0.0647 | 0 | applied/applied |
| H1.3 | grunt or worker | worker | worker | 10.0 | 10.0 | $0.0085 | $0.1040 | 0 | applied/applied |
| H2.1 | worker | worker | worker | 10.0 | 10.0 | $0.0276 | $0.3441 | 0 | applied/applied |
| H2.2 | worker | senior | senior | 10.0 | 10.0 | $0.0970 | $0.4103 | 0 | applied/applied |
| H2.3 | worker or senior | worker | worker | 10.0 | 10.0 | $0.0118 | $0.1542 | 0 | applied/applied |
| H3.1 | senior | worker | worker | 10.0 | 10.0 | $0.0218 | $0.5664 | 0 | applied/applied |
| H3.2 | senior | worker | worker | 10.0 | 10.0 | $0.0396 | $0.5350 | 0 | applied/applied |
| H3.3 | senior | expert | senior | 10.0 | 10.0 | $0.1457 | $0.6120 | 0 | applied/applied |
| H4.1 | expert | worker | worker | 10.0 | 10.0 | $0.0517 | $1.2978 | 0 | applied/applied |
| H4.2 | senior | expert | senior | 10.0 | 10.0 | $0.1304 | $0.4832 | 0 | applied/applied |
| H4.3 | expert | expert | senior | 10.0 | 10.0 | $0.6063 | $1.5498 | 0 | applied/applied |
| H5.1 | worker or senior | worker | worker | 10.0 | 10.0 | $0.0089 | $0.1443 | 0 | applied/applied |
| H5.2 | grunt or worker | senior | senior | 10.0 | 10.0 | $0.0325 | $0.0559 | 0 | applied/applied |
| H5.3 | cascade 2>3 | worker | worker | 10.0 | 10.0 | $0.0297 | $0.4737 | 0 | applied/applied |
