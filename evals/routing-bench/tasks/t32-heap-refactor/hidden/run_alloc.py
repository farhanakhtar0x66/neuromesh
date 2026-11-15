"""Call the answer's allocate function on generated warehouses and orders and
compare with a plain FIFO-by-expiry allocation.

The prompt gives no data format and no return format ("without changing the
return dict structure" refers to code the prompt does not include), so the
check is tolerant about both:
  * every record carries every common spelling of its fields (id / order_id,
    qty / quantity, expiry / expiry_date / expires, warehouse / warehouse_id,
    batch / batch_id), all holding the same value;
  * allocation lines are recognised wherever the answer puts them: any dict
    with a quantity and a batch or warehouse reference, under an order id
    (as a key or as a field). Several views of the same allocation in one
    result (say a list and a summary) are tried one at a time.
    python3 run_alloc.py <workspace copy>
"""
import ast, copy, datetime, importlib.util, inspect, json, os, random, re, sys, time
from collections import Counter

work = sys.argv[1]
sys.path.insert(0, work)
out = {"error": None, "found": None, "checks": {}, "notes": []}


def emit():
    print(json.dumps(out))
    sys.exit(0)


try:
    spec = importlib.util.spec_from_file_location("answer_allocate", os.path.join(work, "allocate.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["answer_allocate"] = mod
    spec.loader.exec_module(mod)
except BaseException as e:
    out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    emit()

funcs = [(n, f) for n, f in vars(mod).items() if inspect.isfunction(f) and f.__module__ == "answer_allocate" and not n.startswith("_")]
pick = None
for pattern in (r"^allocate$", r"alloc", r"fifo|ship|match|assign|fulfil|distribut"):
    for n, f in funcs:
        if re.search(pattern, n, re.I) and len(inspect.signature(f).parameters) >= 2:
            pick = (n, f)
            break
    if pick:
        break
if not pick:
    pick = next(((n, f) for n, f in funcs if len(inspect.signature(f).parameters) >= 2), None)
if not pick:
    out["error"] = "no function that takes orders and batches"
    emit()
name, fn = pick
out["found"] = name
params = list(inspect.signature(fn).parameters)
swap = bool(re.search(r"batch|inventor|stock|warehouse", params[0], re.I) and re.search(r"order", params[1], re.I))


# The prompt does not say how the batches are held: a flat list, or {warehouse: [batches]}.
# Both are tried, the one that worked last first.
SHAPES = [lambda bs: bs, lambda bs: {x["warehouse"]: [x] for x in bs}]
shape = 0


def call(orders, batches):
    global shape
    last = None
    for k in [shape] + [i for i in range(len(SHAPES)) if i != shape]:
        try:
            held = SHAPES[k](batches)
            result = fn(held, orders) if swap else fn(orders, held)
            shape = k
            return result
        except Exception as e:
            last = e
    raise last


def make_case(rng, n_orders, n_batches, qty_hi=30, short=False):
    days = rng.sample(range(0, 4000), n_batches)
    base = datetime.date(2026, 1, 1)
    batches = []
    for i, d in enumerate(days):
        q = rng.randint(1, qty_hi)
        iso = (base + datetime.timedelta(days=d)).isoformat()
        batches.append({"id": f"B{i}", "batch_id": f"B{i}", "batch": f"B{i}", "warehouse": f"W{i}", "warehouse_id": f"W{i}",
                        "sku": "S1", "qty": q, "quantity": q, "expiry": iso, "expiry_date": iso, "expires": iso})
    stock = sum(b["qty"] for b in batches)
    orders = []
    for j in range(n_orders):
        q = rng.randint(1, max(1, qty_hi * (2 if not short else 4)))
        orders.append({"id": f"O{j}", "order_id": f"O{j}", "orderId": f"O{j}", "sku": "S1", "qty": q, "quantity": q, "customer": f"C{j}"})
    return orders, batches


def reference(orders, batches):
    left = {i: b["qty"] for i, b in enumerate(batches)}
    ranked = sorted(range(len(batches)), key=lambda i: batches[i]["expiry"])
    exp = Counter()
    p = 0
    for o in orders:
        need = o["qty"]
        while need > 0 and p < len(ranked):
            i = ranked[p]
            take = min(need, left[i])
            if take:
                exp[(o["id"], i)] += take
                left[i] -= take
                need -= take
            if left[i] == 0:
                p += 1
    return exp


QTY = re.compile(r"qty|quantit|allocated|shipped|units|count", re.I)
REF = re.compile(r"batch|warehouse|^wh|lot|location|source", re.I)


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def collect(node, order_ids, ref2idx, ctx, acc):
    """Append (order id, batch index, qty) for every allocation line under node."""
    if isinstance(node, dict):
        qk = [k for k in node if isinstance(k, str) and QTY.search(k) and is_int(node[k])]
        refs = [node[k] for k in node if isinstance(k, str) and REF.search(k) and isinstance(node[k], str) and node[k] in ref2idx]
        own = [node[k] for k in node if isinstance(k, str) and re.search(r"order", k, re.I) and isinstance(node[k], str) and node[k] in order_ids]
        if qk and refs:
            oid = own[0] if own else ctx
            if oid is not None and node[qk[0]]:
                acc.append((oid, ref2idx[refs[0]], node[qk[0]]))
            return
        for k, v in node.items():
            if isinstance(k, str) and k in ref2idx and is_int(v) and ctx is not None:   # {warehouse: qty}
                if v:
                    acc.append((ctx, ref2idx[k], v))
                continue
            collect(v, order_ids, ref2idx, k if k in order_ids else ctx, acc)
    elif isinstance(node, (list, tuple)):
        for v in node:
            collect(v, order_ids, ref2idx, ctx, acc)


def views(result, order_ids):
    yield result
    if isinstance(result, dict):
        for k, v in result.items():
            if k not in order_ids:
                yield v


def matches(result, orders, batches, expected):
    order_ids = {o["id"] for o in orders}
    ref2idx = {}
    for i, b in enumerate(batches):
        ref2idx[b["id"]] = i
        ref2idx[b["warehouse"]] = i
    for view in views(result, order_ids):
        acc = []
        collect(view, order_ids, ref2idx, None, acc)
        got = Counter()
        for oid, i, q in acc:
            got[(oid, i)] += q
        if got == expected:
            return True
    return False


C = out["checks"]


def check(key, fn_):
    try:
        C[key] = bool(fn_())
    except BaseException as e:
        C[key] = False
        out["notes"].append(f"{key}: {type(e).__name__}: {str(e)[:120]}")


def mk(batch_specs, order_qtys):
    batches = []
    for i, (q, iso) in enumerate(batch_specs):
        batches.append({"id": f"B{i}", "batch_id": f"B{i}", "batch": f"B{i}", "warehouse": f"W{i}", "warehouse_id": f"W{i}", "sku": "S1",
                        "qty": q, "quantity": q, "expiry": iso, "expiry_date": iso, "expires": iso})
    orders = [{"id": f"O{j}", "order_id": f"O{j}", "orderId": f"O{j}", "sku": "S1", "qty": q, "quantity": q, "customer": f"C{j}"} for j, q in enumerate(order_qtys)]
    return orders, batches


def basic():
    o, b = mk([(10, "2026-03-01"), (10, "2026-01-01"), (10, "2026-02-01")], [4])
    r = call(copy.deepcopy(o), copy.deepcopy(b))
    out["_basic"] = r
    return True


check("runs", basic)
check("returns_dict", lambda: isinstance(call(*[copy.deepcopy(x) for x in mk([(5, "2026-01-01")], [3])]), dict))


def fifo_order():
    o, b = mk([(10, "2026-03-01"), (10, "2026-01-01"), (10, "2026-02-01")], [4, 4])
    return matches(call(copy.deepcopy(o), copy.deepcopy(b)), o, b, reference(o, b)) and reference(o, b) == Counter({("O0", 1): 4, ("O1", 1): 4})


def split():
    o, b = mk([(10, "2026-03-01"), (6, "2026-01-01"), (7, "2026-02-01")], [20, 3])
    exp = reference(o, b)
    return exp == Counter({("O0", 1): 6, ("O0", 2): 7, ("O0", 0): 7, ("O1", 0): 3}) and matches(call(copy.deepcopy(o), copy.deepcopy(b)), o, b, exp)


def randoms():
    rng = random.Random(7)
    for _ in range(25):
        o, b = make_case(rng, rng.randint(1, 8), rng.randint(1, 8))
        if not matches(call(copy.deepcopy(o), copy.deepcopy(b)), o, b, reference(o, b)):
            out["notes"].append(f"random case differs: orders={[x['qty'] for x in o]} batches={[(x['qty'], x['expiry']) for x in b]}")
            return False
    return True


def shortfall():
    o, b = mk([(5, "2026-02-01"), (5, "2026-01-01")], [8, 8])
    exp = reference(o, b)
    return exp == Counter({("O0", 1): 5, ("O0", 0): 3, ("O1", 0): 2}) and matches(call(copy.deepcopy(o), copy.deepcopy(b)), o, b, exp)


def no_mutation():
    rng = random.Random(3)
    o, b = make_case(rng, 6, 6)
    o0, b0 = copy.deepcopy(o), copy.deepcopy(b)
    call(o, b)
    return o == o0 and b == b0


def scale():
    rng = random.Random(11)
    n = 30000
    base = datetime.date(2000, 1, 1)
    batches = []
    for i in range(n):
        iso = (base + datetime.timedelta(days=(i * 7919) % 40000)).isoformat()
        q = rng.randint(1, 20)
        batches.append({"id": f"B{i}", "batch_id": f"B{i}", "batch": f"B{i}", "warehouse": f"W{i % 50}", "warehouse_id": f"W{i % 50}", "sku": "S1",
                        "qty": q, "quantity": q, "expiry": iso, "expiry_date": iso, "expires": iso})
    orders = []
    for j in range(n):
        q = rng.randint(1, 20)
        orders.append({"id": f"O{j}", "order_id": f"O{j}", "orderId": f"O{j}", "sku": "S1", "qty": q, "quantity": q, "customer": f"C{j}"})
    import signal

    def too_slow(*a):
        raise TimeoutError("more than 12 s")
    signal.signal(signal.SIGALRM, too_slow)
    signal.alarm(12)
    t0 = time.perf_counter()
    try:
        r = call(orders, batches)
    finally:
        signal.alarm(0)
    dt = time.perf_counter() - t0
    out["notes"].append(f"scale: {dt:.2f}s")
    return isinstance(r, dict) and dt < 10


check("fifo_order", fifo_order)
check("split_across_batches", split)
check("random_cases", randoms)
check("stock_runs_out", shortfall)
check("inputs_untouched", no_mutation)
check("scales", scale)
out.pop("_basic", None)
emit()
