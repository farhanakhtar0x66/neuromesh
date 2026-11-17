"""All the numbers of the report, in one pass over the lines."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .parse import parse_line
from .sessions import Sessionizer


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


class Analyzer:
    """Feed it lines one at a time, then ask for the Stats.

    Everything except the sessions does not depend on the order of the lines, so it is added up as the
    lines arrive. Only the sessions need the order, and the Sessionizer takes care of it.
    """

    def __init__(self) -> None:
        self._stats = Stats()
        self._sessionizer = Sessionizer()
        self._user_requests: dict[str, int] = {}
        self._hours: dict[str, list[int]] = {}

    def feed(self, line: str) -> None:
        stats = self._stats
        if not line.strip():
            return
        stats.lines += 1
        r = parse_line(line)
        if r is None:
            stats.malformed += 1
            return
        stats.requests += 1
        if stats.first is None or r.text < stats.first:
            stats.first = r.text
        if stats.last is None or r.text > stats.last:
            stats.last = r.text
        stats.total_bytes += r.nbytes
        stats.sum_ms += r.ms
        if stats.min_ms is None or r.ms < stats.min_ms:
            stats.min_ms = r.ms
        if stats.max_ms is None or r.ms > stats.max_ms:
            stats.max_ms = r.ms
        klass = r.status // 100
        stats.classes[klass] = stats.classes.get(klass, 0) + 1
        stats.paths[r.path] = stats.paths.get(r.path, 0) + 1
        bucket = self._hours.setdefault(r.text[:13], [0, 0])
        bucket[0] += 1
        if r.status >= 500:
            bucket[1] += 1
        self._user_requests[r.user] = self._user_requests.get(r.user, 0) + 1
        self._sessionizer.add(r.ts, r.user)

    def result(self) -> Stats:
        stats = self._stats
        sessions = self._sessionizer.finish()
        stats.hours = {hour: (n, errors) for hour, (n, errors) in self._hours.items()}
        stats.users = {user: (n, sessions[user]) for user, n in self._user_requests.items()}
        return stats


def analyze(lines: Iterable[str]) -> Stats:
    analyzer = Analyzer()
    for line in lines:
        analyzer.feed(line)
    return analyzer.result()
