# hd-rust-merge3 (advisor only, never shown to a model)

Rust, feature, group B. Seed: crate `textdiff` (Myers diff, hunks, unified output, a `diff` command; 457 lines in
all, 282 in `src/`, 13 visible tests). Task: `merge3` (in `src/merge.rs`) with two conflict styles and a `merge`
subcommand with git-style exit codes. The prompt is the spec; it carries all rules.

## Traps (none is named in the prompt; each rule is stated as a plain sentence)

1. Hunk alignment: the two diffs are against the same base, so changes have to be walked together and grouped.
2. **Touching changes conflict** (no unchanged base line between them). Using "overlap" (`<`) instead of "overlap or
   touch" (`<=`) makes 91 hidden tests fail. This is the rule a small model most likely gets wrong, and it is stated
   in prompt rule 2 (fairness) as a rule, not as a warning.
3. Chains: a touches b touches c is one region (the base section and the conflict text cover all of it).
4. Identical changes on both sides are written once, also when each side made them as one hunk and the region also
   has other changes only if the region texts are equal (prompt rule 3).
5. Insertions: two insertions at the same place conflict unless equal; an insertion next to a change touches it; the
   diff3 base section of an insertion conflict is empty but the `||||||| base` line stays.
6. The diff3 base section is the whole region's base lines, not only the hunk that started it (27 tests).
7. Exit status: number of conflicts capped at 127 (2 tests), 255 for trouble, nothing on stdout then.
8. Conflicts are never joined, never shrunk (prompt rule 5). git merge-file's merge style does both (it joins
   conflicts at most 3 lines apart and moves common lines out), so this is stated explicitly, and no hidden case
   depends on git doing it.

Why a small model should fail: the three-line "apply both sides' hunks" merge passes the issue's easy cases; the
failures are touching/chains, the base section of regions, identical edits next to other edits, and the cap.
Mutation check (reference with one rule broken, hidden tests failing): touching treated as separate 91, identical
changes treated as conflicts 23, no cap at 127 2, base section only the first hunk 27.

## Fairness audit

- Every expected text in `cases.in` is printed by git, and a (case, style) pair is kept only if the reference
  solution prints the same text and the same conflict count (so only where the prompt's rules decide the output).
- Texts have unique, alphanumeric lines (`line 07 gamma`, `ours 048 opal`), so the line diff is unambiguous (no
  alignment choice for the model), and all end with a newline. Missing final newlines are not tested (the prompt
  says inputs are empty or end with a newline).
- Dropped by the filter: 3 of 170 pairs, all `many`/Merge style: git joined conflicts two unchanged lines apart
  (xdl_simplify_non_conflicts), which prompt rule 5 forbids. Diff3 of the same cases is kept.
- The property tests build files from segments separated by unchanged `sep NN` lines, so regions never touch and
  the expected text is constructed directly (also conflicts that are close together in Merge style: prompt rule 5).
- The CLI tests use only what the prompt states (flag before paths, exit status, 255 on trouble, empty stdout).
- Visible tests do not compile together with the hidden file on the seed, so on the seed all 13 visible tests are
  "not run" and the validator lists them as fail-to-pass (196 = 183 hidden + 13 visible); they pass on the reference.

## How the oracle was made

    python3 evals/hard-tasks/hd-rust-merge3/hidden/make-fixtures.py
    node evals/hard-tasks/hd-rust-merge3/hidden/make-spec.ts
    node evals/validate-task.ts evals/hard-tasks/hd-rust-merge3

`make-fixtures.py` (seeded `random.Random(20261117)`) draws candidates in 16 categories (disjoint, one-sided,
same-range, identical, overlap, touch-after, touch-before, same-insert-point, same-insert-identical,
insert-next-to-edit, delete-vs-edit, chain, edges, many, empty-base, emptied), runs for each candidate and each style
`git merge-file -p -L ours -L base -L theirs [--diff3] ours base theirs` (git 2.54, exit status = conflict count) and the
reference binary, and writes `hidden/tests/tests/hd_merge3_data/cases.in`: 85 cases, 167 (case, style) pairs, one
test each. Run `SHOW_DROPPED=1 python3 ...make-fixtures.py` to see the dropped pairs.

## Timing

The whole hidden check (`node hidden/grade.ts`, debug build, compile included) takes about 4 s on the reference
(tests themselves 0.4 s). No time limits in this task.

## Sizes

Reference: `src/merge.rs` 111 lines, `main.rs` +29, `lib.rs` +2, README +8: about 150 lines. 196 tests.
