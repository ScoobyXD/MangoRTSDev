# Mango Hermes runtime

One container runs the pinned native Hermes gateway, serving one private profile for each exact existing Mango company/user pair. Built-in business capabilities are **Mango tools**; connected providers are **integrations**. These integrations use MCP where the provider actually supports MCP.

Reviewed upstream: `693641aa8b4359c602283bdbbc14041e03bc47bc`. The image installs its frozen dependencies, including the MCP extra. No new agent server or per-user container is introduced.

## Start locally

Follow [local startup](../docs/setup/hermes-local.md). A human operator runs the existing launcher:

```powershell
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting
```

Do not rerun `20260907_hermes_action_receipts.sql`: Jonat reports it already applied. This change adds no database migration. Agents must not run the full launcher because it retrieves application runtime secrets.

The launcher keeps the working Docker discovery and authenticated account lookup. Before loading application credentials or stopping the backend, it builds `mangorts-hermes:693641aa` from its own checkout with Docker's normal cache, so an existing tag cannot silently run older Mango code. It reads existing company memberships, starts fixed container `mangorts-hermes`, and gives Go the exact profile routes. Finish or Stop existing runs before the first transition. The launcher refuses unsafe cutover while nonterminal Mango runs exist.

After successful startup, Ctrl+C stops Go while Hermes remains running. In the same PowerShell terminal, change to `backend` and use `go run ./cmd/miraeopus-api` for subsequent backend restarts. The terminal retains its existing connection environment; a new terminal needs the launcher again. Stop Hermes explicitly with `docker stop mangorts-hermes`, preserving its volumes.

Existing volumes named `mangorts-hermes-<company UUID>-<user UUID>` mount directly at `/data/profiles/<profile>` in the shared container. Other new profiles live inside the shared `/data` volume. No private state is copied, deleted or reassigned. The persistent `mango-gateway.json` records each source volume and the gateway API credential fingerprint, rejecting later volume remapping or a different API credential. Retain both shared and original volumes in backups.

## Identity and credentials

A profile name is exactly `company_id.hex + user_id.hex` (64 characters); `mango-scope.json` retains both canonical UUIDs. Mango's authenticated backend selects the route and rechecks current membership and business permissions. Model arguments cannot choose the profile, company, user, credentials or callback endpoint.

Every Go route uses the same service origin. Requests go to `/p/<profile>/v1/runs` and other native profile routes. Service and callback credentials are separately derived using HMAC-SHA256 from the shared runtime seeds and exact profile name. The native `mango_runtime` secret source resolves those credentials in memory through Hermes's supported source registry. It never switches process-global tenant state.

Windows service seeds persist encrypted at `%LOCALAPPDATA%/MangoRTS/Hermes/service-seeds.dpapi` under the current Windows user's DPAPI identity. Protect and retain this file with the volumes: native durable run ownership includes the API credential. An existing shared volume with missing or unreadable seeds must stop startup rather than regenerate them. The provider key is never persisted there.

Deployment environment:

| Variable | Meaning |
| --- | --- |
| `HERMES_HOME` | Shared root; `/data` in the image |
| `MANGO_HERMES_PROFILES` | JSON array of exact `{company_id,user_id}` pairs |
| `MANGO_HERMES_PROFILE_VOLUMES` | JSON object from profile name to original volume name, or null for shared-volume storage |
| `MANGO_CALLBACK_URL` | Private Go origin ending in `/internal/hermes/actions` |
| `MANGO_HERMES_MODEL` | Initial default model; native saved per-profile model settings persist |
| `API_SERVER_KEY` | Stable gateway API seed, at least 32 characters |
| `MANGO_CALLBACK_KEY` | Different stable callback seed, at least 32 characters |
| `MANGO_INTEGRATION_SECRETS` | Optional runtime JSON object keyed by exact profile name, containing only `MANGO_INTEGRATION_*` credential references |

Local `--runtime-stdin` receives the model key and two service seeds in one bounded private JSON line, plus optional `MANGO_INTEGRATION_SECRETS` as a JSON string. No credentials enter Docker arguments or persistent plaintext configuration. The human launcher may obtain integration values from the approved secret manager into its process environment. Native OAuth tokens stay in native per-profile authorization storage; do not copy Codex connector credentials into Mango.

Cloud startup still requires separately provisioned stable runtime secrets, a narrowly scoped role for the configured OpenAI secret, persistent storage and a private service network. No cloud resources are provisioned or changed here. Do not mount AWS host credentials, database credentials or the Docker socket. Run the image as user 10001 with a read-only root filesystem, private writable `/tmp`, dropped capabilities and no-new-privileges. Publish local port 8642 only on loopback; browsers use the Mango API.

Go's `MANGORTS_HERMES_ROUTES` remains a JSON array of `{company_id,user_id,url,api_key_env,callback_key_env}`. All entries must share one origin and the same injected seed values. An empty route list leaves ordinary Mango available. Proxy forwarding and credential-bearing redirects remain disabled.

## Native state and execution

Each profile retains native `state.db`, sessions, response data, configuration, memory, learned skills and OAuth state. Mango's transcript callback queue is `mango_history_outbox.db` in that profile. The one listener's native `runs_idempotency.db` lives at the shared root; it scopes admission by native profile and stable credential. Old per-user admission databases remain untouched in the original volumes, but their old unprefixed execution ownership is not translated into new runs.

Hooks use the current native home and session ContextVars. Session DB handles, FIFO queues and transient hook state are profile-specific. Each background delivery worker captures the correct profile credential before starting, retries lost acknowledgements, and restarts even if that profile has no new browser request. Snapshots preserve native integer message IDs and visible text; native `assistant` is translated to Mango `ai` only at the boundary. Reasoning, credentials and raw tool payloads are not imported.

For an older terminal run whose transcript never reached Mango, a human may add `-RepairHermesHistory` to the launcher. It selects exact admitted terminal runs with missing completion markers and queues the current native display snapshot before starting the gateway. Native SQLite opens read-only, including compacted visible messages. A new `history.recovered` marker follows the complete snapshot; it does not invent the original execution events or run the AI again. Previously rejected history requires operator review and is never silently unparked. After delivery, Resume refreshes the saved transcript.

Go admits one active run per company/user, requires native durable idempotency, and binds callbacks to its exact saved run. A lost native execution becomes interrupted without automatic re-execution. Stop closes action admission before cancelling native work. Committed business results remain committed.

Mango tools search accessible resources by partial name using the universal picker's existing Company Explorer search, including folders and visible location paths. Hermes uses returned exact IDs internally and asks about names or locations when matches remain ambiguous. Tools create and name Processes, place them in folders, create Steps, create/update/move Nodes, post an ordinary Node textbox chat, read/save editor documents and create Node/Project textboxes. They reuse canonical commands and permission rules. Every mutation, its `ai_actions` receipt and history event commit atomically. A repeated action returns its saved result without overwriting subsequent manual changes. No delete tool exists. See [Mango tool laws](../docs/tests/mango-tools.md).

For a requested Step visit, Hermes can move the Node and create its textbox using the existing actions. This does not install a trigger for future Step entries. Dictation continues to fill the existing draft; explicit Send starts Hermes. These tools add no separate speech pipeline or frontend API.

Native memory, skill learning and web search/extraction are enabled. Skills are instructions; their presence grants no tool or account access. General shell/filesystem, delegation and scheduled work are outside this implementation. Private provider setup and exact prerequisites are in [integration setup](../docs/setup/hermes-integrations.md). A configured server is not automatically advertised as authorized, callable or execution-verified.

## Verification

```sh
python -m unittest discover -s hermes/tests -p 'test_*.py'
python hermes/tests/native_smoke.py --source /path/to/pinned/hermes-agent
python hermes/tests/native_smoke.py --source /path/to/pinned/hermes-agent --go-integration
python hermes/tests/native_integrations_smoke.py --source /path/to/pinned/hermes-agent
python hermes/tests/native_recovery_smoke.py --source /path/to/pinned/hermes-agent
```

Use the pinned Python environment with the installed Mango plugin and MCP dependency. Run Go tests through WSL Ubuntu on Windows. The native gateway smoke supports `--go-test-binary` for an isolated Linux HTTP fixture built with `go test -c`. Tests can run inside a disposable container with networking disabled and only this repository's Hermes source mounted read-only.

The shared smoke exercises concurrent profiles, cross-profile credential rejection, tool callbacks, separate transcripts/memory/skills, detached history delivery, Stop and restart replay. The native-to-Go fixture verifies authenticated Process listing and Node creation with retry receipts, then partial-name Folder search, Process creation/rename/placement, Step creation, and Node/textbox/chat creation using exact IDs returned by preceding tools. It uses a scripted model and in-memory business storage, so it does not verify real-model name resolution or live dictation. MCP fixtures test real native discovery/dispatch against two loopback account servers and reject cross-profile calls. Public anonymous web checks are separate from private provider verification; private provider business operations require the user's own OAuth setup and a permitted live check.

Sources: [native profile multiplexing](https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways), [profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles), [reviewed implementation](https://github.com/NousResearch/hermes-agent/tree/693641aa8b4359c602283bdbbc14041e03bc47bc).
