in `rate_limiter.py` (pure Python 3 stdlib), implement `class SlidingLogLimiter`:
- `__init__(self, max_requests: int, window_ms: int, burst_cap: int)`
- `allow(self, client_id: str, now_ms: int, cost: int = 1) -> tuple[bool, int]`
Return `(allowed, retry_after_ms)`. A request of `cost` tokens is allowed iff:
1. Total accepted cost for `client_id` in the open-closed interval `(now_ms - window_ms, now_ms]` plus `cost` is `<= max_requests`, AND
2. Total accepted cost for `client_id` in the quarter-window `(now_ms - (window_ms // 4), now_ms]` plus `cost` is `<= burst_cap`.
If allowed, record the request and return `(True, 0)`.
If rejected because `cost <= 0` or `cost > burst_cap` or `cost > max_requests`, do not record it and return `(False, -1)`.
Otherwise, do not record it and return `(False, retry_after_ms)` where `retry_after_ms` is the exact minimum positive integer milliseconds after `now_ms` at which calling `allow(client_id, now_ms + retry_after_ms, cost)` will succeed (accounting for BOTH windows simultaneously). Evict expired entries so memory does not grow unbounded.
