# Batch 2: where more tasks can come from (surveyed 2026-11-16, no model calls)

Looked at every git repository under the home folder (`~/Projects`, `~/Documents`, `~/Extra`, `~/.config`),
asking of each: does it have commits that change code together with tests, and do those tests run on this
machine without the network? The second question rules most of them out. `neuromesh-old*` is the read-only
archive and was not used.

| Repository | Language | History | Tests run offline here? | Use |
| --- | --- | --- | --- | --- |
| `~/Projects/neuromesh` | TypeScript | 344 commits | yes (node --test) | 8 tasks in batch 1; plenty more, but one repository |
| `~/Projects/scope-test-2` | JavaScript | 4 commits | yes | 2 tasks in batch 1; `d7ac633` (a 19-file program) is a "new program" task but its tests pin too many interfaces to describe |
| `~/Projects/Global AI Hack/proofbench/fixtures/coding-tasks` | Rust | 10 ready-made fixtures, not commits | **yes**: no dependencies; `cargo test --offline` ran (task 1's seed fails 3 of 5 tests) | **best next source**: see below |
| `~/.config/terminal-ascii-screensaver/edgemed` | Python (pytest) | 22 commits | **no**: `uv sync --offline` cannot get `qdrant-edge-py` (not in the cache) | blocked; `6d68eb4` (inverted index and cached retrieval, behaviour kept) is the closest to a refactor |
| `~/Projects/anpasser` | Python, Rust, C | 38 commits, 38 test files | **no**: `cargo` cannot get `anstyle-wincon` offline | blocked until online |
| `~/Projects/droidtui` | Rust workspace | 191 commits | **no**: `gpui` is not in the registry | blocked until online; `ff1aed9` (typed ADB commands), `48a3ba2` (extract a core library) are real refactors |
| `proofbench`, `JalNet-Submission`, `hayate`, `Agentathon` | TypeScript, Java | 2 to 28 commits | **no**: dependencies (`node_modules`, Gradle) are not in git | blocked until online; JalNet's small `fix(...)` commits (`a3907fe`, `feed46e`, `f959a0c`) would fit |
| `bench-*`, `python-bot`, `scope-test`, `fitness-app`, `gpssre`, dotfiles | mixed | 1 to 5 commits, almost no tests | | nothing to use |
| `neuromesh-old-reference-*` | mixed | one snapshot each, third-party code | | no history to mine |

## What to build next, in order

1. **ProofBench's ten Rust fixtures as tasks (batch 2a).** Each fixture has a `workspace/` (the seed, with
   its tests in `tests/`), a `solution/`, and a `task.json` with a prompt. They build with no dependencies and
   no network. A small importer (`evals/import-fixture.ts`: seed = workspace without `tests/` and `target/`,
   `hidden/tests` = its `tests/`, `reference` = `solution/`, lists from the same run as `make-task.ts`) gives
   Rust tasks from a second repository: bugs (1, 3, 6, 8), a feature (2) and larger ones (4, 5, 7, 9, 10,
   not yet read). Tasks 6 and 8 are lint fixes a cheap model does, which is a useful floor for the difficulty
   mix. Their prompts are written for a benchmark that shows the tests to the agent, so each needs the leak
   audit. Caveat: this is the owner's own hackathon project, so it is not independent of the owner, only of
   Neuromesh.
2. **When there is a network: `droidtui` and `anpasser`** (Rust, Python, C; real refactor commits; real
   histories). Needs `cargo fetch` once, then `make-task.ts` with `--setup "cargo fetch --offline"` or the
   registry kept warm. Also `edgemed` (Python), after `uv sync` once.
3. **Refactor tasks.** The only real refactor commits are in the blocked repositories. Until then, a
   behaviour-keeping refactor can be written, not mined: pick a function with strong existing tests (they are
   the pass-to-pass set, the plan's O2 characterisation), ask for a structural change that adds one new
   importable name (the fail-to-pass test), and keep the original author's reference. Candidates:
   scope-test-2's note folding and compaction out of `src/context.js` into `src/notes.js`; neuromesh's
   `splitPayload` and its helpers out of `src/routing/router.ts` into `src/routing/payload.ts`. These are
   labelled "synthetic" in the manifest: they are not real commits and should be kept apart in the numbers.

## Splitting by repository (phase 1, step 6)

No repository may be in both halves. With what runs today: tuning half = neuromesh (8 tasks); held-out half =
scope-test-2 (2) plus the ProofBench fixtures (up to 10) once imported. That leaves the held-out half in two
repositories and the tuning half in one, which is thin on both sides; the blocked repositories (anpasser,
droidtui, edgemed, JalNet) are what would make it a split worth the name.
