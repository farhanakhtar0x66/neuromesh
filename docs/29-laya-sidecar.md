# Laya as a local sidecar (F139)

Built 2026-11-28, offline; the wire format was corrected the same day against laya's published HTTP API
(`docs/http-api.md` and `README.md` in the laya repository). Laya is not installed on this machine, and nothing here
has talked to a real `laya-serve` yet.

## What Neuromesh does with it

`src/routing/laya-client.ts` sends one HTTP request per decision to a Laya server running on this machine. It asks
three yes/no questions about F138's state text, a plain-English summary of the repository and request with no code
and no file names:

| Question id | Asks |
| --- | --- |
| `is_mechanical_or_localized` | a localized, mechanical or boilerplate edit with explicit requirements and no hidden cross-module invariants? |
| `has_implied_invariants` | does it depend on unstated edge cases, cross-module invariants or architectural judgement? |
| `cheap_will_resolve` | will the current lower-tier model resolve it cleanly, without looping or missing hidden tests? |

`src/routing/laya-policy.ts` (`evaluateGate`) turns the answers and the probe's facts into one action:
`continue_cheap`, `escalate_sonnet` or `escalate_opus`.

- An answer counts only with `route: "auto"`, `abstain: false`, a one-answer `prediction_set` (when one is given)
  and a yes or no. All three questions must count.
- Will resolve, with nothing implied: `continue_cheap`. Otherwise: `escalate_sonnet` when nothing is implied or the
  edit is mechanical, else `escalate_opus`.
- Anything not decisive (review, abstained, two answers, Laya down) escalates by the probe: Opus on a hard or unclear
  repository, Sonnet for a small mechanical edit with low coupling. It never guesses cheap.
- Never a confidence number, and never `unbound`: that flag is kept for the record only, because it has many false
  positives.

F140 (`temporal-claude`) and the replay (F142) call the gate. F139 is off by default (`--enable laya-gate`).

**Fail-safe:** a refused connection, no answer within the timeout, an HTTP error, a body over 64 KB, or malformed JSON
or answers all give `{ status: "unavailable", route: "review", reason }`. Nothing throws. A server found down is not
asked again for 30 seconds, so a run never waits on it more than once per window.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `NEUROMESH_LAYA_URL` | `http://127.0.0.1:8787` | |
| `NEUROMESH_LAYA_API_KEY` | none | sent as `Authorization: Bearer <key>` |
| `NEUROMESH_LAYA_TIMEOUT_MS` | `500` | covers the whole reply |
| `NEUROMESH_LAYA_ASK_PATH` | `/v1/systemone` | laya's documented route |
| `NEUROMESH_LAYA_HEALTH_PATH` | `/health` | laya's documented route |
| `NEUROMESH_LAYA_LEGACY_CALIBRATED` | off | `1` trusts classic answers (no `route`/`abstain`) as `auto`; otherwise they count as `review` |
| `NEUROMESH_LAYA_MIN_CONFIDENCE` | none | sent as `min_confidence`; with the line above, only answers laya's gate marks `passed` count |
| `NEUROMESH_LAYA_HEALTH_TTL_MS` | `30000` | how long a health result is kept |

## The wire format (from laya's HTTP API docs)

- `GET <url>/health`, and `POST <url>/v1/systemone` with
  `{ "state": <state text>, "questions": { "<id>": { "type": "noul", "instructions": <question> } }, "min_confidence"? }`.
- The answers come back keyed by id: `{ "model", "answers": { "<id>": { "type": "noul", "noul": <probability of
  yes>, "confidence", ... } }, "usage", "routing" }`. A probability above 0.5 is read as yes, below as no; exactly
  0.5 is no answer. A one-answer `prediction_set`, when there is one, wins over the probability.
- **Stock laya-serve sends no conformal fields.** It serves the classic Router; `route`, `abstain` and
  `prediction_set` appear only on `laya.Agent`'s answers in Python. So every stock answer counts as `review`, and
  the gate escalates every task by the probe (a replay then shows 100 percent review: the trap to expect). Two ways
  out:
  - `scripts/laya-sidecar.sh start --agent` serves `laya.Agent` on the same routes (`scripts/laya-agent-server.py`,
    standard library plus laya, no vegaml-learn), so the conformal fields arrive. The agent's answer is passed
    through as it comes; check its shape with the curl below before trusting a replay.
  - Calibrate the classic router yourself, then set `NEUROMESH_LAYA_LEGACY_CALIBRATED=1`, best with
    `NEUROMESH_LAYA_MIN_CONFIDENCE` so laya's own gate (`abstention`: passed, abstained or unevaluated) decides.
- laya-serve takes its address from `LAYA_HOST` and `LAYA_PORT` (defaults `0.0.0.0` and `8000`) and has no flags for
  them; the helper script sets `127.0.0.1` and the port of `NEUROMESH_LAYA_URL` (8787).

Smoke check before any replay (no model call to Claude):

```sh
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/v1/systemone -H 'content-type: application/json' \
  -d '{"state":"A tiny repository; the request names one function.","questions":{"cheap_will_resolve":{"type":"noul","instructions":"Will the current lower-tier model resolve this cleanly?"}}}'
```

Look for `answers.cheap_will_resolve` with `noul`, and with `--agent` also `route`, `abstain` and
`prediction_set`. If the names differ, `parseLayaResponse` in `src/routing/laya-client.ts` is the one place to
change; `test/laya.test.ts` covers it.

## Calibrating on the replay's labels

`node evals/replay-temporal.ts` (F142) writes `~/.neuromesh/routing/laya-labels.jsonl`, one
`{ "stateText", "labels": { <id>: true | false | null } }` per run. `laya.Agent().fit(rows, questions=...)` takes
rows of `{ "state", "gold": { <id>: <label> } }` (drop the nulls) and needs about 35 rows for these questions (laya's
rule: 5 per option of the widest question, plus a quarter held out to calibrate, never fewer than 10);
`agent.save_calibration(dir)` keeps it, and `NEUROMESH_LAYA_CALIBRATION=<dir>` loads it in `--agent` mode. Per laya's
README this is in laya itself (Apache 2.0); `laya.Learner` and `laya.Escalator` are the vegaml-learn parts, which stay
out. Keep SWE-bench-Live out of the rows you fit on if you want its replay as a held-out test.

## Running it on the Mac

```sh
scripts/laya-sidecar.sh install 'laya[serve]'  # or an exact version, or a local checkout
scripts/laya-sidecar.sh start --agent          # laya.Agent with conformal fields; plain start is stock laya-serve
                                               # both listen on 127.0.0.1 only
scripts/laya-sidecar.sh status
scripts/laya-sidecar.sh stop
```

- The virtual environment is `~/.neuromesh/laya-venv` (or `NEUROMESH_LAYA_VENV`), apart from any system Python. The
  pid and log files are in `~/.neuromesh/laya/`.
- On Apple silicon, PyTorch uses MPS where it can; the script sets `PYTORCH_ENABLE_MPS_FALLBACK=1` so operations MPS
  lacks run on the CPU.
- The script has no default package name: installing a guessed name from PyPI could install someone else's package.
- `start --agent` serves laya.Agent instead of the classic router (see above). `LAYA_SERVE_ARGS` adds arguments to
  laya-serve, if you need any; its address always comes from `LAYA_HOST` and `LAYA_PORT`.
- `NEUROMESH_LAYA_API_KEY`, when set, is passed to the server as `LAYA_API_KEY`.

## License boundary

Neuromesh is MIT. Laya's server is Apache-2.0 and runs as a separate process, which Neuromesh only talks to over
HTTP: it adds no package to `package.json` and imports nothing from Laya.

`vegaml-learn` is under a noncommercial license. It must never be added to Neuromesh's dependencies or imported by its
code, and the helper script refuses to install it. If you install it yourself into the Laya venv for your own
calibration, it stays there, under its own license, and only for noncommercial use. Anything you calibrate with it
must not be shipped with Neuromesh.
