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

## App worktree task creation, completion, and integration

### Required model, reasoning, and speed settings

Whatever the original task's model and speed settings were, and reasoning settings were, just copy and use that exact same setting for the work tree agent. 

### Canonical app-worker naming

- The canonical user-visible Git branch identity is `codex/<descriptive-english-words><7 digits>`, for example `codex/fix-worktree-names0000123`.
- The descriptive portion contains only English letters and hyphen-separated words. Do not prepend or retain a GUID, UUID, thread ID, or other opaque identifier. The collision-safe seven-digit allocation suffix is the only numeric portion and must be the final seven characters.
- Include `MANGORTS_WORKTREE_PURPOSE: <short English purpose>` in every app-worker prompt and make the worker's first command `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts\ensure_codex_worktree_branch.ps1 -Purpose "<short English purpose>"`. Run it before inspecting or changing project files.
- The Codex app owns the opaque checkout directory beneath `.codex/worktrees`; do not rename that internal directory. Treat the suffix-bearing Git branch as the canonical worker identity.

### Default: create the worker, then stop without integration

When Jonat asks a project/Local task in the Codex desktop app to create, spawn, or start a new worktree for one job, use this lifecycle by default:

1. Create one separate, user-visible Codex app task in a new Codex-managed Git worktree. Inject the user's complete requested task, relevant context, safety boundaries, and this no-integration policy into the worker prompt.
2. The original task is only the launcher. After confirming that the worker task was created, it must stop. It must not duplicate the work, remain an orchestrator, poll the worker, apply the worker's patches, or integrate the result unless Jonat explicitly asked for continuing coordination.
3. The worker owns implementation, proportionate verification, diff review, and documentation updates in its own worktree. For a change task, commit every intended change locally on the worker branch unless Jonat explicitly says not to commit. For a read-only task, make no commit.
4. When finished, the worker reports what changed, why, verification results, worktree path, branch, commit SHA when applicable, and final status, then stops in the worktree.
5. Do not merge or otherwise integrate the worker into local `main`. Do not hand the task off to Local, apply its patch from another task, push any branch, or open a pull request unless Jonat explicitly requests that separate action after reviewing the completed worker.
6. "Do not push" is not permission to merge locally. Commit, merge, handoff, push, and pull-request creation are separate actions; integration into `main` always requires an explicit user request.

This launcher/worker behavior should be driven from Jonat's natural-language request. Do not require him to configure branches, paths, helper scripts, or task settings manually when app task/worktree controls are available. Use hidden subagents only for bounded subtasks inside the worker; do not substitute a hidden subagent for the requested user-visible worktree task.

### Explicit integration only

Only when Jonat explicitly asks to merge or integrate a completed worker into local `main`:

1. Review the worker diff, exclude unrelated changes, and ensure every intended worker change is committed.
2. From `C:\Users\Jonat\MangoRTSDev`, run `scripts\merge_worker_branch.ps1` for that worker with `-CommitWorkerChanges` and `-Verification Full`; let the helper resolve the worker branch from `-WorkerPath`.
3. Resolve any merge conflicts or integration failures while preserving both current `main` behavior and the worker's intended product behavior.
4. After every merge-time fix, rerun `node scripts\run_all_tests.mjs` on merged `main` and do not finish until the complete verification gate passes.
5. Report the worker path and branch, worker commit SHA, merge commit SHA, verification result, final `git status --short --branch`, and any conflict-resolution or post-merge fixes separately.
6. Every merge completion report must prominently and unambiguously include all of the following, based on inspection of the merged diff:
   - `Backend changes: yes` or `Backend changes: no`. When yes, identify the backend files or subsystems changed and summarize the behavioral effect.
   - `Database/schema changes: yes` or `Database/schema changes: no`. When yes, identify every migration, canonical schema, seed, or database-contract change and state any required human-run migration or rollout action.
   - `Merge conflicts: none` when there were no conflicts. When conflicts occurred, identify every conflicted file, explain the competing changes or exact problem, describe precisely how each conflict was resolved and why that resolution preserves both current `main` behavior and the worker's intent, and report the verification run after resolution.
7. Do not push the worker branch or `main` unless Jonat explicitly asks for a push.

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
