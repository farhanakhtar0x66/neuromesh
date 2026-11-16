# Batch 3 manifest (built 2026-11-17 with a network, no model call; every number below is from the build, except the last column)

10 candidate tasks from three repositories that batch 2 could not use, all valid (the hidden check fails on the seed; passes on the
reference in 3 fresh runs; no test changes result between runs; the project's own check passes on the seed). "Source files" and
"Lines" count the reference change without the test files (documents, fixtures and a regenerated binary count as source files here;
notes below); "From" is the commit. **The last column is my guess, not a measurement**: it is set by how much of the prompt is a contract
the tests check to the letter, how dense the code is and how big the change is. Nothing here has run on a model. The first live run
replaces the guess.

| Task | Repository | Language | Kind | From | Source files | Lines + / - | fail-to-pass | pass-to-pass | Haiku difficulty (guess) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dt-typed-adb | droidtui | rust | refactor (typed commands + a library crate; the tests pin the new API) | ff1aed9 | 31 | +5555 / -2234 | 13 | 0 | easy-medium, about 55% |
| em-egress-cancel | edgemed | python | bug | 8fb9fa5 | 4 | +270 / -3 | 1 | 20 | easy, about 80% |
| em-inverted-index | edgemed | python | refactor (inverted index and caches; search results kept) | 6d68eb4 | 6 | +808 / -93 | 6 | 0 | medium-hard, about 35% |
| em-model-provisioning | edgemed | python | feature | a109452 | 6 | +66 / -6 | 2 | 1 | easy-medium, about 65% |
| em-unix-targets | edgemed | python | feature | 632bfd4 | 17 | +317 / -108 | 6 | 2 | medium-hard, about 40% |
| em-hospital-lan | edgemed | python | feature (only the TLS module is graded) | e1a4411 | 11 | +514 / -371 | 1 | 0 | medium, about 50% |
| an-com-demand | anpasser | python | refactor (demand-driven analysis; findings kept) | 5b6ec9d | 5 | +54 / -33 | 1 | 14 | hard, about 15% |
| an-process-init-gate | anpasser | python (+ Rust driver) | bug | 655e63f | 7 | +96 / -65 | 2 | 9 | medium-hard, about 30% |
| an-return-contract | anpasser | python | feature | f886605 | 12 | +132 / -46 | 6 | 9 | medium, about 40% |
| an-leaf-effects | anpasser | python | feature | 668a66d | 9 | +142 / -56 | 6 | 7 | hard, about 15% |

Notes on the numbers:

- `dt-typed-adb`: 1,950 of the added lines are four example programs and about 400 are VHS tape scripts; the graded part is `src/adb.rs` (415
  lines) and `src/lib.rs`. The seed does not build at all (`Cargo.toml` declares a library whose `src/lib.rs` is missing), so its
  pass-to-pass list is empty. 18 more fail-to-pass tests exist in the reference's own `#[cfg(test)]` modules; they are dropped (README, "Rust tests inside source files").
- `em-egress-cancel`: 257 of the added lines are `THREAT_MODEL.md`; the code change is 13 lines in 3 files. The new test file has 20 tests that already pass
  on the seed (they are the pass-to-pass list); one fails.
- `em-inverted-index`: every test of the new file imports `LexicalCorpus`, so all 6 fail on the seed and the pass-to-pass list is empty: the
  behaviour-kept part (the same search results) is only checked by one test that compares the inverted-index scores with the old formula.
- `em-hospital-lan`: the real commit also added staff accounts, a LAN mode in the API and CLI and a frontend rewrite; the test that exercises
  those needs the embedding model, so only `edgemed/lan.py` is graded and the prompt says so.
- `an-*`: in `an-com-demand`, `an-return-contract` and `an-leaf-effects` the source-file counts include one regenerated binary test fixture
  (`game.exe`) and generated `build.json` hashes; the logic is a few dozen changed lines of very dense Python.
- fail-to-pass in the `an-return-contract`, `an-leaf-effects` rows is 6 because the new tests make `tools/test_subsystem_flow.py` fail to import
  (`--continue-on-collection-errors` keeps the other file's tests out of the list).

## What each task grades, and how long its check takes

"Seed check" is one run of the hidden check on the seed (setup included, warm caches); it must fail, in under about 60 s. "Prewarm"
(network) and "make" (seed and reference runs that find the two lists) happen once, at build time. Times are from the owner's Mac on
2026-11-17, with other builds running at the same time.

| Task | Prewarm (network) | Make | Seed check | 3 reference runs + validation |
| --- | --- | --- | --- | --- |
| dt-typed-adb | 59 s | 26 s | 2 s (does not compile) | 61 s |
| em-egress-cancel | 13 s | 108 s | 45 s | 300 s |
| em-inverted-index | 11 s | 56 s | 21 s | 152 s |
| em-model-provisioning | 12 s | 55 s | 23 s | 139 s |
| em-unix-targets | 9 s | 26 s | 8 s | 91 s |
| em-hospital-lan | 12 s | 67 s | 14 s | 195 s |
| an-com-demand | 2 s | 13 s | 5 s | 30 s |
| an-process-init-gate | 1 s | 12 s | 4 s | 28 s |
| an-return-contract | 1 s | 16 s | 5 s | 29 s |
| an-leaf-effects | 1 s | 17 s | 5 s | 33 s |

A cold machine: the first Rust grading compiles every dependency of droidtui (the screening run, prewarm plus make, took 256 s); `edgemed`'s
first `uv sync` downloads its wheels (about 20 s with a warm `uv` cache); the anpasser tasks need only `pytest`.
`em-egress-cancel` is the slowest check because its three test files include a 20-test security suite.

## Mix

| By | Count |
| --- | --- |
| Source | 1 droidtui (Rust), 5 edgemed (Python), 4 anpasser (Python tools) |
| Kind | refactor 3, feature 5, bug 2 (no new program) |
| Guessed Haiku difficulty | easy 1, easy-medium 2, medium 2, medium-hard 3, hard 2 |
| Languages | Python 9, Rust 1 |

The guessed mean pass share is about 42 percent, inside the 40 to 70 band but at its low end, and it leans on `em-egress-cancel` and
`dt-typed-adb`. If the live run finds Haiku below 40 percent on this batch, the two anpasser tasks guessed at 15 percent are the ones to
look at first: their prompts are long and the code is dense, so they may measure patience with the prompt more than skill.

## Repository split (phase 1, step 6)

Batch 3 adds three repositories to the pool: droidtui, edgemed, anpasser. With batches 2 and 3 together, a split with no repository in both
halves is now possible with at least five sources: for example tuning = neuromesh + droidtui + edgemed; held-out = anpasser + scope-test-2 +
ProofBench. Authorship: anpasser is the owner's alone (38 commits), edgemed is shared (the owner 12 commits, two collaborators 10), droidtui is a
third-party project (`Sorin Albu-Irimies`, 187 commits, plus a bot) that the owner only has a clone of, so it is the one batch-3 repository that
is independent of the owner.

## Skipped, and why

Dependencies were not the obstacle: `cargo fetch` and `uv sync` worked in clones of all three repositories (droidtui's `gpui` is in the registry
for its current history; anpasser needs only `pytest` for its Python tools). What stopped candidates was the tests.

| Commit | Repository | Reason |
| --- | --- | --- |
| `48a3ba2` extract a core library (68 files) | droidtui | **builds and validates but cannot be graded**: its 51 fail-to-pass tests are `#[cfg(test)]` modules of the new core crate (they exist only in the reference's source), and the one test file it adds is an existing test moved to a new path with the same test names, so it also passes on the seed |
| `c0bcff8`, and every droidtui commit from `7c5f3bf` to `c576c77` (2026-07-10 to 2026-07-13) | droidtui | the workspace depends on `gpui` as a **git dependency on the Zed monorepo**: `cargo fetch` clones it for more than 9 minutes and holds cargo's package-cache lock |
| `9cc4616`, `7ad55cf`, `6add84c` (real refactors) and most others | droidtui | their tests are inline `#[cfg(test)]` modules, so there is no test file to hide |
| `a8fc6f7`, `82b1ec5`, `14fdbcc`, `8e5aa03` (packaging) | droidtui | the only tests are `crates/*/tests/packaging.rs`, which assert the text of packaging files (a Snap manifest, a Flatpak YAML); a model would be guessing file contents |
| `e2c9aba`, `9331392`, `9a3b32f` | anpasser | no test fails on the seed and passes on the reference on macOS: the new assertions are Linux-only or the change moves no test result |
| `58581ae` (launch deadlines) | anpasser | its test builds and runs a native game and is skipped on macOS (`skipUnless(Linux x86-64)`), so nothing could be graded here |
| `10374e0` (subsystem planning) | anpasser | valid on the fake backend, but the second test needs six new Python tools and a taxonomy ("directdraw-direct3d-graphics") that a prompt cannot give without handing over the solution |
| `18329fe` (native component), `45aa47b` (native Pinball runtime) | anpasser | `18329fe` adds about 15 Python tools around a 198-line Rust module and its two tests check error paths only; `45aa47b`'s tests printed nothing readable on the reference |
| `31d62e6`, `891953b`, `295118b`, `4cabdec`, `3ae34a1`, `4339de2`, `bdaa37e` | anpasser | milestone commits of 1,000 to 17,000 lines; `31d62e6` and `891953b` were not screened (the screening process was stopped when `45aa47b` held up the cargo lock) |
| `30b4799` (local memory lifecycle), `c813223` (prototype) | edgemed | 43 and 15 files, 2,541 and 2,121 lines: the prompt would be the change |
| `668a66d`'s whole-program test (`test_direct_import_thunk_lowering...`) | anpasser | left out of `an-leaf-effects`'s test command (the task is included without it): the native lowering it checks is not describable without handing over the code |

The edgemed tests that load the pinned ONNX model (`test_relevance`, `test_real_edge`, one test of `test_hospital_lan`) fail on the seed
and on the reference here, so they are in no list; provisioning the model (`scripts/provision_assets.py --model-only`, network) would
make them gradable and add pass-to-pass tests to the edgemed tasks, at the cost of a download and about 90 s per full test run.

## Short of the target

The task asked for 10 to 15 and this is 10, the bottom of the range. The count is bounded by the tests: droidtui puts its tests inside its
source files, anpasser's Python tests are skipped on a Mac when they run native code, and the milestone commits are too large to
prompt. Linux or a provisioned model would roughly double what edgemed and anpasser can offer.
