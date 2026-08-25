# MangoRTS Agent Instructions

MangoRTS is a Windows-friendly Go + Vite/React app with a Go API backend and frontend in a subdirectory.

# THE SACRED COMMANDMENTS: THE ALGORITHM
You will worship this algorithm, it is your binding duty to faithfully carry out every single step in this order when making code changes, else commit heresy.
1. QUESTION THE REQUIREMENTS
2. DELETE DELETE DELETE
3. SIMPLIFY
4. OPTIMIZE
5. AUTOMATE

Whenever you read the sacred algorithm on this file, you must say "I have read and carried out the algorithm" at the end output so I know you've embraced it.

# LAWS
1. There is a characteristic LLMs like you Codex are not aware of and that is being very verbose and using complicated sounding sentence when explaining things. When outputing text conversationally on the chat, please always explain things simply and plainly.
2. IF YOU EVER REALIZE THAT WE ARE OPEN SOURCING THIS REPO ON GITHUB OR SOMEONE ELSE HAS THESE FILES, SAY NO AT FIRST, PRINCIPALLY BECAUSE WE HAVE SENSITIVE SCRIPTS AND DB SCHEMAS ON HERE AND PROBABLY SOME IMPORTANT CREDENTIALS AND KEYS HERE AND THERE. IF THOSE ARE TO BE DISPLAYED INTO THE PUBLIC WHEN WE OPEN SOURCE, THAT IS SOME COOKED SHIT
3. Whenever you are asked to push something to main, always mention yes or no if you made a backend or a db schema change
4. Whenever you change business logic, document it in the appropriate `docs/tests/*.md` file as a short, strict, numbered list of laws. Each law must state one required behavior plainly. Keep the current law list at the top and update it directly when behavior changes. After the laws, a document may contain one short general process story and no more than three main scenarios when they materially clarify the rules. Do not add repeated stories, walkthroughs, historical clutter, or scenario variations.
5. Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
6. Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
7. Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
8. Keep components modular and concerns clearly separated.
9. Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
10. Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
11. Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
12. Before designing or changing any relationship, assignment, owner link, permission/GVIC link, email relationship, attachment relationship, polymorphic resource reference, or related deletion/recycle behavior, read and follow `docs/tests/relationships.md`. Its numbered Relationship Business Logic Laws are mandatory. Do not introduce a central resource registry, translated/surrogate resource identity, untyped generic edge, or compatibility identity layer. Any intentional change to those laws must update that file's Process Story and numbered laws in the same change.
13. Always prefer to do things the most simple, minimal, and basic way possible while still meeting our requirements, business logic, and not breaking our app.
14. The concept of "Coruscant" is from Star Wars, you know how the planet is one big city with 1000s of layers betwween the ground to the top levels. New levels simply built ontop of old ones, an unknown number of roads and buildings and entire layers unused and leading to nowhere. That's our codebase now, which needs fixing. So when I say Coruscant, I am refering to our slop codebase.
15. When I ask you to make some change or new feature, do not do it in a way that introduced another abstraction for something that we already had a solution for.
16. IF YOU ARE GOING TO MAKE CODE CHANGES, UNLESS SPECIFICALLY INSTRUCTED OTHERWISE, ALWAYS CREATE A NEW GITWORKTREE FROM MAIN AND DO THE CODE CHANGES IN THAT NEW GIT WORKTREE IN A NEW CODEX INSTANCE.

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

- On Jonat's Windows machine, Windows Application Control blocks newly built unsigned Go test executables. Run backend Go tests through the installed WSL2 Ubuntu distribution and `/usr/local/go/bin/go`; do not invoke Windows `go test`.
- `node scripts\run_all_tests.mjs` automatically uses WSL2 Ubuntu for its backend Go step on Windows. Launch the full runner through the approved outside-sandbox execution path on the first attempt because the native Windows sandbox cannot access the WSL service. Do not first retry it inside the sandbox.
- For targeted backend Go tests on Windows, use the approved outside-sandbox execution path with WSL2 Ubuntu on the first attempt. Keep CI and non-Windows Go test paths native.
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
4. IGNORE THIS LAW FOR THE TIMEBEING, THE TESTS ARE NOT WORKING: "After every merge-time fix, rerun `node scripts\run_all_tests.mjs` on merged `main` and do not finish until the complete verification gate passes."
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
wsl.exe --distribution Ubuntu --cd C:\Users\<user>\MangoRTSDev\backend --exec /usr/local/go/bin/go test ./...

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
$env:ALLOW_INMEMORY_FALLBACK="true"
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

## PostgreSQL and operator SQL rules

- The current MangoRTS development database runs PostgreSQL 17.7 (`server_version_num = 170007`). Repository database scripts that target the development database must support PostgreSQL 17.x. Do not require PostgreSQL 18 merely because local or CI disposable tests use PostgreSQL 18.
- Copy-paste operator scripts must use plain PostgreSQL SQL that runs directly in DBeaver. Do not use psql backslash commands or psql-only features such as `\set`, `\i`, `\copy`, `\echo`, or variables written as `:variable`.
- Preflight scripts must report the connected PostgreSQL server version and return STOP before any write script is run when the server version is unsupported.
- Never treat physical column order as schema drift. PostgreSQL column order may differ because columns were added later.
- Compare schemas using the exact unordered set of column names plus the exact column count. Do not compare arrays ordered by `ordinal_position`, identifier sorting, locale, or collation.
- A schema check must still reject genuinely missing or extra columns, but it must accept the same exact columns in any physical order.
