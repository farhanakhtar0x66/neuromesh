Implement `unified_diff(old, new, context)` in `src/lib.rs`. It compares two texts line by line (as split by `str::lines`) and returns the differences in unified diff format, without file headers.

- If the texts have the same lines, return an empty string.
- Otherwise return one or more hunks. Each hunk starts with a header `@@ -<old_start>,<old_len> +<new_start>,<new_len> @@` followed by its lines, each prefixed with a space (unchanged), `-` (only in old) or `+` (only in new). Every output line, headers included, ends with `\n`.
- Starts are 1-based line numbers of the first line the hunk covers on that side. When a side's length is 0, its start is the number of the line just before the hunk on that side (0 at the very top).
- A hunk shows `context` unchanged lines before its first change and after its last change, or fewer at the start or end of the file. Changes separated by at most `2 * context` unchanged lines belong to the same hunk.
- The diff must be minimal: the total number of `-` and `+` lines must be as small as possible.
- In each run of consecutive changed lines, the `-` lines come before the `+` lines.
- It must stay fast for real files: two 2,000-line texts with a few scattered edits take well under a second, even in a debug build.

Do not add dependencies.
