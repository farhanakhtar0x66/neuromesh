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
import signal
sys.path.insert(0, os.getcwd())
signal.alarm(60)
try:
    from raft_cluster import RaftCluster
except Exception as e:
    RaftCluster = None
    print("import failed:", e)

def attempt(fn):
    try:
        return bool(fn())
    except BaseException as e:
        print("  raised", type(e).__name__, e)
        return False

def cmds(log):
    return [c for _, c in log]

def elect(c, limit=120):
    for _ in range(limit):
        c.step(1)
        if c.leader() is not None:
            return c.leader()
    return None

def t_basic():
    c = RaftCluster(5)
    c.step(50)
    lead = c.leader()
    if lead is None:
        return False
    results = [c.propose(f"x{i}") for i in range(3)]
    if not all(r and r[0] is True for r in results):
        return False
    c.step(30)
    want = ["x0", "x1", "x2"]
    return all(cmds(c.full_log(i)) == want and cmds(c.committed_log(i)) == want for i in range(5)) and c.leader() == lead

def t_partition():
    c = RaftCluster(5)
    old = elect(c)
    if old is None:
        return False
    mate = (old + 1) % 5
    minority, majority = {old, mate}, set(range(5)) - {old, mate}
    c.partition(minority, majority)
    r = c.propose("lost", old)
    if not (r and r[0]):
        return False
    c.step(60)
    if "lost" in cmds(c.committed_log(old)):
        return False  # a minority leader must not commit
    new = c.leader()
    if new is None or new not in majority:
        return False
    r2 = c.propose("kept", new)
    if not (r2 and r2[0]) or r2[2] <= r[2]:
        return False
    c.step(40)
    if not all("kept" in cmds(c.committed_log(i)) for i in majority):
        return False
    c.heal()
    c.step(80)
    logs = [cmds(c.full_log(i)) for i in range(5)]
    return all(l == logs[0] for l in logs) and "lost" not in logs[0] and logs[0] == ["kept"] and all(cmds(c.committed_log(i)) == ["kept"] for i in range(5))

def t_vote_completeness():
    return all(vote_scenario(seed) for seed in (42, 1, 2, 3, 4, 5, 6, 7))

def vote_scenario(seed):
    c = RaftCluster(5, seed)
    lead = elect(c)
    if lead is None:
        return False
    z = (lead + 1) % 5
    c.isolate(z)  # z keeps timing out, so its term climbs, while its log stays empty
    c.step(15)
    for i in range(5):
        r = c.propose(f"c{i}")
        if not (r and r[0]):
            return False
        c.step(8)
    c.step(120)
    want = [f"c{i}" for i in range(5)]
    if any(cmds(c.committed_log(i)) != want for i in range(5) if i != z):
        return False
    c.heal()
    for _ in range(200):
        c.step(1)
        lead_now = c.leader()
        if lead_now is not None and cmds(c.full_log(lead_now))[:5] != want:
            return False  # a leader must hold every committed entry: z, with its stale log, may not win
    if c.leader() is None:
        return False
    return all(cmds(c.committed_log(i)) == want and cmds(c.full_log(i)) == want for i in range(5))

def t_figure8():
    c = RaftCluster(5)
    a = elect(c)  # the first leader, term 1
    if a is None:
        return False
    b = (a + 1) % 5
    rest = [i for i in range(5) if i not in (a, b)]
    c.partition({a, b}, set(rest))
    e1 = c.propose("e1", a)
    if not (e1 and e1[0]):
        return False
    c.step(12)  # e1 reaches b only: two copies out of five
    if cmds(c.full_log(b)) != ["e1"]:
        return False
    x = None
    for _ in range(100):
        c.step(1)
        if c.leader() in rest:
            x = c.leader()
            break
    if x is None:
        return False
    c.heal()
    c.isolate(x)  # cut x off first, so e2 stays on x alone whether proposals replicate at once or on the next tick
    e2 = c.propose("e2", x)
    if not (e2 and e2[0]):
        return False
    others = [i for i in rest if i != x]
    # Let the old leader hear the higher term and an election settle: reading leader() sooner can return
    # the old leader, which still believes it leads for a few ticks.
    c.step(120)
    lead = c.leader()
    if lead not in (a, b):
        return False  # only a node holding e1 may win: the others' logs are not up to date
    # the leader has copied e1 to a majority by now; it has appended nothing of its own
    copies = sum(1 for i in (a, b, *others) if ("e1" in cmds(c.full_log(i))))
    if copies < 3:
        return False
    if any("e1" in cmds(c.committed_log(i)) for i in range(5)):
        return False  # counting replicas of an old-term entry must not commit it
    e3 = c.propose("e3", lead)
    if not (e3 and e3[0]) or e3[2] <= e1[2]:
        return False
    c.step(40)
    got = cmds(c.committed_log(lead))
    return got == ["e1", "e3"]

item("raft_cluster module imports", RaftCluster is not None)
item("election converges within 50 ticks and entries replicate to all five", RaftCluster and attempt(t_basic))
item("a minority leader cannot commit; the majority elects a higher term, commits, and heal reconciles", RaftCluster and attempt(t_partition))
item("a stale-log candidate with a higher term cannot take over and lose committed entries", RaftCluster and attempt(t_vote_completeness))
item("Figure 8: an old-term entry on a majority stays uncommitted until a current-term entry commits", RaftCluster and attempt(t_figure8))
done()
