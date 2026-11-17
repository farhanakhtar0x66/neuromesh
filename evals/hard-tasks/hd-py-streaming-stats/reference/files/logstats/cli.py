"""python -m logstats [FILE ...]   (no FILE, or `-`, reads standard input)"""

from __future__ import annotations

import argparse
import sys

from .analysis import Analyzer
from .reader import iter_file, iter_stdin
from .render import render


def main(argv: list[str] | None = None, stdout=None, stderr=None) -> int:
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="logstats")
    parser.add_argument("files", nargs="*", metavar="FILE", help="access logs, read as one stream; none or - is standard input")
    args = parser.parse_args(argv)
    analyzer = Analyzer()
    current = "-"
    try:
        for current in args.files or ["-"]:
            for line in iter_stdin() if current == "-" else iter_file(current):
                analyzer.feed(line)
    except OSError as exc:
        print(f"logstats: cannot open {current}: {exc.strerror}", file=stderr)
        return 2
    stdout.write(render(analyzer.result()))
    return 0
