"""Reading logs: files or standard input, one line at a time."""

from __future__ import annotations

import io
import sys
from typing import Iterator


def iter_file(path: str) -> Iterator[str]:
    """The lines of a file, decoded as UTF-8 (bad bytes become U+FFFD), read lazily."""
    with open(path, encoding="utf-8", errors="replace", newline="\n") as fh:
        yield from fh


def iter_stdin() -> Iterator[str]:
    """The lines of standard input, decoded the same way."""
    raw = getattr(sys.stdin, "buffer", None)
    if raw is None:  # a text-only stand-in
        yield from sys.stdin
        return
    wrapper = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="\n")
    try:
        yield from wrapper
    finally:
        wrapper.detach()  # leave sys.stdin's buffer open


def read_lines(path: str) -> list[str]:
    """Every line of the file (kept for callers that want a list)."""
    return list(iter_file(path))
