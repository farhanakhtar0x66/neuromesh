import os, re, sys, threading, time
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.stdout.flush()
    os._exit(0 if passed == len(ITEMS) else 1)  # a broken lock can leave threads stuck: do not wait for them

sys.path.insert(0, os.getcwd())
try:
    from rwlock import TaskFairRWLock
except Exception as e:
    TaskFairRWLock = None
    print("import failed:", e)
item("rwlock.py imports TaskFairRWLock", TaskFairRWLock is not None)
if TaskFairRWLock is None:
    done()

def attempt(fn):
    try:
        return bool(fn())
    except BaseException as e:
        print("  raised", type(e).__name__, e)
        return False

def spawn(fn):
    t = threading.Thread(target=fn, daemon=True)
    t.start()
    return t

def t_readers_and_writer():
    lock = TaskFairRWLock()
    barrier = threading.Barrier(3, timeout=5)
    release = threading.Event()
    got = []
    def reader():
        lock.acquire_read()
        got.append("in")
        barrier.wait()  # all three hold the read lock at the same moment
        release.wait(5)
        lock.release_read()
    rs = [spawn(reader) for _ in range(3)]
    while len(got) < 3 and not barrier.broken:
        time.sleep(0.01)
    time.sleep(0.1)
    wrote = threading.Event()
    def writer():
        lock.acquire_write()
        wrote.set()
        lock.release_write()
    w = spawn(writer)
    blocked = not wrote.wait(0.3)
    release.set()
    for r in rs:
        r.join(5)
    w.join(5)
    return len(got) == 3 and blocked and wrote.is_set()

def t_writer_preference_and_reentry():
    lock = TaskFairRWLock()
    r1_in, r2_in, w_in, r1_release = threading.Event(), threading.Event(), threading.Event(), threading.Event()
    state = {"reentered": False}
    def r1():
        lock.acquire_read()
        r1_in.set()
        time.sleep(0.4)  # a writer queues up meanwhile
        lock.acquire_read()
        lock.acquire_read()
        lock.release_read()
        lock.release_read()
        state["reentered"] = True
        lock.release_read()
    def w():
        lock.acquire_write()
        w_in.set()
        lock.release_write()
    def r2():
        lock.acquire_read()
        r2_in.set()
        lock.release_read()
    t1 = spawn(r1)
    r1_in.wait(2)
    tw = spawn(w)
    time.sleep(0.15)
    t2 = spawn(r2)
    time.sleep(0.15)
    new_reader_blocked = not r2_in.is_set()  # the writer is waiting, so a new reader must wait
    for t in (t1, tw, t2):
        t.join(5)
    return new_reader_blocked and state["reentered"] and w_in.is_set() and r2_in.is_set() and not any(t.is_alive() for t in (t1, tw, t2))

def t_single_upgrade():
    lock = TaskFairRWLock()
    a_in, b_in, b_release, upgraded = threading.Event(), threading.Event(), threading.Event(), threading.Event()
    def b():
        lock.acquire_read()
        b_in.set()
        b_release.wait(5)
        lock.release_read()
    def a():
        lock.acquire_read()
        a_in.set()
        lock.upgrade()
        upgraded.set()
        lock.release_write()
    tb = spawn(b)
    b_in.wait(2)
    ta = spawn(a)
    a_in.wait(2)
    waited = not upgraded.wait(0.3)  # b still reads: the upgrade must wait
    b_release.set()
    ok = upgraded.wait(3)
    ta.join(3)
    tb.join(3)
    return waited and ok

def t_two_upgraders():
    lock = TaskFairRWLock()
    barrier = threading.Barrier(2, timeout=5)
    outcome = {}
    failed_released = threading.Event()
    done_at = {}
    def worker(name):
        lock.acquire_read()
        barrier.wait()
        try:
            lock.upgrade()
            outcome[name] = "upgraded"
            done_at[name] = time.time()
            lock.release_write()
        except RuntimeError as e:
            outcome[name] = str(e)
            time.sleep(0.3)  # keep the read lock a moment: the other upgrade cannot finish yet
            done_at[name] = time.time()
            failed_released.set()
            lock.release_read()
    ts = [spawn(lambda n=n: worker(n)) for n in ("p", "q")]
    for t in ts:
        t.join(8)
    if sorted(outcome) != ["p", "q"]:
        return False
    results = sorted(outcome.values())
    if results != ["Concurrent upgrade deadlock", "upgraded"]:
        return False
    failed = [n for n, v in outcome.items() if v != "upgraded"][0]
    winner = [n for n, v in outcome.items() if v == "upgraded"][0]
    return done_at[winner] >= done_at[failed] - 0.01  # the upgrade finished only after the other reader let go

item("three readers hold the lock together; a writer waits for all of them", TaskFairRWLock and attempt(t_readers_and_writer))
item("a waiting writer blocks new readers but not a re-entrant read", TaskFairRWLock and attempt(t_writer_preference_and_reentry))
item("one upgrade waits for another reader to leave, then becomes the writer", TaskFairRWLock and attempt(t_single_upgrade))
item("two concurrent upgraders: one raises 'Concurrent upgrade deadlock', the other finishes after it releases", TaskFairRWLock and attempt(t_two_upgraders))
a = (open("ANSWER.md", encoding="utf-8").read() if os.path.exists("ANSWER.md") else "").lower()
item("ANSWER.md explains the impossibility: both would wait for the other's read lock", bool(re.search(r"deadlock", a)) and bool(re.search(r"(each|both|two)[^.]*(wait|block)", a)) and bool(re.search(r"(imposs|cannot|can't|no solution|never)", a)))
done()
