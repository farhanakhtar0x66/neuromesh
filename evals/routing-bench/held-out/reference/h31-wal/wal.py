import os
import struct
import zlib
from pathlib import Path

_HEADER = struct.Struct("<II")  # payload length, crc32 of the payload
BEGIN, PUT, DELETE, COMMIT, ABORT = 1, 2, 3, 4, 5
_MAX_PAYLOAD = 1 << 30


def _frame(kind, tx, body=b""):
    payload = struct.pack("<BQ", kind, tx) + body
    return _HEADER.pack(len(payload), zlib.crc32(payload) & 0xFFFFFFFF) + payload


def _parse(data, off):
    """One frame at `off`: (kind, tx, key, val, end), or None if it is torn, corrupt or not a frame."""
    if off + _HEADER.size > len(data):
        return None
    length, crc = _HEADER.unpack_from(data, off)
    start = off + _HEADER.size
    if length < 9 or length > _MAX_PAYLOAD or start + length > len(data):
        return None
    payload = data[start:start + length]
    if zlib.crc32(payload) & 0xFFFFFFFF != crc:
        return None
    kind, tx = struct.unpack_from("<BQ", payload)
    body = payload[9:]
    key = val = None
    if kind == PUT:
        if len(body) < 8:
            return None
        klen, vlen = struct.unpack_from("<II", body)
        if len(body) != 8 + klen + vlen:
            return None
        key, val = body[8:8 + klen], body[8 + klen:]
    elif kind == DELETE:
        if len(body) < 4:
            return None
        (klen,) = struct.unpack_from("<I", body)
        if len(body) != 4 + klen:
            return None
        key = body[4:]
    elif kind in (BEGIN, COMMIT, ABORT):
        if body:
            return None
    else:
        return None
    return kind, tx, key, val, start + length


class WAL:
    def __init__(self, path):
        self.path = Path(path)
        self.path.touch(exist_ok=True)
        self._next = 1
        data = self.path.read_bytes()
        off = 0
        while (fr := _parse(data, off)) is not None:
            self._next = max(self._next, fr[1] + 1)
            off = fr[4]
        self._f = open(self.path, "ab")

    def _write(self, blob):
        self._f.write(blob)

    def _sync(self):
        self._f.flush()
        os.fsync(self._f.fileno())

    def begin(self):
        tx = self._next
        self._next += 1
        self._write(_frame(BEGIN, tx))
        return tx

    def put(self, tx_id, key, val):
        self._write(_frame(PUT, tx_id, struct.pack("<II", len(key), len(val)) + key + val))

    def delete(self, tx_id, key):
        self._write(_frame(DELETE, tx_id, struct.pack("<I", len(key)) + key))

    def commit(self, tx_id):
        self._write(_frame(COMMIT, tx_id))
        self._sync()

    def abort(self, tx_id):
        self._write(_frame(ABORT, tx_id))
        self._f.flush()

    def recover(self):
        self._f.flush()
        data = self.path.read_bytes()
        frames, off = [], 0
        while (fr := _parse(data, off)) is not None:
            frames.append(fr)
            off = fr[4]
        if off < len(data):
            # Something is wrong at `off`. A valid commit after it means committed data is damaged.
            for later in range(off + 1, len(data) - _HEADER.size):
                fr = _parse(data, later)
                if fr is not None and fr[0] == COMMIT:
                    raise ValueError("Corrupted committed log segment")
            with open(self.path, "r+b") as f:
                f.truncate(off)
            self._f.close()
            self._f = open(self.path, "ab")
        pending, state = {}, {}
        for kind, tx, key, val, _ in frames:
            if kind == BEGIN:
                pending[tx] = []
            elif kind in (PUT, DELETE):
                pending.setdefault(tx, []).append((kind, key, val))
            elif kind == ABORT:
                pending.pop(tx, None)
            elif kind == COMMIT:
                for op, k, v in pending.pop(tx, []):
                    if op == PUT:
                        state[k] = v
                    else:
                        state.pop(k, None)
        return state
