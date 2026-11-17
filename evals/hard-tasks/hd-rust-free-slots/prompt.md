# `free_slots` proposes times people cannot make, and misses times they can

The booking bot uses `calsched::free_slots` to propose a time for the weekly sync. Over the last two weeks we have had these reports. All of them are about the crate's results, so the fix belongs in `calsched`; the public API stays as it is.

1. **A meeting's buffer is ignored.** Dana (UTC) has a meeting on Wednesday from 10:00 to 11:00 and set a 30-minute buffer after that meeting (her default buffer, 10 minutes, applies to her other meetings). The bot proposed 11:15 to the group, and she was still wrapping up. It happens with buffers on the "before" side too, and when two of her meetings are close together or overlap.
2. **Nothing is proposed after midnight.** Lee added extra hours for Tuesday evening, from 22:00 to 02:00 his time. The bot offers his evening and never the hours after midnight. Time off that runs past midnight (a vacation that starts on Tuesday afternoon and ends Wednesday noon) has the matching problem.
3. **A day off is sometimes not honoured.** Ravi has two days off in his calendar export. The bot respected one and proposed a time on the other. Other people's lists are also exported in arbitrary order: the same people and the same data give different slots depending on how the export happened to order them.
4. **Contiguous hours are cut in two.** Mina's weekday hours are entered as two blocks, 09:00-12:00 and 12:00-17:00. Asking for a three-hour slot across noon finds nothing although she is free from 09:00 to 17:00. The same happens with a night shift written as Monday 22:00-24:00 plus Tuesday 00:00-02:00.

Fix `calsched` so these work for everybody, not only for these examples. `cargo test --offline` runs the crate's tests.
