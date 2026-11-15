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
import shutil, signal, tempfile
sys.path.insert(0, os.getcwd())
signal.alarm(60)
try:
    from wal import WAL
except Exception as e:
    WAL = None
    print("import failed:", e)

def attempt(fn):
    try:
        return bool(fn())
    except BaseException as e:
        print("  raised", type(e).__name__, e)
        return False

tmp = tempfile.mkdtemp()
MARK = b"VALUE-ONE-MARK"

def build(path, extra=False):
    """The scenario log. Returns the expected committed state."""
    w = WAL(path)
    t1, t2, t3, t4 = w.begin(), w.begin(), w.begin(), w.begin()
    w.put(t1, b"k1", MARK)
    w.put(t2, b"k3", b"gone-aborted")
    w.put(t1, b"k2", b"two")
    w.put(t3, b"k4", b"never-committed")
    w.commit(t1)
    w.abort(t2)
    w.put(t4, b"k1", b"v4")
    w.delete(t4, b"k2")
    w.put(t4, b"k5", b"five")
    w.commit(t4)
    if extra:
        t5 = w.begin()
        w.put(t5, b"k6", b"six")
        w.commit(t5)
    w._f.flush()
    return {b"k1": b"v4", b"k5": b"five"}, (t1, t2, t3, t4)

BASE = {b"k1": b"v4", b"k5": b"five"}

def t_replay():
    p = os.path.join(tmp, "a.wal")
    state, ids = build(p)
    if state != BASE or list(ids) != sorted(set(ids)) or ids[0] < 1:
        return False
    w = WAL(p)
    if w.recover() != BASE or w.recover() != BASE:
        return False
    # commit order, not begin order, decides which write wins
    q = os.path.join(tmp, "b.wal")
    w = WAL(q)
    a, b = w.begin(), w.begin()
    w.put(b, b"k", b"from-b")
    w.put(a, b"k", b"from-a")
    w.commit(b)
    w.commit(a)
    return a < b and WAL(q).recover() == {b"k": b"from-a"}

def t_torn():
    p, ref = os.path.join(tmp, "base.wal"), os.path.join(tmp, "ref.wal")
    build(p)
    build(ref, extra=True)
    base, full = open(p, "rb").read(), open(ref, "rb").read()
    if full[:len(base)] != base:
        return False  # the format is not deterministic; the scenario cannot be built
    extra = full[len(base):]
    # a few bytes of the next frame: torn inside its header
    t1 = os.path.join(tmp, "t1.wal")
    open(t1, "wb").write(base + extra[:3])
    if WAL(t1).recover() != BASE or os.path.getsize(t1) != len(base):
        return False
    # the commit frame cut short: tx5 is not committed
    t2 = os.path.join(tmp, "t2.wal")
    open(t2, "wb").write(full[:-2])
    state = WAL(t2).recover()
    return state == BASE and len(base) <= os.path.getsize(t2) < len(full) - 2

def t_tail_flip():
    p, ref = os.path.join(tmp, "base2.wal"), os.path.join(tmp, "ref2.wal")
    build(p)
    build(ref, extra=True)
    base, full = open(p, "rb").read(), open(ref, "rb").read()
    bad = bytearray(full)
    bad[-1] ^= 0x01
    f = os.path.join(tmp, "flip.wal")
    open(f, "wb").write(bytes(bad))
    state = WAL(f).recover()
    return state == BASE and len(base) <= os.path.getsize(f) < len(full)

def t_mid_flip():
    p = os.path.join(tmp, "mid.wal")
    build(p, extra=True)
    data = bytearray(open(p, "rb").read())
    at = bytes(data).find(MARK)
    if at < 0:
        return False
    data[at + 3] ^= 0x04
    open(p, "wb").write(bytes(data))
    size = os.path.getsize(p)
    try:
        WAL(p).recover()
    except ValueError as e:
        return "Corrupted committed log segment" in str(e) and os.path.getsize(p) == size
    return False

def t_reopen():
    p, ref = os.path.join(tmp, "base3.wal"), os.path.join(tmp, "ref3.wal")
    build(p)
    build(ref, extra=True)
    base, full = open(p, "rb").read(), open(ref, "rb").read()
    f = os.path.join(tmp, "re.wal")
    open(f, "wb").write(base + full[len(base):][:3])
    WAL(f).recover()  # truncates the torn tail
    w = WAL(f)
    t5 = w.begin()
    if t5 <= 4:
        return False
    w.put(t5, b"k7", b"seven")
    w.commit(t5)
    return WAL(f).recover() == {**BASE, b"k7": b"seven"}

item("wal module imports", WAL is not None)
item("replay: committed only, in commit order; aborted and open transactions ignored", WAL and attempt(t_replay))
item("a torn frame at the end is cut off exactly and the state is returned", WAL and attempt(t_torn))
item("a flipped bit in an uncommitted tail frame is cut off, not raised", WAL and attempt(t_tail_flip))
item("a flipped bit before a later valid commit raises ValueError and keeps the file", WAL and attempt(t_mid_flip))
item("a new WAL on the cut file appends a fresh transaction cleanly", WAL and attempt(t_reopen))
shutil.rmtree(tmp, ignore_errors=True)
done()
