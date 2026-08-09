# MangoRTS Windows + Hermes Zero-to-Ready Bootstrap

This is the reusable handoff document for setting up a new Windows laptop for MangoRTS development with Hermes Agent.

Audience: a future Hermes/Codex/Claude-style local agent running on a developer's Windows machine.

Primary instruction to the agent: **do the setup through tools; do not ask the human to run terminal commands manually.** Ask the human only for credentials, browser approvals, secrets, paid/admin approvals, or business decisions.

## 0. Mission

Bring a fresh Windows laptop from "Hermes is installed" to a verified MangoRTS development environment:

1. Audit existing tools.
2. Install missing prerequisites.
3. Configure Git and GitHub CLI.
4. Configure AWS SSO dev profile when the user has the SSO details.
5. Clone/update MangoRTS.
6. Install frontend dependencies.
7. Create safe local env files.
8. Run backend tests and full repo verification.
9. Start backend/frontend locally and verify HTTP health.
10. Attempt cloud-integrated dev mode only after simple local mode works.
11. Produce a final setup report.
12. Update this document/script if any step was manual or failed.

## 1. Hard safety rules

Do **not** do these without explicit user approval:

- delete databases or reset local/prod data
- reset Git history
- run `git clean -fdx`
- uninstall software
- restart the laptop
- install Docker Desktop / WSL / Hyper-V
- install paid software
- run `terraform apply`, especially against prod
- modify prod Route53, Cognito, RDS, ECS, ECR, Secrets Manager, GitHub environments, or Nylas settings
- copy prod secrets into local plaintext files
- commit `.env.local`, secrets, AWS credentials, Nylas keys, Cognito client secrets, or database passwords

Use AWS SSO profiles, not long-lived static AWS keys.

Keep profiles separate:

```text
mangorts-dev
mangorts-prod
```

Do not mix dev and prod profiles.

## 2. Values and paths

Default repo URL:

```text
https://github.com/ScoobyXD/MangoRTSDev.git
```

Default clone path:

```text
C:\Users\<windows-user>\MangoRTSDev
```

On Jonat's machine this is:

```text
C:\Users\Jonat\MangoRTSDev
```

Simple local backend:

```text
http://localhost:8080
```

Simple local frontend:

```text
http://localhost:5173
```

Use `localhost`, not `127.0.0.1`, unless backend CORS is updated.

## 3. Information to ask the human for

Ask only when required.

Required early:

```text
Git commit name:
Git commit email:
GitHub repo URL, if different from https://github.com/ScoobyXD/MangoRTSDev.git:
```

Required for GitHub auth:

```text
Please complete the browser/device-code login that I open.
```

Required for AWS SSO dev:

```text
AWS SSO start URL:
AWS SSO region:
AWS account/role to use for mangorts-dev, if the picker asks:
```

Required for cloud-integrated Nylas/AWS local dev only if scripts report missing config:

```text
Approved source for non-prod terraform.tfvars values:
Approved source for Nylas dev config / local override file:
```

Never ask the human to paste production secrets into chat.

## 4. Expected toolchain

Required:

- Chrome
- Visual Studio Code
- Git for Windows
- GitHub CLI (`gh`)
- PowerShell 7 (`pwsh`)
- Node.js LTS + npm
- Go 1.23.x
- PostgreSQL 18 server or at least PostgreSQL 18 CLI tools / `psql`
- AWS CLI v2
- Terraform

Optional / ask first:

- Docker Desktop

Useful VS Code extensions:

```text
golang.go
dbaeumer.vscode-eslint
esbenp.prettier-vscode
GitHub.vscode-pull-request-github
github.vscode-github-actions
eamodio.gitlens
ms-vscode.PowerShell
hashicorp.terraform
ms-azuretools.vscode-docker  # only if Docker Desktop is installed
```

## 5. Agent workflow

Create a todo list with these phases:

```text
1. Audit existing tools and services.
2. Install missing prerequisites.
3. Configure Git identity and safe defaults.
4. Authenticate GitHub CLI.
5. Clone/update MangoRTS.
6. Install frontend deps and create local env.
7. Run backend and full repo verification.
8. Start simple local backend/frontend and verify HTTP.
9. Configure AWS SSO dev.
10. Run cloud-integrated dev backend if possible.
11. Write final setup report and update repeatable docs.
```

## 6. Audit commands

Prefer one PowerShell audit script rather than scattered commands.

Collect:

```powershell
$env:USERNAME
$env:USERPROFILE
$PSVersionTable.PSVersion
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsHardwareAbstractionLayer

git --version
gh --version
node --version
npm --version
go version
psql --version
aws --version
terraform version
pwsh --version
code --version
winget --version
```

Check PostgreSQL:

```powershell
Get-CimInstance Win32_Service |
  Where-Object { $_.Name -match 'postgres|pgsql|postgre' -or $_.DisplayName -match 'postgres|pgsql|postgre' } |
  Select-Object Name, DisplayName, State, StartMode, PathName

Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq 5432 }
```

Record PostgreSQL:

```text
version
install path
data directory
port
service name
running/not running
```

Check repo if present:

```powershell
Test-Path "$env:USERPROFILE\MangoRTSDev\.git"
```

Then, if present:

```powershell
cd "$env:USERPROFILE\MangoRTSDev"
git status --short --branch
git remote -v
```

## 7. Install missing prerequisites

Prefer `winget` where possible:

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --silent --id Git.Git --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --silent --id GitHub.cli --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --silent --id Microsoft.PowerShell --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --silent --id OpenJS.NodeJS.LTS --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --silent --id Amazon.AWSCLI --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --silent --id Hashicorp.Terraform --exact
```

Go 1.23.x may not be the current `winget` version. If `winget` only offers a newer Go, install Go 1.23.12 from the official zip:

```text
https://go.dev/dl/go1.23.12.windows-amd64.zip
```

Recommended user-owned install path:

```text
C:\Users\<windows-user>\devtools\go1.23.12
```

Add to user PATH:

```text
C:\Users\<windows-user>\devtools\go1.23.12\bin
```

If PostgreSQL 18 is installed but `psql` is missing from PATH, add:

```text
C:\Program Files\PostgreSQL\18\bin
```

After installs, refresh PATH inside the current PowerShell process:

```powershell
$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machine;$user"
```

Do not assume installation succeeded. Re-run version checks.

## 8. VS Code extensions

Install:

```powershell
code --install-extension golang.go --force
code --install-extension dbaeumer.vscode-eslint --force
code --install-extension esbenp.prettier-vscode --force
code --install-extension GitHub.vscode-pull-request-github --force
code --install-extension github.vscode-github-actions --force
code --install-extension eamodio.gitlens --force
code --install-extension ms-vscode.PowerShell --force
code --install-extension hashicorp.terraform --force
```

Only if Docker Desktop is installed:

```powershell
code --install-extension ms-azuretools.vscode-docker --force
```

If any extension install fails, record it and continue.

## 9. Git configuration

Ask the user for name/email if not already known.

Then configure:

```powershell
git config --global user.name "<developer-name>"
git config --global user.email "<developer-email>"
git config --global core.autocrlf true
git config --global pull.ff only
```

Verify:

```powershell
git config --global user.name
git config --global user.email
git config --global core.autocrlf
git config --global pull.ff
```

## 10. GitHub CLI auth

Check:

```powershell
gh auth status
```

If not logged in, start browser/device login:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

The human must complete the browser/device-code approval.

After login:

```powershell
gh auth status
gh auth setup-git
```

If the user prefers GitHub Desktop or VS Code sign-in, still keep GitHub CLI installed and record `gh auth status`.

## 11. Clone or update MangoRTS

If repo does not exist:

```powershell
cd $env:USERPROFILE
git clone https://github.com/ScoobyXD/MangoRTSDev.git MangoRTSDev
cd MangoRTSDev
```

If repo exists:

```powershell
cd "$env:USERPROFILE\MangoRTSDev"
git status --short --branch
git pull --ff-only origin main
```

Do not reset, clean, or overwrite local changes unless explicitly approved.

## 12. Repo layout warnings

MangoRTS has no root `package.json`.

Do **not** run `npm install` or `npm ci` from repo root.

Important paths:

```text
backend/                         Go backend module
frontend/                        Vite/React frontend
frontend/package.json             frontend npm scripts
backend/go.mod                    Go module
scripts/run_all_tests.mjs         full verification runner
scripts/start_local_cognito_backend.ps1 cloud-integrated local backend helper
scripts/setup_windows_dev.ps1     repeatable Windows setup script
```

## 13. Use the repo setup script when available

After the repo is cloned, prefer the checked-in helper script:

```powershell
cd "$env:USERPROFILE\MangoRTSDev"
.\scripts\setup_windows_dev.ps1 -InstallMissing -GitName "<developer-name>" -GitEmail "<developer-email>"
```

For a quick no-install/no-test smoke run:

```powershell
.\scripts\setup_windows_dev.ps1 -SkipTests -SkipGitHubAuth -SkipVSCodeExtensions
```

Expected script responsibilities:

- audit tools
- optionally install missing tools
- install VS Code extensions
- configure Git
- clone/update repo
- create `frontend/.env.local`
- optionally run `npm ci`, `go test ./...`, and `node scripts/run_all_tests.mjs`

## 14. Frontend setup

```powershell
cd "$env:USERPROFILE\MangoRTSDev\frontend"
npm ci
```

Create `frontend/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
VITE_COMPANY_ID=11111111-1111-1111-1111-111111111111
VITE_AUTH_MODE=disabled
VITE_COGNITO_REGION=us-west-1
VITE_COGNITO_USER_POOL_ID=
VITE_COGNITO_CLIENT_ID=
```

Verify it is ignored:

```powershell
cd "$env:USERPROFILE\MangoRTSDev"
git check-ignore frontend/.env.local
```

## 15. Backend tests

```powershell
cd "$env:USERPROFILE\MangoRTSDev\backend"
go test ./...
```

If Go cache problems occur, use a repo-local cache:

```powershell
$env:GOCACHE="$env:USERPROFILE\MangoRTSDev\backend\go-build-cache"
go test ./...
```

## 16. Full repo verification

```powershell
cd "$env:USERPROFILE\MangoRTSDev"
node scripts\run_all_tests.mjs
```

Expected success summary:

```text
All test suites passed.
```

If it fails, capture exact errors and fix root causes. Do not claim setup is complete until verification evidence exists or the blocker is clearly reported.

## 17. Simple local run

Backend:

```powershell
cd "$env:USERPROFILE\MangoRTSDev\backend"
$env:APP_ENV="dev"
$env:ALLOW_INMEMORY_FALLBACK="true"
$env:AUTH_MODE="disabled"
$env:MANGORTS_ALLOWED_ORIGIN="http://localhost:5173"
$env:MANGORTS_ADDR=":8080"
go run .\cmd\miraeopus-api
```

Expected logs:

```text
using explicitly allowed in-memory repository (DB_HOST not set)
miraeopus-api listening on :8080
```

Health check:

```powershell
Invoke-WebRequest http://localhost:8080/healthz
```

Expected health JSON includes:

```json
{
  "app_env": "dev",
  "auth_mode": "disabled",
  "ok": true
}
```

Frontend:

```powershell
cd "$env:USERPROFILE\MangoRTSDev\frontend"
npm run dev
```

Open:

```text
http://localhost:5173
```

The app shell should load. Some data panels may show unauthorized/empty states in simple local mode until Cognito/cloud-integrated dev mode is configured.

## 18. AWS SSO dev profile

Only after simple local mode works.

Configure SSO:

```powershell
aws configure sso
```

Profile name:

```text
mangorts-dev
```

Then login:

```powershell
aws sso login --profile mangorts-dev
aws sts get-caller-identity --profile mangorts-dev
```

Do not configure `mangorts-prod` until the user explicitly asks.

## 19. Cloud-integrated dev mode

Only after:

- simple backend health passes,
- frontend loads,
- `mangorts-dev` SSO works,
- required local non-prod config exists.

Run:

```powershell
cd "$env:USERPROFILE\MangoRTSDev"
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting
```

Possible local untracked config files:

```text
infra/aws-dev/terraform.tfvars
scripts/start_local_cognito_backend.local.ps1
```

If config/secrets/permissions are missing, stop and report the exact error. Do not invent secrets or paste prod values into local files.

## 20. Production/admin tooling

Install/verify only:

- AWS CLI v2
- Terraform
- GitHub CLI
- psql
- PowerShell 7

For prod, use a separate SSO profile:

```powershell
aws configure sso
aws sso login --profile mangorts-prod
```

Do not run prod-changing commands without explicit confirmation.

## 21. Verification for setup docs/scripts

Whenever the agent creates or edits setup scripts/docs, run focused ad-hoc verification.

Create a temporary script under the OS temp dir with prefix:

```text
hermes-verify-
```

Recommended checks:

1. PowerShell parser check for `scripts/setup_windows_dev.ps1`.
2. `frontend/.env.local` exactly matches expected simple-local config.
3. `frontend/.env.local` is gitignored.
4. `scripts/setup_windows_dev.ps1 -SkipTests -SkipGitHubAuth -SkipVSCodeExtensions` works against a disposable temp target.
5. Disposable target is removed after verification.

Label this as **ad-hoc verification**, not full suite green.

## 22. Final report template

At the end, report:

```text
Windows username:
Repo location:
Repo branch/head:
Git remote:

Installed versions:
- git --version:
- gh --version:
- node --version:
- npm --version:
- go version:
- psql --version:
- aws --version:
- terraform version:
- pwsh --version:
- code --version:

PostgreSQL:
- version:
- install path:
- data directory:
- service name:
- port:
- running/not running:

VS Code extensions installed:

Git:
- user.name:
- user.email:
- core.autocrlf:
- pull.ff:

GitHub:
- gh auth status:

Repo setup:
- frontend npm ci:
- backend go test ./...:
- node scripts\run_all_tests.mjs:
- frontend/.env.local exists and is gitignored:

Local run:
- backend process:
- backend health:
- frontend process:
- frontend URL:
- browser/app-shell status:

AWS/cloud dev:
- mangorts-dev profile exists:
- aws sts get-caller-identity:
- cloud-integrated backend result:

Pending manual approvals/secrets/blockers:

Repeatable docs/scripts updated:
```

## 23. Known-good result from Jonat's current machine

On Jonat's Windows laptop, simple local setup reached:

```text
Repo: C:\Users\Jonat\MangoRTSDev
Backend: http://localhost:8080/healthz returned 200 OK
Frontend: http://localhost:5173 returned 200 OK
Full verification: node scripts\run_all_tests.mjs passed
```

Verified tool versions during setup:

```text
git        git version 2.55.0.windows.2
gh         gh version 2.96.0
node       v24.18.0
npm        11.16.0
go         go version go1.23.12 windows/amd64
psql       psql (PostgreSQL) 18.4
aws        aws-cli/2.35.15
terraform Terraform v1.15.7
pwsh       PowerShell 7.6.3
code       VS Code 1.127.0
```

PostgreSQL:

```text
service: postgresql-x64-18
state: Running
port: 5432
path: C:\Program Files\PostgreSQL\18
```

Pending on Jonat's machine at the time this doc was created:

```text
GitHub CLI browser auth not completed yet.
AWS SSO mangorts-dev not configured yet.
Cloud-integrated Cognito/dev backend not verified yet.
Docker Desktop not installed by design; requires approval.
```
