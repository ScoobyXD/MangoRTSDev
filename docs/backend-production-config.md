# Historical: Backend Configuration Notes

This document predates the MangoRTS dev platform plan. Use `docs/mangorts-dev-platform.md`, `docs/mangorts-auth.md`, `docs/mangorts-infra-state.md`, and `docs/mangorts-database.md` for current AWS/backend guidance.

# Backend Configuration: Professional Pattern (Startup/Enterprise)

This is the recommended configuration model for a real startup environment.

## 1) Configuration tiers

Use a clear hierarchy:

1. **Local development**
   - Developers can set env vars in terminal/profile for quick runs.
   - Use `backend/.env.example` as the canonical key list.
2. **Staging**
   - Run backend in ECS/Fargate.
   - Pass non-sensitive config via task definition `environment`.
   - Pass secrets via task definition `secrets` from AWS Secrets Manager.
3. **Production**
   - Same as staging, but with stricter IAM, rotation, monitoring, and change controls.

## 2) What this repo already does correctly

`infra/terraform/ecs.tf` already injects:

- Non-secret config:
  - `DB_HOST`
  - `DB_PORT`
  - `DB_NAME`
  - `DB_USER`
  - `MIRAEOPUS_ADDR`
- Secret config:
  - `DB_PASSWORD` via `secrets.valueFrom` (Secrets Manager ARN)

This is the right professional baseline: app still reads env vars, but humans do not manually type secrets in production terminals.

## 3) Minimum production-ready controls

For an actual startup launch, enforce these:

1. **Secrets**
   - Store DB credentials in Secrets Manager.
   - Enable rotation policy and run rotation drills.
2. **IAM**
   - Grant ECS task role read access only to required secrets.
   - Deny wildcard secret access.
3. **Runtime safety**
   - `APP_ENV=staging|prod` should fail fast if DB config is missing/unreachable.
   - Keep `ALLOW_INMEMORY_FALLBACK=false` in staging/prod.
4. **Networking**
   - Private subnets for ECS tasks and Aurora.
   - SG allows DB inbound only from app SG.
5. **Operations**
   - Structured logging + alerting.
   - Health checks and rollout strategy (rolling/canary).
   - Runbook for secret rotation and DB failover.

## 4) Recommended workflow for your team

1. Keep `.env.example` updated whenever a new config key is introduced.
2. For each environment (staging/prod), map keys in Terraform task definitions.
3. Put only non-secret defaults in Terraform vars; keep secrets in Secrets Manager.
4. Validate required env vars in app startup and fail with clear errors.
5. Deploy through CI/CD (not manual shell sessions).

## 5) Why this is "professional"

This approach gives:

- repeatable deployments,
- auditable config changes,
- no plaintext secrets in git or ad-hoc terminal history,
- clear separation between code, non-secret config, and secrets.
