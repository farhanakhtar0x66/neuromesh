import itertools, os, random, signal, sys
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)

sys.path.insert(0, os.path.join(os.getcwd(), "src"))
signal.alarm(120)
try:
    import fec_decoder as fec
except Exception as e:
    fec = None
    print("import failed:", e)
item("src/fec_decoder.py imports with encode and decode", fec is not None and callable(getattr(fec, "encode", None)) and callable(getattr(fec, "decode", None)))
if fec is None or not callable(getattr(fec, "encode", None)) or not callable(getattr(fec, "decode", None)):
    done()

rnd = random.Random(2026)
data = [bytes(rnd.randrange(256) for _ in range(64)) for _ in range(6)]
try:
    shards = fec.encode([bytes(d) for d in data])
except Exception as e:
    print("encode raised:", e)
    shards = []
item("encode returns 9 shards of 64 bytes", len(shards) == 9 and all(isinstance(s, (bytes, bytearray)) and len(s) == 64 for s in shards))
item("the first six shards are the data itself (systematic)", len(shards) == 9 and [bytes(s) for s in shards[:6]] == data)
item("the parity shards are not copies of data", len(shards) == 9 and all(bytes(p) not in data for p in shards[6:]) and len({bytes(p) for p in shards[6:]}) == 3)

def recovers(blocks, missing):
    held = [None if i in missing else bytes(s) for i, s in enumerate(blocks)]
    try:
        got = fec.decode(held)
    except Exception:
        return False
    return len(got) == 6 and [bytes(g) for g in got] == [bytes(d) for d in data]

if len(shards) == 9:
    combos = list(itertools.combinations(range(9), 3))
    item("all 84 three-shard erasures recover the six data shards exactly", len(combos) == 84 and all(recovers(shards, set(c)) for c in combos))
    item("zero, one and two erasures also recover", recovers(shards, set()) and all(recovers(shards, {i}) for i in range(9)) and all(recovers(shards, set(c)) for c in itertools.combinations(range(9), 2)))
    other = [bytes(rnd.randrange(256) for _ in range(64)) for _ in range(6)]
    again = fec.encode(other)
    held = [None, again[1], None, again[3], again[4], again[5], None, again[7], again[8]]
    try:
        ok = [bytes(x) for x in fec.decode(held)] == other
    except Exception:
        ok = False
    item("a fresh random block with parity shards standing in for data recovers", ok)
else:
    item("all 84 three-shard erasures recover the six data shards exactly", False)
    item("zero, one and two erasures also recover", False)
    item("a fresh random block with parity shards standing in for data recovers", False)
done()
