# Rules

These are the rules `availability` and `free_slots` follow. Times are minutes; "local" means UTC plus the person's
offset; intervals are half-open.

## Regular hours

1. Local day `d` is the span `[d*1440, (d+1)*1440)` of local minutes. Its weekday is `(d + 3) mod 7`, with 0 = Monday
   (1970-01-01, day 0, was a Thursday). The weekday is the person's *local* weekday: a Monday 22:00 UTC meeting is
   already Tuesday for someone at UTC+05:30.
2. A weekly block `(weekday, start_min, end_min)` makes the person bookable from `start_min` to `end_min` minutes after
   local midnight on every local day with that weekday. A block never crosses midnight. A night shift is two blocks,
   `Mon 22:00-24:00` and `Tue 00:00-02:00`, and is one continuous stretch of time: touching blocks join.

## Exceptions

3. An *extra hours* exception makes the person bookable over its local interval, on top of the regular hours.
4. A *time off* exception (a day off is a time off that covers the whole local day) makes the person not bookable over
   its local interval. Time off wins over regular and extra hours alike.
5. An exception is an interval of local minutes and may cross local midnight: extra hours from 22:00 to 02:00 next day
   are bookable the whole time, and a time off from Tuesday 18:00 to Wednesday 12:00 covers the whole span.

## Meetings and buffers

6. A meeting `[start, end)` (UTC minutes) makes the person not bookable during it.
7. A meeting also protects a *buffer* before and after: it blocks `[start - before, end + after)`. A meeting's own
   buffer applies when it has one (`Some(n)`, and `Some(0)` means none); otherwise the person's default buffer applies.
   Buffers belong to the meeting they are set on and do not combine: two meetings block the union of their own
   blocked intervals.
8. Buffers only block. They never make a person bookable and they are not limited to the person's working hours.

## Putting it together

9. A person is bookable at minute `t` when (`t` is in regular hours or extra hours) and `t` is not in time off and `t`
   is not in a meeting's blocked interval.
10. `free_slots` returns the maximal intervals inside the window in which *every* person is bookable, nothing outside
    the window, that are at least `min_len` minutes long (a `min_len` below 1 counts as 1), in ascending order. A
    stretch of bookable minutes is never split: it is one interval however many blocks, exceptions and meetings made
    it up. No people, no slots.
11. The order of the lists in a `Person` has no effect on the result.
