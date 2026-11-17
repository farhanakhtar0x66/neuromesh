"""Sessions: a new one after more than this many seconds without a request."""

from __future__ import annotations

SESSION_GAP = 1800


def count_sessions(times: list[int]) -> int:
    """Sessions in a list of timestamps sorted ascending."""
    if not times:
        return 0
    sessions = 1
    for before, after in zip(times, times[1:]):
        if after - before > SESSION_GAP:
            sessions += 1
    return sessions
