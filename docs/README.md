# MangoRTS Docs

This folder contains both current docs and older project history. For backend, auth, AWS, deployment, and database setup, future agents must start with the canonical MangoRTS docs below.

## Canonical Docs

- `docs/mangorts-dev-platform.md` - AWS dev architecture and service responsibilities.
- `docs/mangorts-auth.md` - Cognito login, JWT validation, and company membership authorization.
- `docs/mangorts-deploy-runbook.md` - GitHub-to-AWS deployment flow.
- `docs/mangorts-infra-state.md` - Terraform ownership and manually reused AWS resources.
- `docs/mangorts-database.md` - Current dev database assumptions and migration flow.
- `docs/latency-obsession-architecture.md` - Product-scale latency and robustness principles.
- `docs/agents/sacred-text.md` - Required agent operating context.

## Stale-Doc Policy

Any document that says MangoOS or references `infra/terraform` as the live AWS stack is historical unless it explicitly says otherwise. The canonical dev stack is `infra/aws-dev`, and the canonical project slug is `mangorts`.

Do not follow old MangoOS deployment commands without first reconciling them against the canonical docs above.
