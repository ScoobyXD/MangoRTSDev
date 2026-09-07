# Run Mango with Hermes locally on Windows

Use the existing Cognito backend launcher. Once the one-time setup below is complete, it starts one shared Hermes container and the Go API together. It already runs `go run ./cmd/miraeopus-api`; a second `go run` is unnecessary. The gateway serves a separate native profile for every existing company/user membership in the development database.

This guide assumes the existing Mango frontend, AWS `mangorts-dev` SSO profile, and cloud-development backend configuration already work. The broader [Windows laptop setup](hermes-windows-zero-to-mangorts.md) covers the base environment. Hermes requires the PostgreSQL-backed API; the in-memory local mode does not enable it.

## 1. Prepare Docker once

Install and start Docker Desktop with Linux containers. Docker Desktop is a prerequisite for this local Hermes launcher; the launcher does not install it. An agent must obtain explicit approval before installing it.

From the checkout containing the launcher changes:

```powershell
cd C:\Users\Jonat\MangoRTSDev
docker info
```

The launcher builds `mangorts-hermes:693641aa` from its own checkout on every start, using Docker's normal cache. This keeps the Mango plugin and entrypoint current even when that image tag already exists. The build must succeed before the launcher retrieves application credentials or stops the backend.

## 2. Check the development database once

In DBeaver, select the Mango **development** database and run [hermes_ai_storage_preflight.sql](../../scripts/hermes_ai_storage_preflight.sql). This is read-only and reports the connected PostgreSQL version plus each AI table's exact column set and count. Physical column order does not matter.

- `READY-existing`: the four existing tables have the expected columns. Continue without rerunning the migration. This is a column check, not a full constraint/index audit; the tables must have been created from the reviewed migration.
- `READY-migrate`: a human operator must run [20260907_hermes_action_receipts.sql](../../backend/db/migrations/20260907_hermes_action_receipts.sql) in DBeaver, then rerun the preflight and obtain `READY-existing`.
- `STOP`: do not run the migration or enable Hermes. Inspect the reported unsupported version, missing Mango identity tables, partial AI setup, or conflicting existing table first. An older `ai_runs` archive must not be overwritten.

The supported server versions are PostgreSQL 17.x and 18.x; development uses 17.7. Jonat has already applied this AI migration to the development database; do not rerun it when the preflight reports `READY-existing`. Neither the launcher nor an agent applies the migration to a live database.

## 3. Select your Mango account once

Save your Mango sign-in email in the existing ignored file `scripts/start_local_cognito_backend.local.ps1`. This value is nonsecret; preserve any other settings already in that file:

```powershell
$MangoLocalHermesEmail = 'jonathankim829@gmail.com'
```

The launcher looks up the exact existing Mango user and company with a read-only query. One company is selected automatically. If the account has several companies, choose one from the numbered list. The launcher remembers that company in the same local settings file and rechecks membership on every start. You do not need to find or copy UUIDs. An email matching multiple user identities stops startup instead of guessing.

This selected account verifies startup and identifies its previous local container when upgrading. The same read-only query loads all existing company/user memberships for the shared gateway. Mango's authenticated backend chooses the profile and checks current membership on each request. Changing company in Mango selects a separate profile; model arguments cannot select another company or user. Restart the launcher after creating a new membership so the gateway loads its profile.

Before the first switch from per-account containers, finish or explicitly Stop all active Mango AI runs in the current app. The lookup also counts nonterminal `ai_runs` and refuses the first shared-volume startup while any remain. Native run ownership from an old listener cannot transfer to the new shared listener; old native files remain intact. This one-time check does not block recovery during later shared-gateway restarts.

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

Keep this terminal open. The launcher starts the single `mangorts-hermes` container, supplies all membership routes to Go, and runs the API on port 8080. Hermes listens only on host loopback port 8642. The native route is `/p/<profile>/v1/runs`; each profile name concatenates the exact company UUID and user UUID without hyphens. Container callbacks reach the API through `host.docker.internal:8080`.

The application process retrieves only the authorized development OpenAI secret for Hermes through your SSO profile. It sends the provider key and two stable service seeds to the container through standard input. Go and Hermes derive distinct API and callback credentials for each profile from those seeds. Secret values are not command-line arguments, Docker configuration environment values, or an environment file. You do not need to copy an OpenAI key into a local config file. Existing backend AWS and database configuration still applies. Agents must not run this full launcher because it loads the application's database and cloud credentials; use the isolated fixture checks below for agent verification.

On the first shared startup, the launcher saves only the two service seeds in `%LOCALAPPDATA%\MangoRTS\Hermes\service-seeds.dpapi`, encrypted with Windows DPAPI for the current Windows user. Every checkout uses this same protected file. The OpenAI key and integration credentials are never saved there. Native run ownership includes the API key, so the seeds must remain unchanged across restarts. Keep the protected file with the Windows-user backup; missing or unreadable credentials stop an existing gateway instead of silently replacing its identity. Cloud deployments likewise require stable service seeds supplied from Secrets Manager rather than generating them at each process start.

If the human launch process already has an approved `MANGO_INTEGRATION_SECRETS` JSON value, the launcher passes it through the same private stdin pipe. It does not persist that value or add it to Docker environment arguments. See [integration setup](hermes-integrations.md) for its per-profile account binding and provider prerequisites.

In a second terminal, start the existing frontend:

```powershell
cd C:\Users\Jonat\MangoRTSDev\frontend
npm run dev
```

Open `http://localhost:5173`, sign into Mango, select a company, and open the AI panel. Start with “List the Processes I can access.” A successful reply verifies the actual provider and Mango read path. Creating or updating a Node is a real business action; request it only in the Process and Step where you intend to make the change. A successful startup probe verifies the native profile API and durable storage; it does not prove a provider account or integration is authorized.

## Stopping and starting again

Use Ctrl+C in the backend terminal. The launcher stops the shared container and retains the `mangorts-hermes` volume. New profiles keep native chats, memory, configuration, skills, session SQLite databases and pending history under `/data/profiles/<profile>`. The listener keeps its native run-acceptance registry at `/data/runs_idempotency.db`, with separate ownership for each profile. Mango's AI records remain in PostgreSQL. A stopped run is not automatically executed again.

Each launcher records its own container launch ID. Cleanup verifies that label and stops the exact inspected Docker container ID, so an older or failed launcher cannot stop a newer replacement with the same shared name. Explicit `-StopExisting` also stops only the inspected owned container ID.

The launcher removes its stopped container explicitly while retaining every named volume. If startup fails, it first prints the last 30 log lines from that same verified container. An early exit also reports Docker's exit code; container output remains available until this cleanup finishes.

Existing per-account volumes named `mangorts-hermes-<company_id>-<user_id>` are retained and mounted directly at their matching `/data/profiles/<profile>` path inside this same container. Their files are not copied, moved, reset or assigned to another identity. The old `mango-scope.json` must match the exact pair. The shared root also records each profile's volume source and refuses a later source change, which prevents an older volume from hiding newer private state.

On the first transition, `-StopExisting` can stop the selected account's owned old container and the owned shared container. If another account's old local Hermes container is still running, startup reports its name and stops. Stop that container in Docker Desktop while retaining its volume, then rerun the launcher. The launcher never starts a second Hermes gateway alongside it.

Do not delete any of these named volumes to fix a startup error: they contain native Hermes history. A volume or profile cannot be rebound to a different company or user. Removing a membership denies Mango access and leaves native data retained; it does not delete private history.

## If startup fails

| Failure | Next step |
| --- | --- |
| Docker is missing or its engine is unavailable | Install/start Docker Desktop with Linux containers, then rerun the launcher. |
| Hermes image build fails | Resolve the Docker build error shown in the terminal, then rerun the launcher. Application credentials have not been loaded and the backend has not been stopped. |
| Mango account is missing or ambiguous | Check the sign-in email and selected development database. An administrator must resolve duplicate user identities; the launcher never picks one arbitrarily. |
| SSO session expired or Secrets Manager access denied | Sign into `mangorts-dev` again; if access is still denied, have the dev account administrator check the reported permission. Do not paste credentials into chat or files. |
| `ai_not_configured_for_account` | Confirm the signed-in Mango user has the selected company membership, then restart the launcher to load any newly added memberships. |
| Missing `ai_*` relation | Run the DBeaver preflight and follow its result before enabling the route. |
| Native volume scope or volume-source mismatch | Preserve the original company/user pair and recorded source volume. Do not clear, replace or rebind it. |
| Other local Hermes containers are running | Stop the named old container in Docker Desktop without removing its volume, then rerun the launcher. |
| Active AI runs block the first shared startup | Finish or explicitly Stop those runs in the currently running Mango app before the one-time cutover. |
| Encrypted service credentials are missing or unreadable | Restore the matching `service-seeds.dpapi` file under the original Windows user profile. Do not replace the seeds or delete the native volume. |
| `Hermes startup failed (PermissionError)` | Check directory ownership. Hermes runs as UID/GID `10001:10001`; the shared `/data/profiles` parent must allow that user to create new membership profiles. |

A failed launch with the old image can leave the shared volume's `profiles` directory owned by `root` with mode `0755`. Rebuilding the image does not change ownership inside an existing volume. If inspection confirms this exact condition, stop Hermes and correct ownership of only that parent directory to `10001:10001`. Do not recursively change private profiles or delete any stored data. The current image already creates this directory with the correct owner in a fresh volume.

The launcher does not create scheduled jobs, provision cloud Hermes infrastructure, or apply live database changes. See [Hermes runtime details](../../hermes/README.md) for the native API and persistence contract.

## Repair missing saved chat history explicitly

When an existing native chat is missing from Mango's saved history, request recovery with this one-time startup option:

```powershell
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting -RepairHermesHistory
```

The read-only lookup selects exact existing company/user, admitted native run ID and chat ID tuples for terminal runs without a `run.finished` or `history.recovered` marker. It requires current membership and sends these identifiers through private stdin. Before the gateway starts, recovery queues each existing visible native transcript for the normal durable history delivery path. Mango records a distinct `history.recovered` marker after recovery succeeds. The operation copies existing transcript data without invoking the model or running business actions.

Normal startup leaves recovery disabled. An oversized recovery request stops with an error instead of truncating the selected records. The first shared-gateway cutover still requires active runs to finish or be explicitly stopped, as described above.

## Isolated launcher checks

These checks use fake volume metadata and disposable synthetic DPAPI credentials. They do not contact Docker, a database, a provider or AWS, and never read the real credential store:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/test_local_hermes.ps1
pwsh -NoLogo -NoProfile -File scripts/test_local_hermes.ps1
```

The shared layout follows Hermes's [multi-profile gateway](https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways) and [native profile](https://hermes-agent.nousresearch.com/docs/user-guide/profiles) conventions. Mango pins the implementation at commit `693641aa8b4359c602283bdbbc14041e03bc47bc`.

## Existing failure investigation

Read-only checks on September 7, 2026 found that the running container's installed Mango tool and history modules matched the starting repository version. Its callback origin was reachable: `/healthz` returned 200 and an unauthenticated GET to `/internal/hermes/history` returned the expected 405. Native SQLite contained one known callback transport-or-invalid-JSON tool error and one unclassified non-JSON result; the history delivery queue was empty. Only known error categories, status codes and counts were reported, without chat contents or credentials. These checks do not prove the exact cause of the earlier failed Process listing or history-sync message, and they do not verify live execution of the updated image.
