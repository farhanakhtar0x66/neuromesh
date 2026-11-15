import os, re, sys, json
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def read(path):
    try:
        return open(path, encoding="utf-8").read()
    except Exception:
        return None
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)
import random, signal, time, tracemalloc
sys.path.insert(0, os.getcwd())
signal.alarm(60)

try:
    from rate_limiter import SlidingLogLimiter
except Exception as e:
    SlidingLogLimiter = None
    print("import failed:", e)


class Oracle:
    """A from-scratch model of the rules: what is allowed, and the first millisecond that would be."""

    def __init__(self, mx, win, burst):
        self.mx, self.win, self.burst, self.q = mx, win, burst, win // 4
        self.log = {}

    def ok(self, who, now, cost):
        ev = self.log.get(who, [])
        full = sum(c for t, c in ev if now - self.win < t <= now)
        qtr = sum(c for t, c in ev if now - self.q < t <= now)
        return full + cost <= self.mx and qtr + cost <= self.burst

    def allow(self, who, now, cost=1):
        if cost <= 0 or cost > self.burst or cost > self.mx:
            return (False, -1)
        if self.ok(who, now, cost):
            self.log.setdefault(who, []).append((now, cost))
            return (True, 0)
        d = 1
        while not self.ok(who, now + d, cost):
            d += 1
        return (False, d)


def same_as_oracle(mx, win, burst, seed, calls=400, clients=2, max_gap=60, max_cost=4):
    if SlidingLogLimiter is None:
        return False
    rnd = random.Random(seed)
    lim, orc = SlidingLogLimiter(mx, win, burst), Oracle(mx, win, burst)
    now = 1000
    for _ in range(calls):
        now += rnd.choice([0, 0, 1, 5, rnd.randint(0, max_gap)])
        who = f"c{rnd.randrange(clients)}"
        cost = rnd.randint(1, max_cost)
        try:
            got = lim.allow(who, now, cost)
        except Exception:
            return False
        if tuple(got) != orc.allow(who, now, cost):
            return False
    return True


def attempt(fn):
    try:
        return bool(fn())
    except Exception:
        return False


def t_burst():
    L = SlidingLogLimiter(10, 1000, 3)
    r = [L.allow("a", 0), L.allow("a", 0), L.allow("a", 0)]
    if r != [(True, 0)] * 3:
        return False
    if tuple(L.allow("a", 0)) != (False, 250):
        return False
    if tuple(L.allow("a", 100)) != (False, 150):
        return False
    if tuple(L.allow("b", 0)) != (True, 0):
        return False
    return tuple(L.allow("a", 249)) == (False, 1) and tuple(L.allow("a", 250)) == (True, 0)


def t_full_window():
    L = SlidingLogLimiter(4, 1000, 2)
    r = [tuple(L.allow("a", t)) for t in (0, 100, 300, 400, 500)]
    # the quarter window caps bursts at 2, the full window caps the total at 4
    if r != [(True, 0), (True, 0), (True, 0), (True, 0), (False, 500)]:
        return False
    return same_as_oracle(6, 1000, 4, 1) and same_as_oracle(7, 1000, 7, 2) and same_as_oracle(5, 400, 2, 3, max_cost=2)


def t_multicost():
    L = SlidingLogLimiter(5, 1000, 5)
    for t in (0, 10, 20, 30, 40):
        if tuple(L.allow("a", t)) != (True, 0):
            return False
    # five singles; a cost-3 call must wait until the third has left the full window (20 + 1000 - 50)
    if tuple(L.allow("a", 50, 3)) != (False, 970):
        return False
    return same_as_oracle(9, 2000, 6, 4, max_cost=3) and same_as_oracle(8, 800, 8, 5, max_cost=5)


def t_impossible():
    L = SlidingLogLimiter(5, 1000, 3)
    if any(tuple(L.allow("a", 0, c)) != (False, -1) for c in (4, 6, 0, -2)):
        return False
    r = [tuple(L.allow("a", 0, 3))]  # the rejected calls left nothing behind
    r.append(tuple(L.allow("a", 0, 1)))
    return r == [(True, 0), (False, 250)]


def t_boundary():
    L = SlidingLogLimiter(1, 1000, 1)
    if tuple(L.allow("a", 100)) != (True, 0):
        return False
    if tuple(L.allow("a", 1099)) != (False, 1):
        return False
    if tuple(L.allow("a", 1100)) != (True, 0):
        return False
    tracemalloc.start()
    M = SlidingLogLimiter(50, 100, 50)
    start = time.time()
    for i in range(20000):
        M.allow("x", i, 1)
    took = time.time() - start
    size, _ = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return took < 8 and size < 600_000


item("limiter module imports", SlidingLogLimiter is not None)
item("burst cap saturates inside the quarter window, with the exact retry", SlidingLogLimiter and attempt(t_burst))
item("full-window saturation: exact retry across many random bursts", SlidingLogLimiter and attempt(t_full_window))
item("multi-cost partial expiry waits for the right entry", SlidingLogLimiter and attempt(t_multicost))
item("impossible costs return (False, -1) and leave no record", SlidingLogLimiter and attempt(t_impossible))
item("boundary (t - window_ms is expired) and 20,000 calls stay bounded", SlidingLogLimiter and attempt(t_boundary))
done()
