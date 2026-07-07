# MangoRTS prod launch — next-agent handoff prompt

Copy/paste this prompt into the next Hermes/Codex/AI-agent session.

---

You are continuing MangoRTS production launch work in `C:/Users/Jonat/MangoRTSDev` on Windows.

Before doing anything else:

1. Read root `AGENTS.md`.
2. Read `docs/security/database-agent-access-contract.md`.
3. Run:

```bash
python scripts/verify_agent_db_access_boundary.py
```

If the verifier reports an active `mangorts-prod` or `mangorts-dev` admin profile, static AWS keys, or another write-enabling path, stop and ask Jonat to switch the session to the physically read-only agent profile. Do not use admin AWS access from an agent session.

Hard rule: database access boundaries are physical, not trust-based. Hermes/Codex/agents must not have direct DB write access, must not retrieve DB writer passwords, and must not run ECS task/migration/schema-apply paths that inherit writer DB credentials. Agents may write only through the MangoRTS app API using a real MangoRTS account with explicit product permissions; broad delete/destructive permissions are not allowed by default.

Current agent-boundary files:

- `AGENTS.md` — root agent rule list.
- `docs/security/database-agent-access-contract.md` — durable DB/agent access policy and setup checklist.
- `scripts/verify_agent_db_access_boundary.py` — local verifier for active admin AWS sessions/static keys.
- `docs/security/aws-prod-agent-readonly-permission-set-policy.template.json` — intended IAM Identity Center inline policy for `mangorts-prod-agent-readonly`; denies all Secrets Manager access and DB/cloud mutation paths.

Current verified boundary state as of 2026-07-07T00:02:51Z:

- Current Hermes session had no active `mangorts-prod` or `mangorts-dev` SSO token.
- Current Hermes session had no static AWS env credentials.
- `mangorts-prod-agent-readonly` profile was not created/configured yet.
- `infra/aws-prod/terraform.tfvars` and `infra/aws-dev/terraform.tfvars` still exist inside the workspace and should be treated as human-only sensitive local config. Do not read them from an agent session unless Jonat explicitly approves.

Current production launch state:

- First prod admin bootstrap is complete. Jonat logged into `https://mangorts.com`, saw `180 Snacks`, and confirmed dev-admin access.
- Bootstrap allow-list cleanup was applied; ECS backend is stable on `mangorts-prod-backend:3` and `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` is empty.
- Origin verification secret was rotated after a local terminal exposure caveat; CloudFront and ALB header verification matched and smoke checks passed.
- Prod DB schema-only apply is complete. It was run once through a one-off ECS/Fargate task using a DDL-only schema derived from `backend/db/schema.sql`, with top-level row backfills/cleanup omitted. Dry-run and apply tasks exited 0, `rows_unchanged=true`, and smoke checks passed. No dev rows, users, companies, nodes, logic gates, work rows, or dev company UUIDs were copied.
- Nylas prod prep is partial only. `mangorts/prod/nylas-state-secret` exists and local gitignored tfvars references it. Real Nylas client/application ID, API key secret, and webhook secret are still needed before enabling Nylas in ECS.
- Prod DB is private. Jonat's local DBeaver cannot connect directly to the prod RDS endpoint. Human DBeaver writer/admin access should go through a private tunnel, typically `localhost:15432 -> SSM/VPN/tunnel -> prod RDS:5432`. Do not make prod RDS public just for DBeaver.
- Dev DB currently has a public RDS endpoint. Public does not automatically mean open to everyone, but the security group must be restricted to Jonat's IP/narrow ranges; broad `0.0.0.0/0` on PostgreSQL would be unsafe.

Important docs to read:

- `docs/important tasks/prod launch progress log.md`
- `docs/important tasks/prod deploy runbook.md`
- `docs/important tasks/version 1 prod server launch brief.md`
- `docs/security/database-agent-access-contract.md`
- `docs/security/aws-prod-agent-readonly-permission-set-policy.template.json`
- `docs/important tasks/prod db schema copy prep.md` if DB/schema work is discussed.

Next recommended tasks:

1. Help Jonat create the AWS IAM Identity Center permission set/profile `mangorts-prod-agent-readonly` using `docs/security/aws-prod-agent-readonly-permission-set-policy.template.json`. This should be done by Jonat/human admin in AWS Console or a human-only admin session, not by an agent using admin credentials.
2. Configure local AWS CLI profile `mangorts-prod-agent-readonly` only after the permission set/account assignment exists.
3. Verify the profile: `aws sts get-caller-identity --profile mangorts-prod-agent-readonly` should work; `aws secretsmanager list-secrets --profile mangorts-prod-agent-readonly --region us-west-1` should fail with AccessDenied; RDS/ECS describe commands should work if allowed.
4. Move or protect human-only local config (`infra/aws-prod/terraform.tfvars`, `infra/aws-dev/terraform.tfvars`) outside Hermes-accessible workspace paths or use a separate Windows profile for human-only prod admin work.
5. Continue Jonat's human DBeaver prod setup through a private tunnel. Jonat may use writer/admin DB access in DBeaver, but agents must not be able to access saved writer credentials or operate an open writer DBeaver session.
6. Continue Nylas prod setup after the agent boundary is enforced.
7. Do an ECS/prod cost review before adding more services. Current Terraform defaults include two backend Fargate tasks (`backend_desired_count=2`, `backend_cpu=1024`, `backend_memory=2048`), plus ALB, NAT Gateway, CloudWatch/Container Insights, ECR, and data transfer costs.

Secret-handling rules:

- Never ask Jonat to paste DB passwords, AWS tokens, MFA/recovery codes, GitHub tokens, Nylas API keys, webhook secrets, origin verification secrets, or password-bearing connection strings.
- Do not run `aws secretsmanager get-secret-value` for writer/app/provider secrets from an agent session.
- Record only safe metadata when necessary, and even infrastructure metadata should be minimized because Jonat wants low digital exposure.

When updating docs, include real tool output and verification status. Label temporary `hermes-verify-*` checks as ad-hoc verification, not canonical suite-green.
