we have a postgres table with 80 million rows in production and we need to split the 'full_address' text column into structured street, city, state, pincode columns without locking reads/writes or breaking the old microservice version during rolling deploy. give me the exact multi-phase SQL + application rollout steps

Write the SQL and rollout steps to ANSWER.md (the SQL may also go in migration.sql).
