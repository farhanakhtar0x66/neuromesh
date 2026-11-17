"""All the numbers of the report. The whole log is held in memory and sorted by timestamp."""

from __future__ import annotations

from dataclasses import dataclass, field

from .parse import parse_line
from .sessions import count_sessions


@dataclass
class Stats:
    lines: int = 0
    malformed: int = 0
    requests: int = 0
    first: str | None = None
    last: str | None = None
    total_bytes: int = 0
    min_ms: int | None = None
    max_ms: int | None = None
    sum_ms: int = 0
    classes: dict[int, int] = field(default_factory=dict)  # status class (1..5) -> requests
    paths: dict[str, int] = field(default_factory=dict)  # path -> requests
    hours: dict[str, tuple[int, int]] = field(default_factory=dict)  # "YYYY-MM-DDTHH" -> (requests, errors)
    users: dict[str, tuple[int, int]] = field(default_factory=dict)  # user -> (requests, sessions)


def analyze(lines: list[str]) -> Stats:
    stats = Stats()
    records = []
    for line in lines:
        if not line.strip():
            continue
        stats.lines += 1
        record = parse_line(line)
        if record is None:
            stats.malformed += 1
            continue
        records.append(record)

    records.sort(key=lambda r: r.ts)
    stats.requests = len(records)
    if records:
        stats.first = records[0].text
        stats.last = records[-1].text
    per_user: dict[str, list[int]] = {}
    for r in records:
        stats.total_bytes += r.nbytes
        stats.sum_ms += r.ms
        stats.min_ms = r.ms if stats.min_ms is None else min(stats.min_ms, r.ms)
        stats.max_ms = r.ms if stats.max_ms is None else max(stats.max_ms, r.ms)
        stats.classes[r.status // 100] = stats.classes.get(r.status // 100, 0) + 1
        stats.paths[r.path] = stats.paths.get(r.path, 0) + 1
        hour = r.text[:13]
        n, errors = stats.hours.get(hour, (0, 0))
        stats.hours[hour] = (n + 1, errors + (1 if r.status >= 500 else 0))
        per_user.setdefault(r.user, []).append(r.ts)
    for user, times in per_user.items():
        stats.users[user] = (len(times), count_sessions(times))
    return stats
