in `wal.py` (pure Python 3 stdlib), implement `class WAL`:
- `__init__(self, path: str | Path)`
- `begin(self) -> int` (returns unique monotonically increasing integer `tx_id >= 1`)
- `put(self, tx_id: int, key: bytes, val: bytes) -> None`
- `delete(self, tx_id: int, key: bytes) -> None`
- `commit(self, tx_id: int) -> None` (flushes to disk)
- `abort(self, tx_id: int) -> None`
- `recover(self) -> dict[bytes, bytes]`
Every frame written to disk must be protected by `zlib.crc32`.
`recover()` must:
1. Replay only transactions that have a valid `commit` record, in the exact order their `commit` records appear in the log.
2. Ignore operations from uncommitted or aborted transactions.
3. If the end of the file after the last valid record (or after the last valid `commit`) contains a torn/truncated frame or a CRC mismatch caused by a crash mid-write of an uncommitted tail, truncate the file back to the end of the last valid frame and return the recovered committed state without raising.
4. If a corrupted frame (bad CRC or invalid header) occurs BEFORE a later valid `commit` frame in the file, raise `ValueError("Corrupted committed log segment")` and do not truncate it.
