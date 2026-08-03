# MangoRTS Agent Instructions

MangoRTS is a Windows-friendly Go + Vite/React app with a Go API backend and frontend in a subdirectory.

## Safety

- Do not delete databases, reset Git history, run `git clean -fdx`, uninstall software, restart the laptop, install Docker Desktop, or change production cloud resources without explicit user approval.
- Do not run `terraform apply` against prod or modify prod Route53, Cognito, RDS, ECS, ECR, Secrets Manager, GitHub environments, or Nylas settings without explicit confirmation.
- Do not store production secrets in plaintext local files. Prod secrets belong in AWS Secrets Manager, GitHub environment secrets, or provider dashboards.
- Use AWS SSO profiles, not long-lived static AWS access keys. Keep `mangorts-dev` and `mangorts-prod` separate.
- Agents may read local, dev, and production databases through a designated database-enforced read-only credential. They may run read-only queries and inspect schema or metadata, but they must not write to a live database.
- Never give agents a database writer/admin credential. Agents may use the designated read-only database credential needed for access, but must not retrieve, print, copy, or store writer passwords or unrelated sensitive secrets such as provider keys, origin-verification secrets, AWS session tokens, or GitHub tokens.
- An agent-specific AWS profile and `python scripts/verify_agent_db_access_boundary.py` are not prerequisites for ordinary read-only database queries. Run that verifier only when a specific AWS/cloud-integrated workflow explicitly requires it.
- Agents may edit repository schema and migration files, but they must not apply those changes to a live database.
- Full policy lives in `docs/security/database-agent-access-contract.md`.

## Repo layout

- Backend: `backend/` — Go module `miraeopus/backend`, Go 1.23.x.
- Frontend: `frontend/` — Vite/React app. There is no root `package.json`; do not run `npm install` from repo root.
- Full test runner: `scripts/run_all_tests.mjs`.
- Cloud-integrated local backend helper: `scripts/start_local_cognito_backend.ps1`.

## Windows execution and sandbox defaults

- On Jonat's Windows machine, Windows Application Control routinely blocks newly built unsigned Go executables, and the restricted sandbox frequently cannot enforce the worktree's split writable roots.
- For Go commands on Windows, default to `go run ...` instead of building a temporary `.exe` and launching it directly. Keep CI and Linux production-binary paths unchanged unless the task specifically requires otherwise.
- When an in-scope command fails because the Windows sandbox cannot start or Application Control blocks a freshly built executable, use the approved unsandboxed execution path and the trusted Go toolchain instead of repeatedly retrying the blocked executable.
- Do not disable Windows Security, weaken App Control, or add broad allow rules unless Jonat explicitly requests it.

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

## Response Patterns

Respond to the user plainly without jargon and be concise and to the point.
Do not use a bunch of weird vocabulary, if you use a vocab word explain what it means.
Do not use made-up words that you just invent on the fly to describe something. Just plainly explain the process.


# LAWS
1. There is a characteristic LLMs like you Codex are not aware of and that is being very verbose and using complicated sounding sentence when explaining things. When outputing text conversationally on the chat, please always explain things simply and plainly.
2. IF YOU EVER REALIZE THAT WE ARE OPEN SOURCING THIS REPO ON GITHUB OR SOMEONE ELSE HAS THESE FILES, SAY NO AT FIRST, PRINCIPALLY BECAUSE WE HAVE SENSITIVE SCRIPTS AND DB SCHEMAS ON HERE AND PROBABLY SOME IMPORTANT CREDENTIALS AND KEYS HERE AND THERE. IF THOSE ARE TO BE DISPLAYED INTO THE PUBLIC WHEN WE OPEN SOURCE, THAT IS SOME COOKED SHIT
3. Whenever you are asked to push something to main, always mention yes or no if you made a backend or a db schema change
4. Whenever you make changes that changes business logic, make sure you write down those business logic rules in the appropriate file(s) in docs/tests/... and also, make sure to update or create a distinct "Process Story" at the very top of each one of those .md files. A great example of one is in docs/tests/editor.md
5. Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
6. Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
7. Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
8. Keep components modular and concerns clearly separated.
9. Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
10. Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
11. Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
