"""One log line to a Record."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import NamedTuple

_LINE = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z"
    r"[ \t]+(\S+)"
    r"[ \t]+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)"
    r"[ \t]+(/\S*)"
    r"[ \t]+([1-5][0-9][0-9])"
    r"[ \t]+([0-9]+)"
    r"[ \t]+([0-9]+)"
)
_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


class Record(NamedTuple):
    ts: int  # seconds since 1970-01-01T00:00:00Z
    text: str  # the timestamp as written, YYYY-MM-DDTHH:MM:SSZ
    user: str
    method: str
    path: str
    status: int
    nbytes: int
    ms: int


def _leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


@lru_cache(maxsize=4096)
def _day_start(year: int, month: int, day: int) -> int | None:
    """Seconds at the start of a date, or None when the date does not exist."""
    if not 1 <= month <= 12:
        return None
    if not 1 <= day <= _DAYS[month - 1] + (1 if month == 2 and _leap(year) else 0):
        return None
    # days since 1970-01-01 (proleptic Gregorian, after Howard Hinnant's days_from_civil)
    y = year - (month <= 2)
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return (era * 146097 + doe - 719468) * 86400


def parse_line(line: str) -> Record | None:
    m = _LINE.fullmatch(line.strip())
    if m is None:
        return None
    year, month, day, hour, minute, second = (int(m.group(i)) for i in range(1, 7))
    start = _day_start(year, month, day)
    if start is None or hour > 23 or minute > 59 or second > 59:
        return None
    return Record(
        start + hour * 3600 + minute * 60 + second,
        line.strip()[:20],
        m.group(7),
        m.group(8),
        m.group(9),
        int(m.group(10)),
        int(m.group(11)),
        int(m.group(12)),
    )
