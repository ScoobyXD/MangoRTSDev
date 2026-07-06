# MangoRTS database and agent access contract

Last updated: 2026-07-06.

This contract exists because human database access and AI-agent access must be physically separated. Do not rely on an agent promise such as "I will not write." The AWS, database, DBeaver, and app-permission setup must make unauthorized writes impossible.

## Core rule

Humans may have production database write/admin access through human-only tools and credentials.

Hermes, Codex, Claude, OpenCode, CI agents, and other AI or automation agents must not have direct database write access.

The only acceptable agent write path is the MangoRTS application API, using a real MangoRTS account with explicit product permissions. Even then, the account must be scoped to the tenant/resources granted to it and should not have delete/destructive permissions unless explicitly approved for a task.

## Allowed human access

Jonat may use DBeaver, AWS Console, or a human-owned terminal with writer/admin credentials.

Human-only production DBeaver may use:

```text
Host: localhost through a private tunnel, or another human-approved private access path
Database: mangorts
Username: mangorts_app or another owner/admin DB role
Password: human-retrieved from AWS Secrets Manager or password manager
SSL mode: require
```

Do not make this connection available to agents. If DBeaver saves a writer password in the same Windows profile/session that an agent can operate, that is not a hard boundary.

## Forbidden agent capabilities

Agents must not be able to do any of the following:

- Retrieve production DB writer passwords or password-bearing connection strings.
- Use the production DB writer username/password.
- Use DBeaver saved writer connections.
- Run `psql`, migration tools, schema apply tools, or ad-hoc SQL against prod with a writer/admin credential.
- Run one-off ECS/Fargate tasks that inherit the backend app's writer DB secret.
- Register ECS task definitions intended to touch the database with writer credentials.
- Update ECS services, task definitions, Secrets Manager secrets, RDS, Route 53, Cognito, Nylas, or other prod resources unless a separate human admin explicitly performs the action or creates a one-time controlled exception.
- Read raw prod secret values, including DB passwords, Nylas API keys, webhook secrets, origin verification secrets, AWS session tokens, GitHub tokens, or full connection strings.
- Use `terraform apply` or any equivalent prod cloud mutation path.

## Required physical enforcement

A future agent AWS identity must be separate from Jonat's human admin identity.

Recommended profile name:

```text
mangorts-prod-agent-readonly
```

This profile must not be a prod administrator. It must have explicit denies or no permissions for:

```text
secretsmanager:GetSecretValue on prod writer DB secrets
secretsmanager:GetSecretValue on prod provider/API secrets unless explicitly read-only and task-scoped
ecs:RunTask
ecs:RegisterTaskDefinition
ecs:UpdateService
iam:PassRole
rds:Create*
rds:Modify*
rds:Delete*
rds-data:ExecuteStatement
cloudformation:* write actions
route53:* write actions
cognito-idp:Admin* write actions
terraform/apply-capable access
```

It may be allowed limited read-only inspection such as:

```text
sts:GetCallerIdentity
rds:Describe*
ecs:Describe*
logs:GetLogEvents
cloudwatch:Get*
cloudwatch:List*
```

Only add `secretsmanager:GetSecretValue` for an agent if the target secret is a read-only credential, for example `mangorts/prod/db-readonly-password`, and the user has explicitly approved that agent read access.

## Database roles

Production should have separate roles:

```text
mangorts_app       -- backend app writer role; never expose to agents
mangorts_readonly  -- read-only browsing/agent role; SELECT only
```

The read-only role should have:

```text
CONNECT on database mangorts
USAGE on schema public
SELECT on all current tables and sequences
SELECT on future tables and sequences by default privileges
default_transaction_read_only = on
```

It must not have:

```text
INSERT
UPDATE
DELETE
TRUNCATE
CREATE
ALTER
DROP
superuser
createdb
createrole
replication
bypassrls
```

## DBeaver rules

DBeaver writer connections are for humans only.

If an agent can control the same desktop session or read the same OS profile where DBeaver stores writer credentials, then a saved writer DBeaver connection is not agent-safe.

Safe options:

1. Do not save writer/admin DB passwords in a Hermes-accessible DBeaver profile.
2. Use a separate Windows user/profile for human-only DBeaver writer access.
3. Use manual password entry from a human password manager for writer sessions.
4. Save only read-only DBeaver credentials in the Hermes-accessible profile.

## Dev database public access

The current dev DB has a public RDS endpoint. Public does not automatically mean open to everyone; the security group may still restrict who can connect. However, public RDS is higher exposure than private RDS.

Acceptable temporary dev posture:

- Security group inbound PostgreSQL is restricted to Jonat's current IP or a narrow trusted range.
- SSL is required.
- Password is long and randomly generated.
- Non-human/agent credentials are read-only.
- No production data is stored in dev.
- Dev writer password is not saved in agent-accessible tools.

Preferred future dev posture:

- Move dev DB to private access through SSM/VPN/tunnel, or
- keep it public only with a tightly scoped IP allow-list and rotate passwords after broad setup work.

## Current immediate verification requirement

Before any session performs AWS or DB work, run:

```bash
python scripts/verify_agent_db_access_boundary.py
```

A safe default agent session should show no active admin AWS identity for `mangorts-prod` or `mangorts-dev`, no static AWS access keys in environment variables, and no AWS profile set to a human admin profile.

If the verifier reports active admin access, stop. Do not continue DB or prod cloud work from that agent session.

## What verification does and does not prove

The verifier proves the current shell/session does not currently have obvious AWS admin/profile access.

It does not prove:

- DBeaver writer credentials are not saved in the Windows profile.
- AWS IAM Identity Center has a proper read-only agent permission set.
- Secrets Manager resource policies deny writer secret reads.
- A human will not later log the agent into an admin profile.

Those require AWS/IAM/DBeaver configuration changes, not documentation.

## Setup checklist to make the boundary real

- [ ] Create a separate AWS SSO permission set/profile for agents, such as `mangorts-prod-agent-readonly`.
- [ ] Remove or avoid human-admin AWS profiles in Hermes/agent sessions.
- [ ] Deny the agent profile access to prod writer DB secrets and prod cloud mutation actions.
- [ ] Create `mangorts_readonly` in prod and store only its password in a separate read-only secret.
- [ ] Save only read-only DB credentials in Hermes-accessible DBeaver profiles.
- [ ] Keep human writer DBeaver credentials in a human-only profile or enter them manually.
- [ ] Verify with `scripts/verify_agent_db_access_boundary.py` before any agent cloud/database work.
