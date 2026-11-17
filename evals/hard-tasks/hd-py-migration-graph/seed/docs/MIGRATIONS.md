# Migrations: behaviour

This file is the specification. Section 1 and the parts of section 2 not marked (new) describe
what the tool does today; everything marked (new) and sections 3 to 8 describe the behaviour it is
meant to have once migrations can depend on each other. Where a message is quoted, it is exact.

## 1. Migration files

- A migration is a `*.py` file in the migrations directory. Files whose name starts with
  `_` are ignored. The **id** is the file name without `.py`.
- The file defines `up(conn)` and optionally `down(conn)`. A file without a callable `up`
  is an error. `down` is only needed to roll the migration back.
- Ids are compared as plain strings (`"0003_a" < "0003_b" < "0010_x"`). "Ties by id" below
  means this order.
- Migrations use `conn.execute(...)`. They do not commit or roll back themselves, and do
  not use `executescript` (it commits).

## 2. History and the CLI today

- The history table is
  `schema_migrations (id TEXT PRIMARY KEY, applied_at REAL NOT NULL)`; `applied_at` is
  the value of the tool's clock (`time.time` by default) when the migration was applied.
  A history row for an id that has no file is ignored.
- `Migrator(db_path, migrations_dir, *, clock=time.time)` today; (new) `Migrator(db_path, migrations_dir, *, clock=time.time, lock_max_age=600.0, owner=None)`.
  - `migrate(to=None) -> list[str]`: applies migrations and returns the ids it applied, in order (`to` is new).
  - (new) `rollback(migration_id) -> list[str]`: reverts migrations and returns the ids it reverted, in order.
  - (new) `plan(to=None, rollback=None) -> str`: the plan text of section 6, without a trailing newline.
  - `status() -> list[tuple[str, bool]]`: every migration with whether it is applied (today in id order, (new) in the order of section 3).
- CLI: `python -m migrator [--db FILE] [--dir DIR] [--lock-max-age SECONDS (new)] COMMAND`.
  `main(argv, out=None, err=None) -> int`. Commands:
  - `migrate [--to ID (new)]` prints `applied <id>` for each migration it applies, or `nothing to apply`.
  - (new) `rollback ID` prints `reverted <id>` for each migration it reverts.
  - `status` prints one line per migration: `[x] <id>` if applied, `[ ] <id>` if not, or `no migrations`.
  - (new) `plan [--to ID | --rollback ID]` prints the plan of section 6.
  - A `MigrationError` is printed to `err` as `error: <message>`, the exit status is 1, and
    the database is left as the section describes. Success is 0.

## 3. The dependency graph

1. A migration file may define `DEPENDS_ON`, a list of ids it needs to run first. Duplicates
   in the list count once.
2. A migration that does **not** define `DEPENDS_ON` depends on the migration with the next
   lower id (the first migration depends on nothing). This keeps a directory of plain
   numbered files working as a chain. A migration that defines it, even as an empty list,
   depends on exactly the ids it lists.
3. **Order.** Migrations are ordered topologically: a migration comes after everything it
   depends on, and among the migrations that could come next the one with the smallest id
   goes first. This is the order used by `migrate`, `status` and `plan`, and `rollback`
   uses its reverse.
4. **Heads.** A head is a migration that no other migration depends on. A graph with more
   than one head has an unmerged branch. A *merge* migration is simply one whose
   `DEPENDS_ON` lists the heads it joins.

Example (the second and third are two branches off the first; the last merges them):

    0001_users          (no DEPENDS_ON: nothing before it)
    0002_posts          (no DEPENDS_ON: depends on 0001_users)
    0003_tags           DEPENDS_ON = ["0002_posts"]
    0003_flags          DEPENDS_ON = ["0002_posts"]
    0004_merge          DEPENDS_ON = ["0003_tags", "0003_flags"]

Order: `0001_users, 0002_posts, 0003_flags, 0003_tags, 0004_merge`.

## 4. Errors

Every command loads the graph first and fails on the first of these that applies, in this
order. All are `MigrationError`.

| problem | message |
| --- | --- |
| a dependency names an id that has no file | `migration <id> depends on missing migration <dep>` (the first by id of the migration that declares it, then the smallest missing id in its list) |
| the graph has a cycle (a migration may depend on itself) | `dependency cycle among: <ids>` where `<ids>` are all migrations that cannot be ordered because of a cycle, the ones on a cycle and the ones that depend on them, sorted by id, separated by `, ` |
| `migrate` without `--to`, or `plan` without `--to` or `--rollback`, finds more than one head | `multiple heads: <ids> (add a migration that depends on all of them)`, the heads sorted by id, separated by `, ` |
| a `--to` or rollback target that has no file | `unknown migration: <id>` |

`migrate --to`, `rollback`, `status` and `plan --to`/`--rollback` do not check the heads. After these checks
(and, for `migrate` and `rollback`, after the lock of section 7 is taken) come the checks of
sections 5 and 6 that need the history.

## 5. migrate and rollback

- **`migrate`** applies every migration that is not in the history, in the order of section 3.
- **`migrate --to ID`** applies `ID` and the migrations it depends on, directly or not, that are
  not yet applied, in the order of section 3, and nothing else. If `ID` is already applied, nothing
  happens (it is not an error and nothing is reverted).
- **`rollback ID`** reverts `ID` and every *applied* migration that depends on it, directly or
  not, in the reverse of the order of section 3. If `ID` is not applied the error is
  `migration <id> is not applied`. Before anything is reverted, every migration to revert must
  have a `down`; the first one without it, in revert order, is `migration <id> has no down()`
  and nothing is reverted.
- Reverting a migration calls its `down(conn)` and deletes its history row.

## 6. plan

`plan` shows what `migrate` (with the same `--to`) or `rollback` would do, and changes nothing:
it never writes to the database, not even to create the history table, and it does not look at
the lock. The format is one line per migration and a closing line:

    apply 0003_flags
    apply 0004_merge
    2 to apply

`plan --rollback ID` uses `revert <id>` lines and ends with `<n> to revert`. When `migrate` would do
nothing the whole plan is the single line `nothing to apply`. `plan --rollback` of a migration that is
not applied is the error of section 5.

## 7. The lock

`migrate` and `rollback` (not `status` or `plan`) hold a lock for their whole run, taken
before they apply or revert anything, even when it turns out there is nothing to do, and
released when they end, whether they succeeded or failed.

- The lock is one row in `migration_lock`, created if it does not exist:

      CREATE TABLE IF NOT EXISTS migration_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          owner TEXT NOT NULL,
          acquired_at REAL NOT NULL
      )

  `owner` is the `owner` given to `Migrator` (any text that tells runs apart by default) and
  `acquired_at` is the clock's value when the lock was taken.
- If the row exists and its age (`clock() - acquired_at`) is at most `lock_max_age` seconds,
  another run holds it: the run fails with
  `migration lock is held by <owner> (taken <n> seconds ago)`, `<n>` being the age in whole seconds
  (rounded down), and changes nothing, including the row.
- If the row exists and its age is more than `lock_max_age`, the run that left it is taken to have
  died: the new run takes it over (the row now holds the new owner and time).
- Releasing deletes the row if it still belongs to this run.

## 8. Transactions

- Each migration is applied in its own transaction, and the history row is inserted in that same
  transaction. If `up` raises, or any statement of it fails, or the insert fails, nothing of that
  migration remains (no table, no row, no history row), the migrations applied before it stay
  applied, the later ones are not tried, and the run fails with
  `migration <id> failed: <message of the error>`.
- Reverting is the same: `down` and the deletion of the history row are one transaction, and a
  failure is `migration <id> failed: <message>`, leaving that migration applied and those reverted
  before it reverted.
- The lock is released after a failure too.
