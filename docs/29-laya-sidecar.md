# Laya as a local sidecar (F139)

Built 2026-11-28, offline. Laya is not installed on this machine, and nothing here has talked to a real
`laya-serve`.

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

Nothing in the engine calls the gate yet. F139 is off by default (`--enable laya-gate`); wiring it into routing is a
later stage.

**Fail-safe:** a refused connection, no answer within the timeout, an HTTP error, a body over 64 KB, or malformed JSON
or answers all give `{ status: "unavailable", route: "review", reason }`. Nothing throws. A server found down is not
asked again for 30 seconds, so a run never waits on it more than once per window.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `NEUROMESH_LAYA_URL` | `http://127.0.0.1:8787` | |
| `NEUROMESH_LAYA_API_KEY` | none | sent as `Authorization: Bearer <key>` |
| `NEUROMESH_LAYA_TIMEOUT_MS` | `500` | covers the whole reply |
| `NEUROMESH_LAYA_ASK_PATH` | `/v1/ask` | **assumed**, see below |
| `NEUROMESH_LAYA_HEALTH_PATH` | `/health` | **assumed** |
| `NEUROMESH_LAYA_LEGACY_CALIBRATED` | off | `1` trusts Laya 0.3/0.4 answers (no `route`/`abstain`) as `auto`; otherwise they count as `review` |
| `NEUROMESH_LAYA_HEALTH_TTL_MS` | `30000` | how long a health result is kept |

## Check before the live phase

The Laya 0.5 field names (`route`, `abstain`, `prediction_set`, `unbound`, `noul`/`choice`/`score`) come from the
stage brief. `laya-serve`'s endpoint paths and request shape are not published anywhere we could find (web search,
2026-11-28), so these parts are guesses:

- `POST <url>/v1/ask` with `{ "context": <state text>, "questions": [{ "id", "type": "noul", "question" }] }`.
- `GET <url>/health`.
- The answers come back as `{ "version"?, "answers": [{ "id", "noul", "route", "abstain", "prediction_set",
  "unbound" }] }` or keyed by id. A `noul` value of `"yes"`, `"no"`, `true` or `false` is read, `"unknown"` counts as
  an abstention, and a one-element `prediction_set` is read when `noul` is missing.

If the real server differs, change the paths with the variables above, or change `layaRequestBody` and
`parseLayaResponse` in `src/routing/laya-client.ts`. Both are short and covered by `test/laya.test.ts`, which runs
against the in-process mock `test/support/mock-laya.ts`.

## Running it on the Mac

```sh
scripts/laya-sidecar.sh install ~/src/laya     # a local checkout, or an exact pip spec you trust
scripts/laya-sidecar.sh start                  # listens on 127.0.0.1 only
scripts/laya-sidecar.sh status
scripts/laya-sidecar.sh stop
```

- The virtual environment is `~/.neuromesh/laya-venv` (or `NEUROMESH_LAYA_VENV`), apart from any system Python. The
  pid and log files are in `~/.neuromesh/laya/`.
- On Apple silicon, PyTorch uses MPS where it can; the script sets `PYTORCH_ENABLE_MPS_FALLBACK=1` so operations MPS
  lacks run on the CPU.
- The script has no default package name: installing a guessed name from PyPI could install someone else's package.
- If `laya-serve` takes different flags, set `LAYA_SERVE_ARGS` (by default `--host 127.0.0.1 --port <port from
  NEUROMESH_LAYA_URL>`).
- `NEUROMESH_LAYA_API_KEY`, when set, is passed to the server as `LAYA_API_KEY`.

## License boundary

Neuromesh is MIT. Laya's server is Apache-2.0 and runs as a separate process, which Neuromesh only talks to over
HTTP: it adds no package to `package.json` and imports nothing from Laya.

`vegaml-learn` is under a noncommercial license. It must never be added to Neuromesh's dependencies or imported by its
code, and the helper script refuses to install it. If you install it yourself into the Laya venv for your own
calibration, it stays there, under its own license, and only for noncommercial use. Anything you calibrate with it
must not be shipped with Neuromesh.
