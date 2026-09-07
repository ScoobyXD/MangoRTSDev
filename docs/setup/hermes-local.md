# Run Mango with Hermes locally on Windows

Use the existing Cognito backend launcher. Once the one-time setup below is complete, it starts Hermes and the Go API together. It already runs `go run ./cmd/miraeopus-api`; a second `go run` is unnecessary.

This guide assumes the existing Mango frontend, AWS `mangorts-dev` SSO profile, and cloud-development backend configuration already work. The broader [Windows laptop setup](hermes-windows-zero-to-mangorts.md) covers the base environment. Hermes requires the PostgreSQL-backed API; the in-memory local mode does not enable it.

## 1. Prepare Docker once

Install and start Docker Desktop with Linux containers. Docker Desktop is a prerequisite for this local Hermes launcher; the launcher does not install it. An agent must obtain explicit approval before installing it.

From the checkout containing the launcher changes:

```powershell
cd C:\Users\Jonat\MangoRTSDev
docker info
docker build -t mangorts-hermes:693641aa hermes
```

Wait for the build to finish successfully. The image uses the pinned upstream Hermes revision and this checkout's Mango plugin. Rebuild it with the same command after changing files under `hermes/`; startup does not rebuild it automatically.

## 2. Check the development database once

In DBeaver, select the Mango **development** database and run [hermes_ai_storage_preflight.sql](../../scripts/hermes_ai_storage_preflight.sql). This is read-only and reports the connected PostgreSQL version plus each AI table's exact column set and count. Physical column order does not matter.

- `READY-existing`: the four existing tables have the expected columns. Continue without rerunning the migration. This is a column check, not a full constraint/index audit; the tables must have been created from the reviewed migration.
- `READY-migrate`: a human operator must run [20260907_hermes_action_receipts.sql](../../backend/db/migrations/20260907_hermes_action_receipts.sql) in DBeaver, then rerun the preflight and obtain `READY-existing`.
- `STOP`: do not run the migration or enable Hermes. Inspect the reported unsupported version, missing Mango identity tables, partial AI setup, or conflicting existing table first. An older `ai_runs` archive must not be overwritten.

The supported server versions are PostgreSQL 17.x and 18.x; development uses 17.7. Neither the launcher nor an agent applies the migration to a live database.

## 3. Select your Mango account once

Run this read-only query in the same development database. Replace the email if needed:

```sql
SELECT u.email,
       u.display_name,
       u.user_id,
       c.company_id,
       c.name AS company_name,
       membership.role
  FROM public.users u
  JOIN public.company_memberships membership ON membership.user_id = u.user_id
  JOIN public.companies c ON c.company_id = membership.company_id
 WHERE u.email = lower(btrim('jonathankim829@gmail.com'))
 ORDER BY c.name, c.company_id;
```

Choose the company you will use in Mango. Copy its exact `company_id` and `user_id`. The user ID is Mango's UUID, not a Cognito subject. If no row is returned, check the email and database and sign into Mango to establish your account before continuing.

Add these **nonsecret** values to the existing ignored file `scripts/start_local_cognito_backend.local.ps1`. Preserve its other settings. Replace both placeholders with the UUIDs from the query:

```powershell
$MangoLocalHermesCompanyID = '<company_id>'
$MangoLocalHermesUserID = '<user_id>'
```

Alternatively, supply them for one launch:

```powershell
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting `
  -HermesCompanyID '<company_id>' -HermesUserID '<user_id>'
```

## 4. Start the app

With Docker Desktop running, use your usual PowerShell commands from the repository root:

```powershell
cd C:\Users\Jonat\MangoRTSDev
aws sso login --profile mangorts-dev
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting
```

Keep this terminal open. The launcher starts the scoped Hermes container, supplies its route to Go, and runs the API on port 8080. Hermes listens only on host loopback port 8642. Container callbacks reach the API through `host.docker.internal:8080`.

The application process retrieves only the authorized development OpenAI secret for Hermes through your SSO profile. It sends the provider key and two generated service credentials to the container through standard input. They are not command-line arguments, Docker configuration environment values, or an environment file. You do not need to copy an OpenAI key into a local config file. Existing backend AWS and database configuration still applies.

In a second terminal, start the existing frontend:

```powershell
cd C:\Users\Jonat\MangoRTSDev\frontend
npm run dev
```

Open `http://localhost:5173`, sign into the configured account, select the configured company, and open the AI panel. Start with “List the Processes I can access.” A successful reply verifies the actual provider and Mango read path. Creating a Node is a separate real business action; request it only in the Process and Step where you intend to create it.

## Stopping and starting again

Use Ctrl+C in the backend terminal. The launcher stops its Hermes container and retains the named volume `mangorts-hermes-<company_id>-<user_id>`. Reuse the same account pair on the next launch to retain native chats, memory, skills, and pending history. Mango's AI records remain in PostgreSQL. A stopped run is not automatically executed again.

Do not delete the named volume to fix a startup error: it contains the native Hermes history. The volume cannot be rebound to a different company or user.

## If startup fails

| Failure | Next step |
| --- | --- |
| Docker is missing or its engine is unavailable | Install/start Docker Desktop with Linux containers, then rerun the launcher. |
| `mangorts-hermes:693641aa` is missing | Run the image build in step 1. |
| Company/user scope is missing or invalid | Save both exact Mango UUIDs from step 3 or pass both launch parameters. |
| SSO session expired or Secrets Manager access denied | Sign into `mangorts-dev` again; if access is still denied, have the dev account administrator check the reported permission. Do not paste credentials into chat or files. |
| `ai_not_configured_for_account` | Match the signed-in Mango user and selected company to the configured UUID pair. |
| Missing `ai_*` relation | Run the DBeaver preflight and follow its result before enabling the route. |
| Native volume scope mismatch | Use the original company/user pair and its matching volume. Do not clear or rebind it. |

The launcher does not create scheduled jobs, provision cloud Hermes infrastructure, or apply live database changes. See [Hermes runtime details](../../hermes/README.md) for the native API and persistence contract.
