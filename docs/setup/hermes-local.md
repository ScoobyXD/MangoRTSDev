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

Save your Mango sign-in email in the existing ignored file `scripts/start_local_cognito_backend.local.ps1`. This value is nonsecret; preserve any other settings already in that file:

```powershell
$MangoLocalHermesEmail = 'jonathankim829@gmail.com'
```

The launcher looks up the exact existing Mango user and company with a read-only query. One company is selected automatically. If the account has several companies, choose one from the numbered list. The launcher remembers that company in the same local settings file and rechecks membership on every start. You do not need to find or copy UUIDs. An email matching multiple user identities stops startup instead of guessing.

Alternatively, provide an email on the command line:

```powershell
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting `
  -HermesEmail 'jonathankim829@gmail.com'
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
| Mango account is missing or ambiguous | Check the sign-in email and selected development database. An administrator must resolve duplicate user identities; the launcher never picks one arbitrarily. |
| SSO session expired or Secrets Manager access denied | Sign into `mangorts-dev` again; if access is still denied, have the dev account administrator check the reported permission. Do not paste credentials into chat or files. |
| `ai_not_configured_for_account` | Match the signed-in Mango user and selected company to the configured UUID pair. |
| Missing `ai_*` relation | Run the DBeaver preflight and follow its result before enabling the route. |
| Native volume scope mismatch | Use the original company/user pair and its matching volume. Do not clear or rebind it. |

The launcher does not create scheduled jobs, provision cloud Hermes infrastructure, or apply live database changes. See [Hermes runtime details](../../hermes/README.md) for the native API and persistence contract.
