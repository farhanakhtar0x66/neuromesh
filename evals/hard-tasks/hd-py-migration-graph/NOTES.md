# hd-py-migration-graph (feature, Python): notes for the advisor, never shown to a model

## What the task is

`migrator/`: a SQLite migration tool with numbered, linear migrations (`migrate`, `status`). `docs/MIGRATIONS.md` is the
specification of the new behaviour (the prompt points at it; parts marked "(new)" are the work): migrations that declare
`DEPENDS_ON`, deterministic topological order, heads and merge migrations, `migrate --to`, `rollback`, `plan` with an exact
text format, a lock table with stale takeover, one transaction per migration with the history row inside it, and the
exact error messages. All hidden assertions are a sentence of that file (or the seed's behaviour: the existing linear
directories, the `applied`/`[x]` output, history rows without a file ignored).

## The traps (each a separate place to be wrong)

1. **Implicit dependency.** A file without `DEPENDS_ON` depends on the next lower id; an empty list means nothing. Getting
   it as "no declaration = no dependencies" makes every old directory a pile of heads.
2. **Order.** Smallest-id-first among the ready ones (not DFS order, not id order). `0001_a` can depend on `0003_c`.
3. **Rollback order** is the reverse of the *apply* order restricted to the affected set, not id-descending
   (`test_rollback_order_is_the_reverse_...`), and only *applied* dependents are touched.
4. **Heads** are checked by `migrate` and `plan` without a target only; not by `--to`, `rollback`, `status`.
5. **Cycle message** lists everything that cannot be ordered (the cycle plus what hangs off it), sorted.
6. **The sqlite3 transaction trap.** The `sqlite3` module (default isolation) opens a transaction only before DML, so a
   migration's `CREATE TABLE` is autocommitted and survives a later failure. The seed's visible test "a failing data
   migration is not recorded" passes on the seed because its statement is an INSERT; the hidden half-way tests create tables
   and triggers, so they fail on the seed. The fix is `isolation_level=None` and explicit `BEGIN`/`COMMIT`/`ROLLBACK`.
   `executescript` would break it, which the spec tells migrations not to use.
7. **History row in the same transaction.** Tested with a `BEFORE INSERT` trigger on `schema_migrations` that aborts: nothing
   of the migration may remain (including the trigger). Same for `DELETE` on rollback.
8. **Lock.** Strict "more than" at the age limit (`test_the_lock_age_limit_is_exclusive` has age 600.0 held, 600.5 taken
   over), taken before anything even when there is nothing to do, released after a failure, release does not delete a row
   another run took, `plan`/`status` ignore it. The lock row is visible to a migration while it runs
   (`CREATE TABLE seen AS SELECT ... FROM migration_lock` inside `up`).
9. **`plan` writes nothing**, not even the history table.

## Why a small model should fail

Nine separate behaviours; fixing the common path (order, migrate, rollback) passes about half of the hidden tests.
The transaction and lock tests only fail for a model that actually reads section 7 and 8, and the sqlite3 autocommit
behaviour is not something the visible tests ever show. The first thing a small model does is `conn.commit()` after `up()`,
which is the seed's behaviour.

## Oracle

`hidden/tests/tests/test_hidden_graph.py` (39 tests):
- `o_graph` etc. are an independent implementation (repeated scan for the smallest ready id, closure by repeated passes), not
  the heap the reference uses.
- `test_random_graphs_order_status_plan_and_errors`: 300 seeded graphs (`random.Random(20261117)`), 2 to 9 migrations with random
  ids, random dependencies pointing at a lower rank (so some graphs have order unlike id order), some without declaration,
  occasionally a missing dependency or a cycle. Every outcome is compared: the order from `status`, the `plan` text, the exact
  heads/missing/cycle message. The test asserts it saw at least 5 of each of the four kinds.
- `test_random_runs_apply_and_revert_like_the_oracle`: 150 seeded graphs (seed 7): `migrate --to` a random target, the rest (or a
  second target when there are two heads; sometimes a merge migration is added), then `rollback` of a random applied migration.
  After each step the set of real tables and the history rows equal the oracle's, and the lock row is gone.
- Named tests are the spec's examples (the five-file example of section 3 and its plan text), the error table, each lock and
  transaction rule.

## Decisions I had to make (the design left them open)

- File layout: a migration is a `.py` file with `up`, optional `down`, optional `DEPENDS_ON` (module constant).
- The implicit-dependency rule above (so existing linear directories keep working) and "a head is a migration nothing depends on".
- All message texts, the `plan` format (`apply X` / `revert X` plus `N to apply`, or `nothing to apply`), the lock table DDL,
  `Migrator(...)` keyword arguments and the CLI options (`--to`, `--rollback`, `--lock-max-age`), all in `docs/MIGRATIONS.md`.
- Order of checks: graph errors (missing, then cycle), heads where they apply, unknown target, then the lock, then the checks that
  need the history (not applied, no `down`).
- The seed already wraps a failing migration in `MigrationError("migration <id> failed: ...")`, so the spec's message is existing
  behaviour (the visible test relies on it).
- Four hidden tests pass on the seed (doc example happens to be in id order, duplicate dependencies, history rows without a file,
  "lock released after failure" is trivially true without a lock): they are pass-to-pass guards.

## Mutation check (by hand, offline)

Each of these mistakes put into the reference is caught: rollback in id-descending order (2 tests), stale lock at `>=` (1),
history insert after the commit (1: the trigger test), `migrate --to` also checking heads (many), `plan` creating the tables (1),
cycle message naming only the first stuck migration (2). (A mutant that only restores the default isolation in `connect` is not
caught, because the reference also issues explicit `BEGIN`; the seed itself is the transaction-trap check, and 35 hidden tests fail on it.)

## Size and time

Seed 165 lines of code plus 12 visible tests, `docs/MIGRATIONS.md` and README (510 lines in all); reference 210 changed lines
(385 lines in the five files it ships). The hidden file takes about 4 to 7 s on the reference (the two property tests write a
few hundred small migration directories); no time limit is used.
