# MangoRTS QA Database Copy Runbook

This runbook describes only the current first layer of the Dev-to-QA database copy. The eventual verification and cutover plan remains in `docs/important tasks/v3qacopy.md`.

## Current boundary

The repository currently contains one small container entrypoint that can:

1. Read the Dev Aurora PostgreSQL database through an injected read-only username and password.
2. Write one complete custom-format Dev dump to private task storage.
3. Create one fresh UTC-timestamped database on the existing QA PostgreSQL instance.
4. Restore the complete dump into that fresh database in one transaction.
5. Print the fresh restored database name and exit.

The current phase does not provide an AWS launcher. The entrypoint does not create or restore secrets, register or run an ECS task, snapshot QA, stop services, build or push an image, or start applications. Existing image-build wiring is separate and was not run as part of this phase.

## Required injected values

The one-time task requires these environment values to be injected before it starts:

- `DEV_DB_HOST`
- `DEV_DB_PORT`
- `DEV_DB_NAME`
- `DEV_DB_USER`
- `DEV_DB_PASSWORD`
- `QA_DB_HOST`
- `QA_DB_PORT`
- `QA_DB_USER`
- `QA_DB_PASSWORD`

The Dev username and password must belong to the existing database-enforced read-only login. The QA values must point to the existing QA RDS PostgreSQL instance. Credentials must remain in the approved secret-injection boundary and must not be printed or stored in repository files.

## Exact copy behavior

`scripts/qa_fargate_copy_entrypoint.sh` performs these commands once and in this order:

1. `pg_dump` reads the complete Dev database into a custom-format archive. It applies no table, schema, row, data-only, or other content filter.
2. `createdb` creates `mangorts_qa_copy_<UTC timestamp>` from `template0` on the QA instance.
3. `pg_restore` restores the complete archive with `--single-transaction`, `--exit-on-error`, `--no-owner`, and `--no-privileges`.
4. The task prints `QA_COPY_RESTORED_DATABASE=<database name>` and exits.

The task removes only its local dump file on exit. It never drops a database. If creation succeeds but restore fails, the fresh database is left for a human to identify and handle deliberately.

## Hard stop after restore

The restored database is inactive and unverified. Do not rename it, connect an application to it, or treat it as ready QA state.

This phase has no sanitizer, identity rewrite, attachment omission, schema bootstrap, migration-ledger comparison, row or large-object hashing, parity verification, database-settings copy, cutover, rollback, smoke check, or automatic recovery. The restored objects and data are unchanged except that the required restore flags omit Dev ownership and grants. The stable `mangorts_qa` database remains untouched.

Stop here. `docs/important tasks/v3qacopy.md` remains the planning-only eventual sequence; do not follow its later verification or cutover steps until those steps are separately implemented and approved.
