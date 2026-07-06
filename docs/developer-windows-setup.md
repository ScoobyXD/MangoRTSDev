# MangoRTS Windows Developer Setup

This document records the repeatable setup path used to prepare a new Windows laptop for MangoRTS development.

## Scope and safety rules

This setup prepares local development, cloud-integrated dev testing, and admin tooling.

Do **not** do any of these without explicit approval:

- delete databases or reset data
- reset Git history or run `git clean -fdx`
- run `terraform apply` for prod
- modify prod Route53, Cognito, RDS, ECS, ECR, Secrets Manager, GitHub environments, or Nylas settings
- store prod secrets in plaintext local files
- commit `.env.local` files
- uninstall software
- restart the laptop
- install Docker Desktop
- install anything requiring payment

Use AWS SSO profiles, not long-lived static AWS access keys. Keep `mangorts-dev` and `mangorts-prod` separate.

## Target repo location

```text
C:\Users\<windows-user>\MangoRTSDev
```

Repo URL:

```text
https://github.com/ScoobyXD/MangoRTSDev.git
```

## Prerequisites

Required:

- Chrome
- Visual Studio Code
- Git for Windows
- GitHub CLI
- PowerShell 7
- Node.js LTS
- npm
- Go 1.23.x
- PostgreSQL 18 server or at least command-line tools / `psql`
- AWS CLI v2
- Terraform
- DBeaver Community for database browsing/admin work

Optional:

- Docker Desktop — ask first because it may require WSL/Hyper-V and a restart.

## Audit commands

PowerShell:

```powershell
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

Get-Service | Where-Object { $_.Name -match 'postgres|pgsql|postgre' -or $_.DisplayName -match 'postgres|pgsql|postgre' }
```

For PostgreSQL, record version, install path, data directory, port, service name, and running state.

## Install missing tools

On Windows, prefer `winget` for tools that support user-scope installs:

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id GitHub.cli --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id Microsoft.PowerShell --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id OpenJS.NodeJS.LTS --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id Amazon.AWSCLI --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id Hashicorp.Terraform --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id DBeaver.DBeaver.Community --exact
```

Go 1.23.x may not be the current winget version. If winget only offers a newer Go, install Go 1.23.x directly from <https://go.dev/dl/>. The setup run for Jonat used:

```text
https://go.dev/dl/go1.23.12.windows-amd64.zip
```

Unzip to a stable user path such as:

```text
C:\Users\<windows-user>\devtools\go1.23.12
```

Add this to the user PATH:

```text
C:\Users\<windows-user>\devtools\go1.23.12\bin
```

If PostgreSQL 18 is already installed, add this to the user PATH if needed:

```text
C:\Program Files\PostgreSQL\18\bin
```

## VS Code extensions

Install these:

```powershell
code --install-extension golang.go
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension GitHub.vscode-pull-request-github
code --install-extension eamodio.gitlens
code --install-extension ms-vscode.PowerShell
code --install-extension hashicorp.terraform
```

Only install Docker extension if Docker Desktop is installed:

```powershell
code --install-extension ms-azuretools.vscode-docker
```

## Git configuration

Set the developer's real commit identity:

```powershell
git config --global user.name "Jonathan"
git config --global user.email "<developer-email>"
git config --global core.autocrlf true
git config --global pull.ff only
```

For Jonat's current laptop:

```powershell
git config --global user.email "Jonathankim829@gmail.com"
```

## GitHub authentication

Install GitHub CLI first, then authenticate:

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

Complete the browser login. Then verify:

```powershell
gh auth status
gh auth setup-git
```

## Clone or update the repo

```powershell
cd C:\Users\<windows-user>

git clone https://github.com/ScoobyXD/MangoRTSDev.git MangoRTSDev
cd MangoRTSDev
```

If the repo already exists:

```powershell
cd C:\Users\<windows-user>\MangoRTSDev
git status
git pull --ff-only origin main
```

## Frontend setup

There is no root `package.json`. Do not run `npm install` from repo root.

```powershell
cd C:\Users\<windows-user>\MangoRTSDev\frontend
npm ci
```

Create `C:\Users\<windows-user>\MangoRTSDev\frontend\.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
VITE_COMPANY_ID=11111111-1111-1111-1111-111111111111
VITE_AUTH_MODE=disabled
VITE_COGNITO_REGION=us-west-1
VITE_COGNITO_USER_POOL_ID=
VITE_COGNITO_CLIENT_ID=
```

Do not commit `.env.local`.

## Backend verification

```powershell
cd C:\Users\<windows-user>\MangoRTSDev\backend
go test ./...
```

If Go cache errors happen on restricted Windows environments, use a repo-local cache:

```powershell
$env:GOCACHE="C:\Users\<windows-user>\MangoRTSDev\backend\go-build-cache"
go test ./...
```

## Full repo verification

```powershell
cd C:\Users\<windows-user>\MangoRTSDev
node scripts\run_all_tests.mjs
```

This runs frontend relationship tests, the frontend production build, and backend Go tests.

## Simple local run

Backend terminal:

```powershell
cd C:\Users\<windows-user>\MangoRTSDev\backend
$env:APP_ENV="dev"
$env:AUTH_MODE="disabled"
$env:MANGORTS_ALLOWED_ORIGIN="http://localhost:5173"
$env:MANGORTS_ADDR=":8080"
go run .\cmd\miraeopus-api
```

Expected backend log:

```text
using in-memory repository (DB_HOST not set, dev/fallback mode)
miraeopus-api listening on :8080
```

Backend health:

```powershell
Invoke-WebRequest http://localhost:8080/healthz
```

Frontend terminal:

```powershell
cd C:\Users\<windows-user>\MangoRTSDev\frontend
npm run dev
```

Open:

```text
http://localhost:5173
```

Use `localhost`, not `127.0.0.1`, unless the backend CORS allowed origin is changed accordingly.

## Cloud-integrated dev mode

Only do this after simple local mode works.

Required local untracked files/config may include:

```text
infra/aws-dev/terraform.tfvars
scripts/start_local_cognito_backend.local.ps1
```

Do not invent secrets. If config is missing, copy from the `.example` files only as a template and fill in real non-prod values from approved sources.

Use AWS SSO:

```powershell
aws configure sso
# profile name: mangorts-dev
aws sso login --profile mangorts-dev
```

Start local Cognito/dev-backed backend:

```powershell
cd C:\Users\<windows-user>\MangoRTSDev
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting
```

If this fails because of missing AWS access, Secrets Manager permissions, Cognito permissions, missing `terraform.tfvars`, or missing local Nylas config, stop and report the exact error.

## Current setup report for Jonat's new Windows laptop

Date: 2026-07-03/04

```text
Windows user: Jonat
Repo location: C:\Users\Jonat\MangoRTSDev
Repo branch: main
Repo HEAD during setup: 37976bb8
```

Installed/verified versions:

```text
git        git version 2.55.0.windows.2
gh         gh version 2.96.0
node       v24.18.0
npm        11.16.0
go         go version go1.23.12 windows/amd64
psql       psql (PostgreSQL) 18.4
aws        aws-cli/2.35.15
terraform Terraform v1.15.7
DBeaver   DBeaver Community 26.1.2
pwsh       PowerShell 7.6.3
code       VS Code 1.127.0
```

DBeaver:

```text
Package: DBeaver.DBeaver.Community
Version: 26.1.2
Install path: C:\Users\Jonat\AppData\Local\DBeaver\dbeaver.exe
```

Do not save production DB passwords in DBeaver unless Jonat explicitly chooses a local password-manager/storage policy. For prod, prefer controlled access paths and Secrets Manager metadata; never paste DB passwords into repo docs or chat.

PostgreSQL:
```text
Service name: postgresql-x64-18
Display name: postgresql-x64-18 - PostgreSQL Server 18
Install path: C:\Program Files\PostgreSQL\18
Data directory: C:\Program Files\PostgreSQL\18\data
Port: 5432
State: Running
Start mode: Auto
```

VS Code extensions installed:

```text
golang.go
dbaeumer.vscode-eslint
esbenp.prettier-vscode
github.vscode-pull-request-github
eamodio.gitlens
ms-vscode.powershell
hashicorp.terraform
```

Skipped:

```text
ms-azuretools.vscode-docker — Docker Desktop not installed yet.
```

Verification results:

```text
frontend npm ci: passed
backend go test ./...: passed
node scripts\run_all_tests.mjs: passed
simple local backend: started on :8080 using in-memory dev repository
backend health: http://localhost:8080/healthz returned 200 OK
frontend dev server: started on http://localhost:5173
```

Pending/manual:

```text
GitHub browser auth must be completed via gh auth login.
AWS SSO profile mangorts-dev is not configured yet; needs SSO start URL/region/account/role and browser login.
Cloud-integrated dev backend was not started yet because AWS SSO/local dev cloud config are pending.
Docker Desktop was not installed because it requires explicit approval.
```
