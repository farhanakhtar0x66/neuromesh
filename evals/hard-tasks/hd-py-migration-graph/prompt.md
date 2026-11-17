# Migrations should declare what they depend on (and we need rollback, a plan, and a lock)

The migration tool has numbered, strictly linear migrations. We now have several people adding migrations on
branches, and two `0007_...` files that were written independently collide every other week. We have also been
bitten by a migration that failed half way and left a table behind, and by two deploys running `migrate` at the
same time against the same database file.

I wrote down the behaviour I want in `docs/MIGRATIONS.md`. Sections 1 and the existing part of 2 are what the tool
does today; the rest is new: migrations that declare `DEPENDS_ON` (and a deterministic order, with merge
migrations for branches), `migrate --to`, `rollback`, a `plan` command, a lock so two runs cannot overlap, and one
transaction per migration. Please implement it. The existing numbered-file directories have to keep working
exactly as they do now.
