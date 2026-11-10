"""Compare next_run with a slow, obviously correct search."""
import time
from datetime import datetime, timedelta

from cron import next_run

NAMES = {"month": ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], "dow": ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]}
RANGES = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]


def value(text, field):
    if field == 3 and text.upper() in NAMES["month"]:
        return NAMES["month"].index(text.upper()) + 1
    if field == 4 and text.upper() in NAMES["dow"]:
        return NAMES["dow"].index(text.upper())
    return int(text)


def expand(text, field):
    lo, hi = RANGES[field]
    out = set()
    for item in text.split(","):
        base, _, step = item.partition("/")
        step = int(step) if step else 1
        if base == "*":
            a, b = lo, hi
        elif "-" in base:
            a, b = (value(x, field) for x in base.split("-"))
        else:
            a = value(base, field)
            b = hi if step != 1 or "/" in item else a
        out.update(range(a, b + 1, step))
    if field == 4 and 7 in out:
        out.add(0)
    return out


def slow(expression, after):
    parts = expression.split()
    sets = [expand(p, i) for i, p in enumerate(parts)]
    dom_star, dow_star = parts[2] == "*", parts[4] == "*"
    day = after.replace(hour=0, minute=0, second=0, microsecond=0)
    start = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(366 * 10 + 3):
        dow = (day.weekday() + 1) % 7
        dom_ok, dow_ok = day.day in sets[2], dow in sets[4]
        if dom_star and dow_star:
            day_ok = True
        elif dom_star:
            day_ok = dow_ok
        elif dow_star:
            day_ok = dom_ok
        else:
            day_ok = dom_ok or dow_ok
        if day.month in sets[3] and day_ok:
            for h in sorted(sets[1]):
                for m in sorted(sets[0]):
                    t = day.replace(hour=h, minute=m)
                    if t >= start:
                        return t
        day += timedelta(days=1)
    return None


EXPRESSIONS = [
    "*/15 * * * *", "0 9 * * MON-FRI", "30 2 1 * *", "0 0 29 2 *", "5,10,50 */6 * * *",
    "0 12 13 * 5", "0 0 * * 0", "0 0 * * 7", "15 14 1 jan,jul *", "0-10/5 8-17/3 * * 1-5",
    "59 23 31 12 *", "0 0 1 */3 *", "0 0 15 * sat", "7/20 * * * *", "0 4 L * *",
]
STARTS = [datetime(2026, 1, 1, 10, 7, 30), datetime(2026, 2, 28, 23, 59), datetime(2027, 12, 31, 23, 59, 59), datetime(2028, 2, 29, 0, 0)]

checked = 0
for expression in EXPRESSIONS:
    for start in STARTS:
        try:
            want = slow(expression, start)
        except ValueError:
            want = "error"
        try:
            t0 = time.time()
            got = next_run(expression, start)
            assert time.time() - t0 < 1.0, f"{expression!r} took too long"
        except ValueError:
            got = "error"
        if want is None:
            want = "error"
        assert got == want, (expression, start, got, want)
        checked += 1

for bad in ["* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "5-1 * * * *", "* * * FOO *", "0 0 30 2 *", "0 0 31 4,6,9,11 *", ""]:
    try:
        next_run(bad, datetime(2026, 1, 1))
    except ValueError:
        continue
    raise AssertionError(f"expected ValueError for {bad!r}")
print(f"hidden check passed ({checked} comparisons)")
