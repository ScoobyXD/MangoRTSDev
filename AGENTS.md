# MangoRTS Agent Instructions

MangoRTS is a Windows-friendly Go + Vite/React app with a Go API backend and frontend in a subdirectory.

## Safety

- Do not delete databases, reset Git history, run `git clean -fdx`, uninstall software, restart the laptop, install Docker Desktop, or change production cloud resources without explicit user approval.
- Do not run `terraform apply` against prod or modify prod Route53, Cognito, RDS, ECS, ECR, Secrets Manager, GitHub environments, or Nylas settings without explicit confirmation.
- Do not store production secrets in plaintext local files. Prod secrets belong in AWS Secrets Manager, GitHub environment secrets, or provider dashboards.
- Use AWS SSO profiles, not long-lived static AWS access keys. Keep `mangorts-dev` and `mangorts-prod` separate.
- Database access boundary is physical, not trust-based. Agents (Hermes, Codex, Claude, OpenCode, CI helpers) must not have direct database write access or prod writer secrets. The backend app may keep its writer DB credential, and Jonat may use human-only writer/admin DBeaver access, but agents must use only read-only DB credentials/tunnels or scoped MangoRTS app API permissions.
- Before any agent performs AWS or database work, run `python scripts/verify_agent_db_access_boundary.py`. If it reports active `mangorts-prod`/`mangorts-dev` admin access, static AWS keys, or another write-enabling path, stop and ask Jonat to switch to a physically read-only agent profile/session.
- Do not retrieve, print, copy, or store prod/dev DB writer passwords, password-bearing connection strings, RDS-managed secret values, Nylas/provider secrets, origin verification secrets, AWS session tokens, or GitHub tokens. Do not run `aws secretsmanager get-secret-value` for writer/app secrets from an agent session.
- Do not run `psql`, migration tools, schema apply tools, one-off ECS tasks, `ecs:RunTask`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, or `iam:PassRole` against prod with writer/admin DB credentials from an agent session. Any future prod DB change must be performed by Jonat through a human-only admin path or via explicitly scoped app/API permissions.
- Full policy lives in `docs/security/database-agent-access-contract.md`; follow it for DBeaver, AWS SSO/IAM, Secrets Manager, and DB role setup.

## Repo layout

- Backend: `backend/` — Go module `miraeopus/backend`, Go 1.23.x.
- Frontend: `frontend/` — Vite/React app. There is no root `package.json`; do not run `npm install` from repo root.
- Full test runner: `scripts/run_all_tests.mjs`.
- Cloud-integrated local backend helper: `scripts/start_local_cognito_backend.ps1`.

## Local development commands

Windows PowerShell / PowerShell 7 preferred:

```powershell
# Frontend dependencies
cd C:\Users\<user>\MangoRTSDev\frontend
npm ci

# Backend tests
cd C:\Users\<user>\MangoRTSDev\backend
go test ./...

# Full repo verification
cd C:\Users\<user>\MangoRTSDev
node scripts\run_all_tests.mjs
```

Create `frontend/.env.local` for simple local mode:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
VITE_COMPANY_ID=11111111-1111-1111-1111-111111111111
VITE_AUTH_MODE=disabled
VITE_COGNITO_REGION=us-west-1
VITE_COGNITO_USER_POOL_ID=
VITE_COGNITO_CLIENT_ID=
```

Simple local run:

```powershell
# Terminal 1
cd C:\Users\<user>\MangoRTSDev\backend
$env:APP_ENV="dev"
$env:AUTH_MODE="disabled"
$env:MANGORTS_ALLOWED_ORIGIN="http://localhost:5173"
go run .\cmd\miraeopus-api

# Terminal 2
cd C:\Users\<user>\MangoRTSDev\frontend
npm run dev
```

Open `http://localhost:5173` and use `http://localhost:8080/healthz` for backend health.

## Cloud-integrated dev mode

Only after simple local mode works and AWS SSO is configured:

```powershell
aws sso login --profile mangorts-dev
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting
```

This requires local untracked config such as `infra/aws-dev/terraform.tfvars` and possibly `scripts/start_local_cognito_backend.local.ps1`. Do not invent secrets; stop and report exact missing AWS/Nylas/Secrets Manager/Cognito errors.

## Current machine setup snapshot

On Jonat's current Windows laptop the repo is cloned at `C:\Users\Jonat\MangoRTSDev`. Verified tools at setup time included Git, GitHub CLI, Node LTS, npm, Go 1.23.12, PostgreSQL 18 psql, AWS CLI v2, Terraform, PowerShell 7, and VS Code.
