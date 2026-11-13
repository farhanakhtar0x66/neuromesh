i have a nasty 4-level nested loop in python that matches customer orders against warehouse inventory batches by expiry date (FIFO) and splits partial shipments across warehouses. refactor it into clean O(N log N) logic using heapq or bisect without changing the return dict structure

Write the refactored Python to allocate.py (an explanation may go in ANSWER.md).
