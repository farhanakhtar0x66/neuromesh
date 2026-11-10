Create `kvstore.py`, a small persistent key-value store.

- A class `KVStore(path)` that loads the JSON file at `path` if it exists. Methods: `get(key, default=None)`, `set(key, value)`, `delete(key)` (returns True if the key existed, otherwise False), and `keys()` (sorted list). Every change is saved to the file straight away, written so a crash cannot leave a half-written file (write a temporary file and rename it).
- A command line: `python3 kvstore.py <file> set <key> <value>`, `get <key>`, `delete <key>`, `keys`. `get` prints the value; a missing key prints `not found: <key>` to stderr and exits with 1. `keys` prints one key per line. `delete` of a missing key also exits with 1. Bad usage exits with 2.

Use only the standard library and add tests.
