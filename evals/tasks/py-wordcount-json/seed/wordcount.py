"""Count lines, words and characters in a text file."""
import argparse
import sys


def count(text):
    return {
        "lines": len(text.splitlines()),
        "words": len(text.split()),
        "chars": len(text),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Count lines, words and characters.")
    parser.add_argument("path", help="file to count")
    args = parser.parse_args(argv)
    with open(args.path, encoding="utf-8") as handle:
        result = count(handle.read())
    print(f"{result['lines']} lines, {result['words']} words, {result['chars']} chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
