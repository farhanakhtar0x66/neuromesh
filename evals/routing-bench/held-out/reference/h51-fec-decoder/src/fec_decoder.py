"""Systematic Reed-Solomon erasure codec over GF(256), polynomial 0x11d: 6 data + 3 parity shards."""

DATA, PARITY, SIZE = 6, 3, 64
TOTAL = DATA + PARITY
POLY = 0x11D

EXP = [0] * 512
LOG = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= POLY
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def mul(a, b):
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def inv(a):
    if a == 0:
        raise ZeroDivisionError("0 has no inverse in GF(256)")
    return EXP[255 - LOG[a]]


def power(a, n):
    if n == 0:
        return 1
    return 0 if a == 0 else EXP[(LOG[a] * n) % 255]


def mat_mul(a, b):
    return [[_dot(row, [b[k][j] for k in range(len(b))]) for j in range(len(b[0]))] for row in a]


def _dot(u, v):
    s = 0
    for x, y in zip(u, v):
        s ^= mul(x, y)
    return s


def mat_inv(m):
    n = len(m)
    a = [row[:] + [1 if i == j else 0 for j in range(n)] for i, row in enumerate(m)]
    for col in range(n):
        pivot = next((r for r in range(col, n) if a[r][col]), None)
        if pivot is None:
            raise ValueError("singular matrix")
        a[col], a[pivot] = a[pivot], a[col]
        scale = inv(a[col][col])
        a[col] = [mul(scale, v) for v in a[col]]
        for r in range(n):
            if r != col and a[r][col]:
                f = a[r][col]
                a[r] = [v ^ mul(f, w) for v, w in zip(a[r], a[col])]
    return [row[n:] for row in a]


# Rows 0..8 of a Vandermonde matrix (row i is i^0 .. i^5), made systematic by the inverse of its top 6x6 block:
# the first six rows become the identity, the last three produce the parity shards. Any six rows stay invertible.
_VAND = [[power(i, j) for j in range(DATA)] for i in range(TOTAL)]
MATRIX = mat_mul(_VAND, mat_inv(_VAND[:DATA]))


def _apply(rows, shards):
    out = []
    for row in rows:
        buf = bytearray(SIZE)
        for coef, shard in zip(row, shards):
            if coef:
                lg = LOG[coef]
                for i, byte in enumerate(shard):
                    if byte:
                        buf[i] ^= EXP[lg + LOG[byte]]
        out.append(bytes(buf))
    return out


def encode(data_shards):
    if len(data_shards) != DATA or any(len(s) != SIZE for s in data_shards):
        raise ValueError(f"need {DATA} shards of {SIZE} bytes")
    return [bytes(s) for s in data_shards] + _apply(MATRIX[DATA:], data_shards)


def decode(shards):
    if len(shards) != TOTAL:
        raise ValueError(f"need {TOTAL} shard slots")
    have = [i for i, s in enumerate(shards) if s is not None][:DATA]
    if len(have) < DATA:
        raise ValueError("too many shards are missing")
    if have == list(range(DATA)):
        return [bytes(shards[i]) for i in range(DATA)]
    rows = mat_inv([MATRIX[i] for i in have])
    return _apply(rows, [shards[i] for i in have])
