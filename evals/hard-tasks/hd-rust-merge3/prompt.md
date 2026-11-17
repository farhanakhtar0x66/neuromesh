# Add a three-way merge to textdiff

Our sync tool shells out to `git merge-file` to combine two edited copies of a file with their common ancestor. We want to drop that dependency and do the merge with `textdiff`, which already has the line diff (`myers::diff`, `hunk::hunks`) and `split_lines`.

## Library

Add `src/merge.rs` (module `textdiff::merge`), with these items also re-exported from the crate root:

```rust
pub enum ConflictStyle { Merge, Diff3 }          // derive Clone, Copy, Debug, PartialEq, Eq
pub struct MergeResult { pub text: String, pub conflicts: usize }   // derive Clone, Debug, PartialEq, Eq
pub fn merge3(base: &str, ours: &str, theirs: &str, style: ConflictStyle) -> MergeResult
```

`text` is the merged text and `conflicts` is the number of conflict blocks in it. Texts are split into lines with `split_lines`; the inputs are empty or end with a newline.

### What the merge does

The rules are those of `git merge-file`, without its conflict-shrinking extras:

1. Compare `ours` with `base` and `theirs` with `base` using the crate's line diff. Each hunk is a change: it replaces a range of base lines (empty for an insertion) with some lines (none for a deletion).
2. A change is applied as it is unless a change from the other side overlaps it or touches it. Two changes touch when one ends exactly where the other starts, that is, no unchanged base line separates them; this includes an insertion right before or after another change, and two insertions at the same place. Changes that overlap or touch, and any change chained to them the same way, make one region, from the first base line any of them covers to the last.
3. For a region with changes from both sides, take the lines each side has for the region's base range, that is, the base lines of the range with that side's changes applied. If the two are equal, write them once (both sides made the same change). Otherwise the region is a conflict.
4. A conflict is written in `Merge` style as

   ```
   <<<<<<< ours
   (our lines for the region)
   =======
   (their lines for the region)
   >>>>>>> theirs
   ```

   and in `Diff3` style with the region's base lines added between our lines and the `=======` line, after a `||||||| base` line (an insertion has no base lines, but the `||||||| base` line is still written). The markers are exactly as shown, each on a line of its own.
5. Every conflict region is its own block. Blocks are never joined with a neighbour, and lines the two sides happen to have in common are never moved out of a block, however close or similar the conflicts are. `conflicts` counts the blocks.
6. All other lines are copied unchanged, in order.

For example, with base `a b c d`, ours `a B c d` and theirs `a b C d` (one line per row), the changes touch, so in `Diff3` style the result is

```
a
<<<<<<< ours
B
c
||||||| base
b
c
=======
b
C
>>>>>>> theirs
d
```

with `conflicts == 1`.

## Command line

Add `textdiff merge [--diff3] <base> <ours> <theirs>`. It reads the three files, prints the merged text on stdout (conflicts in `Merge` style, or `Diff3` with `--diff3`, which comes before the paths) and exits with the number of conflicts, at most 127, so 0 means a clean merge. Any trouble (wrong arguments, an unreadable file) prints a message on stderr, prints nothing on stdout and exits with 255. `textdiff diff` stays as it is. Update the usage text and the README.

`cargo test --offline` runs the crate's tests.
