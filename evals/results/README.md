# Raw eval results

Copied 2026-11-19 from `~/.neuromesh/evals/<run>/results.json` (and `<run>.out` logs into `logs/`), for the research paper.
One file per run, keyed by task id. Costs are API-equivalent estimates summed from each turn; "passed" counts hidden verdicts of `pass` as recorded at run time (later solo re-grades, such as intelmq-2632 and electrum-10172 in swl-opus-1/2, are in `evals/swe-live/RESULTS.md`, not here).

| Run | Preset | Started | Tasks | Passed | Est. cost |
| --- | --- | --- | --- | --- | --- |
| base-solo-flash | solo-flash | 2026-11-10 | 20 | 20 | unknown |
| base-solo-luna | solo-luna | 2026-11-11 | 25 | 25 | unknown |
| base-solo-opus46 | solo-opus46 | 2026-11-10 | 6 | 5 | unknown |
| bench-opus-haiku-1 | factory-opus-haiku | 2026-11-13 | 8 | 8 | $1.82 |
| bench-solo-haiku-1 | solo-haiku | 2026-11-13 | 8 | 8 | $0.15 |
| bench-solo-opus-1 | solo-opus | 2026-11-12 | 28 | 28 | $4.59 |
| build-factory-luna-2 | factory-luna | 2026-11-11 | 3 | 3 | unknown |
| build-factory-luna-3 | factory-luna | 2026-11-11 | 3 | 3 | unknown |
| build-factory-luna | factory-luna | 2026-11-11 | 2 | 1 | unknown |
| build-opus-luna | factory-opus-luna | 2026-11-11 | 3 | 3 | $4.43 (some turns unknown) |
| build-solo-luna | solo-luna | 2026-11-11 | 3 | 3 | unknown |
| build-solo-opus | solo-opus | 2026-11-11 | 3 | 3 | $5.46 |
| e1-factory-wf-1 | factory-wf | 2026-11-11 | 5 | 4 | unknown |
| e1-factory-wf-2 | factory-wf | 2026-11-11 | 4 | 3 | unknown |
| e1-factory-wf-3 | factory-wf | 2026-11-11 | 5 | 4 | unknown |
| e1-final-1 | factory-wf | 2026-11-11 | 9 | 8 | unknown |
| e1-final-2 | factory-wf | 2026-11-11 | 2 | 1 | unknown |
| e1-final-3 | factory-wf | 2026-11-11 | 6 | 5 | unknown |
| e1-luna-1 | factory-luna | 2026-11-11 | 25 | 25 | unknown |
| e1-luna-2 | factory-luna | 2026-11-11 | 25 | 25 | unknown |
| e1-luna-3 | factory-luna | 2026-11-11 | 25 | 25 | unknown |
| esc-check-flash-low-tester | factory-wf | 2026-11-11 | 4 | 4 | unknown |
| esc-check-flash-low | factory-wf | 2026-11-11 | 4 | 3 | unknown |
| hard-factory-wf | factory-wf | 2026-11-11 | 4 | 4 | unknown |
| hard-opus-haiku-1 | factory-opus-haiku | 2026-11-13 | 1 | 0 | $0.49 |
| hard-solo-fable-1 | solo-fable | 2026-11-13 | 0 | 0 | unknown |
| hard-solo-fable-2 | solo-fable | 2026-11-13 | 1 | 0 | $12.24 |
| hard-solo-flash | solo-flash | 2026-11-10 | 4 | 4 | unknown |
| hard-solo-luna | solo-luna | 2026-11-11 | 4 | 4 | unknown |
| hard-solo-sol | solo-sol | 2026-11-11 | 4 | 4 | unknown |
| hard-tiers-1 | factory-opus-sonnet-haiku | 2026-11-13 | 1 | 1 | $3.90 |
| hd-cascade-1 | cascade-claude | 2026-11-17 | 12 | 11 | $3.35 |
| hd-haiku-1 | solo-haiku | 2026-11-17 | 12 | 9 | $0.98 |
| hl-factory-luna | factory-luna | 2026-11-11 | 5 | 5 | unknown |
| ladder-hard | factory-wf | 2026-11-11 | 5 | 5 | unknown |
| large-factory-wf-split | factory-wf | 2026-11-11 | 1 | 1 | unknown |
| large-factory-wf | factory-wf | 2026-11-11 | 1 | 1 | unknown |
| large-solo-flash | solo-flash | 2026-11-11 | 1 | 1 | unknown |
| large-solo-sol | solo-sol | 2026-11-11 | 1 | 1 | unknown |
| rt-haiku-1 | solo-haiku | 2026-11-16 | 10 | 10 | $0.52 |
| rt2-haiku-1 | solo-haiku | 2026-11-16 | 29 | 28 | $1.06 |
| rt3-cascade-1 | cascade-claude | 2026-11-17 | 10 | 7 | $2.85 (some turns unknown) |
| rt3-haiku-1 | solo-haiku | 2026-11-17 | 10 | 8 | $1.22 |
| swl-cascade-1 | cascade-claude | 2026-11-17 | 21 | 5 | $5.13 |
| swl-cascade-notester | cascade-claude | 2026-11-17 | 7 | 1 | $1.05 |
| swl-f132-lost3 | dossier-sonnet | 2026-11-19 | 3 | 0 | $1.03 |
| swl-f132-opus-lost3 | dossier-claude | 2026-11-19 | 3 | 3 | $2.29 |
| swl-haiku-1 | solo-haiku | 2026-11-17 | 27 | 8 | $1.61 |
| swl-haiku-notes | solo-haiku | 2026-11-17 | 5 | 1 | $0.21 |
| swl-k1-a | patch-claude | 2026-11-18 | 10 | 2 | $2.77 |
| swl-k1-b | patch-claude | 2026-11-18 | 11 | 0 | $2.97 |
| swl-k1-probe | patch-claude | 2026-11-18 | 2 | 0 | $0.80 |
| swl-k6-helpers | dossier-claude | 2026-11-18 | 4 | 3 | $2.07 |
| swl-k6-openai | dossier-claude | 2026-11-18 | 1 | 1 | $0.49 |
| swl-k6-pair | dossier-claude | 2026-11-18 | 2 | 2 | $1.57 |
| swl-lead-1 | lead-claude | 2026-11-18 | 1 | 0 | $0.36 |
| swl-lead-2 | lead-claude | 2026-11-18 | 5 | 2 | $2.72 |
| swl-lead-3 | lead-claude | 2026-11-18 | 5 | 2 | $4.75 (some turns unknown) |
| swl-lead-3b | lead-claude | 2026-11-18 | 5 | 3 | $4.51 |
| swl-lead-3c | lead-claude | 2026-11-18 | 11 | 1 | $8.50 |
| swl-lead-4pair | lead-claude | 2026-11-18 | 2 | 1 | $1.17 |
| swl-lead-5trio | lead-claude | 2026-11-18 | 3 | 2 | $1.46 |
| swl-lead-probe | lead-claude | 2026-11-18 | 1 | 0 | $0.87 |
| swl-opus-1 | solo-opus | 2026-11-17 | 5 | 3 | $3.36 |
| swl-opus-2 | solo-opus | 2026-11-18 | 16 | 3 | $6.04 (some turns unknown) |
| swl-sonnet-1 | solo-haiku | 2026-11-18 | 5 | 1 | $1.10 |
| swl-trialA | dossier-claude | 2026-11-18 | 21 | 6 | $9.78 (some turns unknown) |
| swl-trialA2 | dossier-claude | 2026-11-19 | 21 | 8 | $8.91 (some turns unknown) |
| swl-trialB | dossier-sonnet | 2026-11-18 | 21 | 6 | $5.26 |
| try-factory-multi | factory | 2026-11-10 | 4 | 4 | unknown |
