# MangoRTS Infra Docs

This folder contains the current infra, auth, deployment, and production-readiness docs for MangoRTS.

The current live platform documentation is for dev only. MangoRTS does not yet have a production environment. Production must be created separately from dev for AWS resources, Terraform state, database, Cognito, Nylas, Secrets Manager, GitHub deploy environment, DNS, monitoring, and rollback.

## Current Dev Docs

- `docs/infra/mangorts-dev-platform.md` - AWS dev architecture and service responsibilities.
- `docs/infra/mangorts-auth.md` - Cognito login, JWT validation, and company membership authorization.
- `docs/infra/mangorts-deploy-runbook.md` - GitHub-to-AWS dev deployment flow.
- `docs/infra/mangorts-infra-state.md` - Terraform ownership and manually reused AWS resources.
- `docs/infra/mangorts-database-migrations.md` - Native Go database migration runner for local and ECS one-off use.

Dev V2 means the `infra/aws-dev` platform: Cognito auth, ECS Fargate backend, S3 + CloudFront frontend, Route 53, WAF, the existing AWS PostgreSQL/Aurora database, and GitHub Actions OIDC deploys.

## Production Readiness Docs

- `docs/infra/mangorts-prod-platform.md` - Target production architecture and required separation from dev.
- `docs/infra/mangorts-prod-deploy-runbook.md` - Safe production deploy flow, approval gates, smoke tests, and rollback notes.
- `docs/infra/mangorts-prod-data-migration.md` - Selective dev-to-prod data migration approach and validation checks.
- `docs/infra/mangorts-prod-nylas-email.md` - Production Nylas, SES, DNS, and Google OAuth readiness.

These production docs are scaffolding and runbooks. They do not claim production resources already exist.

## Related Docs

- `docs/backend/mangorts-database.md` - Current database assumptions and migration flow.
- `docs/developer-windows-setup.md` - Windows developer setup.
- `docs/important tasks/version 1 prod creation.md` - Planning notes for the first production environment.
- `docs/latency-obsession-architecture.md` - Product-scale latency and robustness principles.
- `docs/agents/sacred-text.md` - Required agent operating context.

## Stale-Doc Policy

Any document that says MangoOS or references `infra/terraform` as the live AWS stack is historical unless it explicitly says otherwise. The canonical dev stack is `infra/aws-dev`, and the canonical project slug is `mangorts`.

Do not follow old MangoOS deployment commands without first reconciling them against the canonical docs above.
