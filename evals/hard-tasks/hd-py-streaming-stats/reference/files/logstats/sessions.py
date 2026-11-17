"""Sessions: a new one after more than SESSION_GAP seconds without a request, counted in one pass."""

from __future__ import annotations

import heapq

SESSION_GAP = 1800
# The log is in timestamp order except that a line may be up to this many seconds older than the
# newest line before it (README, "Order").
TOLERANCE = 60


class Sessionizer:
    """Counts sessions per user from requests that arrive nearly in order.

    A request is held back until it is final: once the newest timestamp seen is more than TOLERANCE
    seconds later, no request that is still to come can be older than it. Held requests leave in
    timestamp order, so each user's last timestamp and session count are exactly what sorting the
    whole log first would give. Memory is the requests of the last TOLERANCE seconds plus one small
    record per user.
    """

    def __init__(self) -> None:
        self._held: list[tuple[int, str]] = []  # a heap of (timestamp, user)
        self._newest: int | None = None
        self._per_user: dict[str, list[int]] = {}  # user -> [sessions, last timestamp]

    def add(self, ts: int, user: str) -> None:
        heapq.heappush(self._held, (ts, user))
        if self._newest is None or ts > self._newest:
            self._newest = ts
        final_before = self._newest - TOLERANCE
        while self._held and self._held[0][0] < final_before:
            self._release(*heapq.heappop(self._held))

    def _release(self, ts: int, user: str) -> None:
        state = self._per_user.get(user)
        if state is None:
            self._per_user[user] = [1, ts]
            return
        if ts - state[1] > SESSION_GAP:
            state[0] += 1
        state[1] = ts

    def finish(self) -> dict[str, int]:
        """Release everything still held; sessions per user."""
        while self._held:
            self._release(*heapq.heappop(self._held))
        return {user: state[0] for user, state in self._per_user.items()}
