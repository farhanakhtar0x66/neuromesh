# SWE-bench-Live tasks

Real GitHub issues from [SWE-bench-Live](https://github.com/microsoft/SWE-bench-Live) (MIT), run through Neuromesh's eval
runner and graded by the official harness. Added 2026-11-17 because Haiku 5.5 at high effort passed 9 of 12 of the synthetic
hard set (`evals/hard-tasks`): self-contained tasks no longer separate the models; finding where a fix belongs in a real
repository might. `instances.json` lists the instances; the task folders are rebuilt from the dataset and not committed.

## Setup (once per machine, about 15 minutes and 1 GB before images)

    colima start swe --vm-type vz --vz-rosetta --cpu 4 --memory 8 --disk 120   # x86 images through Rosetta on Apple Silicon
    docker context use default                                                  # colima switches the default context; switch back
    mkdir -p ~/.neuromesh/swe-live && cd ~/.neuromesh/swe-live
    git clone --recursive https://github.com/microsoft/SWE-bench-Live harness
    uv venv -p 3.12 .venv && uv pip install --python .venv/bin/python -e ./harness -e ./harness/launch
    # the dataset, split into one file per instance (the whole of it is over 512 MB):
    .venv/bin/python -c 'from datasets import load_dataset; import json, os; os.makedirs("rows", exist_ok=True)
    for r in load_dataset("SWE-bench-Live/SWE-bench-Live", split="full"):
        r = dict(r); r["created_at"] = str(r["created_at"]); open(f"rows/{r[\"instance_id\"]}.json", "w").write(json.dumps(r, default=str))'

Each instance's image is about 1.5 to 2 GB (x86_64), pulled by the importer.

## Build and run

    node evals/swe-live/import.ts                       # every instance in instances.json: import, then validate
    node evals/swe-live/import.ts --ids a__b-1,c__d-2   # some
    node evals/baselines.ts --suite evals/swe-live/tasks --only haiku,cascade1   # runs named swl-haiku-1, swl-cascade-1

Validation: the seed fails the hidden check and the real fix (gold patch) passes it in each of 2 runs; a task that does not
is moved to `tasks-rejected/`. `import.log` keeps one line per instance with the grading time.

## How a task works

- **Seed**: `/testbed` from the instance's image (the repository at the issue's base commit, with its built files), no `.git`.
- **Prompt**: the issue text as filed, then one paragraph: the environment is in Docker; run commands through
  `~/.neuromesh/swe-live/run/<instance> '<command>'`, which mounts the workspace at `/testbed` with no network; do not look
  the issue or its fix up online. The agents' tools have no web search (F08); the paragraph covers the shell.
- **Checks while working**: the existing test files the fix's tests touch, in the image, if they pass on the seed;
  otherwise `compileall`. They never contain the new tests.
- **Interface note** (`interfaces.json`, 5 of 27): where the hidden tests call a name, parameter or message that the issue
  never states (a private helper, a new keyword argument, a misspelt error message), the prompt adds it after the issue,
  as SWE-bench Pro does. Without it a right fix can fail on a guessed name. Found by listing the identifiers the test patch
  adds that are in the gold patch but in neither the seed nor the issue, then reading each by hand (most hits are words
  in strings or test variables). swl-haiku-1 ran without the notes; those 5 are rerun with them.
- **Hidden check** (`hidden/grade.sh`): the workspace's diff against the seed, given to the official harness for that one
  instance (`python -m evaluation.evaluation ... --patch_dir preds.json`), which applies the issue's tests in a fresh
  container and decides "resolved". The grader prints `SCORE <fail-to-pass passed>/<fail-to-pass total>`.

## Caveats

- The issues are from June to September 2025, before the models' training cut-off: a model may remember a fix. It
  favours every configuration alike, so comparisons hold; absolute rates may be high.
- Not the leaderboard protocol: the agent runs on the host, not inside the container, and the prompt adds the
  environment paragraph. Results are for comparing Neuromesh configurations, not for submission.
- Under Rosetta the tests run slower than native: one falcon grading takes about 100 s.
