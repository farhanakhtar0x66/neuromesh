# Big imports come out garbled

We load customer exports with csvstream (`node src/cli.ts import customers.csv --header`). Since the exports grew past a few
tens of megabytes we get bad data: customer names with accents or Japanese characters come out as `�`, some rows have
the wrong number of columns, rows run together or are split in two, now and then there is an extra empty row, and a
few times the header of the first column was `﻿id` instead of `id`.

If I cut a few thousand rows out of the same export (same encoding, same program, same options) and import that, it is
perfect. We can't find a pattern: the same file gives the same result each time, but the broken rows are in different
places for different exports.

Please find what is wrong and fix it. The imports must stay streaming: the biggest exports are several GB and are read
straight from disk.
