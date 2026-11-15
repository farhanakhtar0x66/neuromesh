from collections import deque


class SlidingLogLimiter:
    """Sliding-log limiter with a full window and a quarter-window burst cap."""

    def __init__(self, max_requests: int, window_ms: int, burst_cap: int):
        self.max_requests = max_requests
        self.window_ms = window_ms
        self.burst_cap = burst_cap
        self.burst_ms = window_ms // 4
        self._log: dict[str, deque] = {}

    def allow(self, client_id: str, now_ms: int, cost: int = 1) -> tuple[bool, int]:
        if cost <= 0 or cost > self.burst_cap or cost > self.max_requests:
            return (False, -1)
        log = self._log.setdefault(client_id, deque())
        while log and log[0][0] <= now_ms - self.window_ms:
            log.popleft()
        full = sum(c for _, c in log)
        burst = sum(c for t, c in log if t > now_ms - self.burst_ms)
        if full + cost <= self.max_requests and burst + cost <= self.burst_cap:
            log.append((now_ms, cost))
            return (True, 0)
        wait = 1
        # Full window: drop the oldest entries until the cost fits; the last one dropped sets the wait.
        remaining = full
        for t, c in log:
            if remaining + cost <= self.max_requests:
                break
            remaining -= c
            wait = max(wait, t + self.window_ms - now_ms)
        # Burst window: the same over the entries still inside the quarter window.
        remaining = burst
        for t, c in log:
            if t <= now_ms - self.burst_ms:
                continue
            if remaining + cost <= self.burst_cap:
                break
            remaining -= c
            wait = max(wait, t + self.burst_ms - now_ms)
        return (False, wait)
