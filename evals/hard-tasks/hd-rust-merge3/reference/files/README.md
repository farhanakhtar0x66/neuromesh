# textdiff

A small line-diff library and command line.

- `myers::diff` is Myers' shortest edit script between two slices.
- `hunk::hunks` groups an edit script into hunks: ranges of old lines replaced by ranges of new lines.
- `unified::unified_diff` writes `diff -u` style output.
- `merge::merge3` merges two versions of a text against their common base (see below).
- `lines::split_lines` splits text into lines that keep their `\n`.

## Command line

    textdiff diff <old> <new>

Prints a unified diff with 3 lines of context. Exit status: 0 the files are equal, 1 they differ, 2 trouble (bad
arguments, an unreadable file; the message goes to stderr).

    textdiff merge [--diff3] <base> <ours> <theirs>

Prints the merged text. Exit status: the number of conflicts (at most 127; 0 is a clean merge), 255 on trouble.

## Notes

- Lines are compared as whole strings, including the newline at their end.
- Hunks of one diff never touch: between two hunks there is at least one unchanged line.
- The crate has no dependencies. `cargo test --offline` runs everything.
