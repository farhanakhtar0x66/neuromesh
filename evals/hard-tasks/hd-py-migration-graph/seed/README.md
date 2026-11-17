# migrator

A small migration tool for SQLite databases. Standard library only.

    python -m migrator --db app.db --dir migrations migrate
    python -m migrator --db app.db --dir migrations status

A migration is a Python file in the migrations directory. Its id is the file name
without `.py` (`0001_create_users`). The file defines `up(conn)` and, optionally,
`down(conn)`; both get the `sqlite3.Connection` and use `conn.execute(...)`.

`docs/MIGRATIONS.md` describes the behaviour of the tool, including the dependency
graph between migrations, `plan`, `rollback` and the run lock. It is the specification:
the code is meant to do what that file says.

## Layout

| file | what it does |
| --- | --- |
| `migrator/errors.py` | `MigrationError`, the one error the tool raises for a problem it reports |
| `migrator/db.py` | connecting, the `schema_migrations` history table |
| `migrator/loader.py` | reads the migration files into `Migration` objects |
| `migrator/runner.py` | `Migrator`: `migrate`, `status` (and the rest of the spec) |
| `migrator/cli.py` | the command line |
| `examples/migrations/` | three linear example migrations |

## Tests

    pytest
