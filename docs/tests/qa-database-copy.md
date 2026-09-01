# QA Database Copy Laws

1. QDC1 - The one-time QA copy reads Dev only through the injected database-enforced read-only PostgreSQL login and never writes to Dev or production.
2. QDC2 - Only a human operator may launch the task that receives the QA writer credential.
3. QDC3 - One manual run creates one full custom-format `pg_dump` of the Dev database without filtering, sanitizing, rewriting, or schema bootstrapping.
4. QDC4 - The run creates one fresh UTC-timestamped `mangorts_qa_copy_<timestamp>` database on the QA PostgreSQL instance from `template0`.
5. QDC5 - The stable `mangorts_qa` database is never opened, changed, renamed, dropped, or replaced by this phase.
6. QDC6 - The full archive is restored into the fresh database with `--single-transaction`, `--exit-on-error`, `--no-owner`, and `--no-privileges`.
7. QDC7 - Dev schema objects, migration rows, identities, provider state, attachments, relationships, and business data are copied unchanged; only ownership and grant commands are omitted by the required `--no-owner` and `--no-privileges` restore flags.
8. QDC8 - A failed run never drops an existing database or automatically removes the newly created database.
9. QDC9 - A successful run prints the exact fresh restored database name and exits once.
10. QDC10 - This phase performs no verification, hashing, schema comparison, migration comparison, cutover, rollback, smoke check, application start, schedule, service, or replication.
11. QDC11 - The fresh database remains inactive and unverified until a separate approved phase implements verification and cutover.

## Process Story

A human starts the one-time copy with the Dev read-only and QA writer connection values already injected. The task dumps Dev once, creates one fresh timestamped QA database, restores the complete archive in one transaction, prints that database name, and stops. The active QA database remains untouched.
