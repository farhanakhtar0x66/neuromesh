# Real-repository tasks, batch 3 (beta week 1)

More candidate tasks for the beta claim (`HANDOFF.md` item 6f, `docs/22-path-to-the-goal.md` phase 1): about 40 real tasks on
which Haiku alone passes 40 to 70 percent. Batch 2 (`evals/real-tasks-2/`) was 17 neuromesh commits, 10 ProofBench fixtures
and 2 synthetic refactors: too much of one repository and no real refactor commit. This batch comes from the three
repositories that `evals/real-tasks/BATCH-2.md` listed as blocked only because their dependencies could not be fetched offline:
`droidtui` (Rust), `anpasser` (Python tools, Rust, C) and `edgemed` (Python). Built on 2026-11-17 with a network and no model call.
**Nothing here has been run on a model yet**: the difficulty column of `MANIFEST.md` is a guess.

The task folders (seed, hidden tests, reference) are made from the recipe and are not committed (`.gitignore`); what is committed
is the recipe: `batch-3.json`, `prompts/`, `build.ts`. The clones the tasks are made from are not touched: `make-task.ts` clones
the repository path into a temporary folder, and the prewarm step reads it with `git archive`.

## Build

    node evals/real-tasks-3/build.ts                       # makes and validates every task (about 1 hour the first time)
    node evals/real-tasks-3/build.ts --only an-com-demand  # one task
    node evals/real-tasks-3/build.ts --no-prewarm          # no network: the dependency caches must already be warm

`build.ts` is a thin driver over `makeTask()` (`evals/make-task.ts`) and `validateTask()` (`evals/validate-task.ts`). For each
entry of `batch-3.json` it (1) **prewarms**: runs the entry's `prewarm` command (`cargo fetch`, `uv sync`) in a plain checkout of
the commit and of its parent, the only step that needs the network and the reason the task's own `setup` can run offline;
(2) makes the task with the entry's `setup` (`cargo fetch --offline || cargo fetch`, `uv sync --offline || uv sync`, or a venv
with pytest), which `grade.ts` runs before the tests in every fresh workspace; (3) for `dt-typed-adb` narrows the fail-to-pass list
(below); (4) times one run of the hidden check on the seed; (5) validates: the check fails on the seed, passes on the reference in
each of 3 fresh copies, no test changes result, and the project's own check (`checks` in `task.json`) passes on the seed.

## What is different from batch 2

- **Dependencies.** Every task needs a toolchain's packages. The `setup` of a task fetches them (offline when the cache is warm).
  The Rust tasks run `cargo test` with `CARGO_TARGET_DIR=${TMPDIR:-/tmp}/neuromesh-rt3-target/<repo>`: a build directory shared by
  all copies of that repository, because a fresh copy would otherwise compile every dependency again (about 4 minutes cold for
  droidtui, against about 20 seconds with the shared directory). The first grading on a new machine is therefore slow, the rest are not.
  The Python tasks use a project virtual environment made by `uv` inside the workspace (`edgemed`: `uv sync`; `anpasser`: a venv with
  pytest only, its tools use the standard library).
- **`--continue-on-collection-errors` on every pytest command.** A new test that imports a name the seed lacks makes pytest abort the
  whole run at collection, so every named test "fails" on the seed, including ones the change did not touch. With the flag only the
  files that cannot be imported fail, so the fail-to-pass list is what the change really adds and the pass-to-pass list is real.
- **Tests that need a model or a toolchain that is not here are left out of the lists, not fixed.** The edgemed tests that load the pinned
  ONNX model fail on the seed and on the reference alike, so they are in neither list. The anpasser tests that build and run a native
  game are skipped by their own `skipUnless(Linux x86-64)` on a Mac, so the part of a change that only they exercise is not graded here;
  the prompt still asks for it (and says so), because the real change did it.
- **Rust tests inside source files.** droidtui's unit tests live in `#[cfg(test)]` modules of the source files, which a reference
  change replaces. A fail-to-pass test that exists only in the reference's own source cannot be expected from another solution, so
  for `dt-typed-adb` the list is narrowed to the tests of the hidden test file (`failToPassFrom: "hidden"` in `batch-3.json`; the
  ones dropped are counted in the build output).

## Running them

    neuromesh eval --suite evals/real-tasks-3 --fake                                           # no model calls: every task must pass
    neuromesh eval --suite evals/real-tasks-3 --preset solo-haiku --name rt3-haiku-1 --quota   # LIVE: spends quota, run from an idle session

## What was audited, and what to know before trusting a number

- **Prompts are written for this batch, not copied from the commit messages** (most are a title and nothing else). Each states the
  behaviour and every name, message text, file name and field the hidden tests rely on, and leaves out how it is built. They are 440 to
  900 words, not terse on purpose: difficulty must come from the work, not from hiding the contract. Each ends with "Graded by ... (not in
  your copy of the repository)" and says what the tests check.
- **Some of what a prompt asks for is not graded** (the examples and menu wiring of `dt-typed-adb`; the staff accounts of the LAN
  commit are left out of `em-hospital-lan` on purpose; the Linux-only native wiring in `an-return-contract`). Each prompt says which part is graded.
  A solution that does only the graded part passes; do not read a pass as the whole commit.
- **One repository per author's habit.** `anpasser` code is dense (several statements per line, no comments); its tasks are the
  hardest in the batch and its prompts the longest.
- **Whose commits.** anpasser is the owner's alone; edgemed is shared with two collaborators (`6d68eb4` and `8fb9fa5` are theirs);
  droidtui (`dt-typed-adb`) is a third-party project, the one repository of this batch that is independent of the owner.
- **Reference changes include non-code files** (documents, fixtures, a regenerated binary test fixture): "files" and "lines" in
  `MANIFEST.md` count everything that is not a test file, with the binary and document share noted where it matters.
