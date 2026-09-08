# MangoRTS database and agent access contract

Last updated: 2026-07-15.

## The rule

Agents may read MangoRTS databases. Agents must not write to MangoRTS databases or access unrelated sensitive secrets.

The narrowly authorized QA release exception is the reviewed `Deploy MangoRTS QA` workflow: approval of its exact main commit includes running that commit's pending migrations through the existing QA ECS migration task and its coordinated recovery path. An agent may dispatch and monitor that approved workflow. ECS obtains the migration credential inside AWS; the agent must never receive it. This exception permits no direct SQL, schema bootstrap, reset, reseed, database copy, DEV or production deployment, or unrelated data changes. See [QA release and recovery](../infra/qa-release-recovery.md). All ordinary agent database inspection still requires a database-enforced read-only login.

Database read access must use a designated database-enforced read-only credential. The safety boundary comes from that database user''s permissions, not from asking an agent to avoid writes while giving it a writer credential.

An agent-specific AWS profile is not required for ordinary read-only database access.

## Allowed

Using the designated read-only database credential, agents may:

- Run `SELECT` queries.
- Inspect schemas, tables, columns, indexes, constraints, and query plans that do not execute a write.
- Read dev or production data needed to investigate, verify, debug, or report on MangoRTS behavior.
- Use the minimum connection credential needed for that read-only access. Treat it as confidential and do not print it in logs, responses, or committed files.
- Edit schema definitions and migration files in the repository. Editing code is not a live database write.

## Forbidden

Agents must not:

- Use a database owner, writer, admin, superuser, migration, or backend application credential.
- Run `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, `DROP`, schema-apply commands, migrations, or any other statement that changes live database state.
- Apply repository schema or migration changes to a local, dev, or production database from an agent session.
- Retrieve or expose writer passwords, backend application connection strings, provider API keys, origin-verification secrets, AWS session tokens, GitHub tokens, or other secrets unrelated to the designated read-only connection.
- Use a writable DBeaver connection or another saved writer connection.

## Minimal database setup

The only special access an agent needs is a read-only database login, for example:

```text
mangorts_readonly
```

That login must be restricted by PostgreSQL to `CONNECT`, schema `USAGE`, and `SELECT` on the data it is allowed to inspect. It must not have write, DDL, ownership, role-management, database-creation, replication, superuser, or row-security-bypass privileges.

If no such login exists yet, a human administrator must create it once. Do not temporarily give an agent the writer credential just so it can perform reads.

The read-only connection can be provided directly or through a tunnel. If its credential is stored in a secret manager, access should be limited to that one designated read-only credential; agents do not need general secret-listing or writer-secret access.

## AWS boundary accountable

`scripts/verify_agent_db_access_boundary.py` checks whether an AWS-integrated workflow can see active human/admin AWS profiles or static AWS credentials. It does not connect to PostgreSQL, validate database grants, or provide database access.

It is not required before ordinary read-only database queries. Run it only when a specific AWS/cloud-integrated workflow explicitly requires that additional AWS safety check.

## Practical test

The designated agent login should be able to run a representative `SELECT` and should be rejected by PostgreSQL if it attempts `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, or `DROP`.
