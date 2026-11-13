import heapq
from collections import defaultdict


def allocate(orders, batches):
    heap = [(b["expiry_date"], b["warehouse_id"], i) for i, b in enumerate(batches)]
    heapq.heapify(heap)
    left = {i: b["qty"] for i, b in enumerate(batches)}
    result = defaultdict(list)
    for order in orders:
        need = order["qty"]
        while need > 0 and heap:
            expiry, warehouse, i = heap[0]
            take = min(need, left[i])
            result[order["id"]].append({"warehouse": warehouse, "qty": take, "expiry_date": expiry})
            need -= take
            left[i] -= take
            if left[i] == 0:
                heapq.heappop(heap)
    return dict(result)
