"""A large, deterministic log for the memory checks, produced chunk by chunk (nothing is held)."""

import io

BASE = 1_767_225_600  # 2026-01-01T00:00:00Z
USERS = 2000
PATHS = 300


class LogSource(io.RawIOBase):
    """A binary stream of `n` log lines, ten per second, every line up to 60 seconds older than the
    newest one so far (as the README allows). Users: 2000, paths: 300."""

    def __init__(self, n: int):
        self.n = n
        self.i = 0
        self.buf = b""
        # lookup tables, built once before anything is measured
        self.users = [f"user{k:04d}" for k in range(USERS)]
        self.paths = [f"/p/{k:03d}" for k in range(PATHS)]
        self.hms = [f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}" for s in range(86400)]
        self.days = []
        for d in range(8):
            t = BASE + d * 86400
            day = (t - BASE) // 86400 + 1
            self.days.append(f"2026-01-{day:02d}")

    def readable(self):
        return True

    def _chunk(self):
        out = []
        end = min(self.n, self.i + 2000)
        for i in range(self.i, end):
            ts = BASE + 86400 + i // 10 - (i * 37) % 61
            day, sod = divmod(ts - BASE, 86400)
            status = 500 if i % 23 == 0 else 404 if i % 17 == 0 else 200
            out.append(
                f"{self.days[day]}T{self.hms[sod]}Z {self.users[i * 7919 % USERS]} GET {self.paths[i * 104729 % PATHS]} {status} {i % 5000} {i % 777}\n"
            )
        self.i = end
        return "".join(out).encode()

    def readinto(self, b):
        if not self.buf:
            if self.i >= self.n:
                return 0
            self.buf = self._chunk()
        k = min(len(b), len(self.buf))
        b[:k] = self.buf[:k]
        self.buf = self.buf[k:]
        return k


def expected_counts(n: int) -> dict:
    five = (n - 1) // 23 + 1
    both = (n - 1) // (23 * 17) + 1
    four = ((n - 1) // 17 + 1) - both
    return {"lines": n, "requests": n, "5xx": five, "4xx": four}
