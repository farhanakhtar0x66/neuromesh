# ho-cascade-2

Configuration: cascade (preset cascade-claude). Each line is written as it happens.

- 2026-11-15 18:48:31 UTC: started: 15 prompt(s) (held-out) on preset cascade-claude
- 2026-11-15 18:48:31 UTC: H1.1 h11-conflict-json: reading quota, then running
- 2026-11-15 18:48:34 UTC: H1.1 route.tier grunt
- 2026-11-15 18:49:49 UTC: H1.1 h11-conflict-json: applied, quality 10.0/10 (8/8), path grunt, 60,833 tokens, est. $0.0149 (API list prices), 1.2 min; quota before five_hour 30%, seven_day 21%, after five_hour 30%, seven_day 21%
- 2026-11-15 18:49:51 UTC: H1.2 h12-syslog-tsv: reading quota, then running
- 2026-11-15 18:49:53 UTC: H1.2 route.tier grunt
- 2026-11-15 18:50:06 UTC: H1.2 h12-syslog-tsv: applied, quality 10.0/10 (7/7), path grunt, 6,145 tokens, est. $0.0017 (API list prices), 0.2 min; quota before five_hour 30%, seven_day 21%, after five_hour 30%, seven_day 21%
- 2026-11-15 18:50:08 UTC: H1.3 h13-ddl-typeguard: reading quota, then running
- 2026-11-15 18:50:11 UTC: H1.3 route.tier worker
- 2026-11-15 18:51:02 UTC: H1.3 task.climbed to claude/claude-haiku-5-5: the worker error
- 2026-11-15 18:51:26 UTC: H1.3 h13-ddl-typeguard: applied, quality 10.0/10 (25/25), path worker, 232,071 tokens, est. $0.0145 (API list prices), 1.2 min; quota before five_hour 30%, seven_day 21%, after five_hour 30%, seven_day 21%
- 2026-11-15 18:51:28 UTC: H2.1 h21-sliding-limiter: reading quota, then running
- 2026-11-15 18:51:30 UTC: H2.1 route.tier worker
- 2026-11-15 18:54:27 UTC: H2.1 h21-sliding-limiter: applied, quality 10.0/10 (6/6), path worker, 351,642 tokens, est. $0.0284 (API list prices), 2.9 min; quota before five_hour 30%, seven_day 21%, after five_hour 30%, seven_day 21%
