# Mango Hermes HTTP runtime

This directory packages the upstream Hermes HTTP gateway and one supported tools plugin. It does not wrap `AIAgent` in a new server. Reviewed upstream: **0.21.0**, commit **693641aa8b4359c602283bdbbc14041e03bc47bc**. The image installs that revision's frozen `uv.lock`.

One private container serves one exact Mango **company + user**. The Go backend owns the route mapping, authenticates the user, checks company membership, and refuses an unconfigured scope. Enabling routes requires PostgreSQL and the repository AI storage migration; the production application refuses the in-memory repository for this feature. Provision a different private URL, API credential, callback credential, and persistent `/data` volume for every pair. Do not mount another tenant's home, host files, AWS writer credentials, or Docker socket into this container. Only Go may reach port 8642; browser clients use Mango's existing API.

## Runtime configuration

For this Windows laptop, follow [local startup](../docs/setup/hermes-local.md). The existing Cognito launcher can start the pinned container and Go together after the one-time Docker image, scope configuration and operator-run SQL setup.

Build from the repository root:

```sh
docker build -t mangorts-hermes:693641aa hermes
```

Supply these environment variables through the deployment runtime:

| Variable | Value |
| --- | --- |
| `MANGO_COMPANY_ID` | Exact provisioned company UUID |
| `MANGO_USER_ID` | Exact provisioned user UUID |
| `API_SERVER_KEY` | Unique secret, at least 32 characters; shared only with that Go route |
| `MANGO_CALLBACK_KEY` | Different unique secret, at least 32 characters; shared only with that Go route |
| `MANGO_CALLBACK_URL` | Private Go URL ending in `/internal/hermes/actions` |
| `MANGO_HERMES_MODEL` | Optional; defaults to `gpt-5.4-mini-2026-03-17` |

`HERMES_HOME=/data` is set in the image. Mount a new empty persistent volume there, owned by UID/GID 10001. Startup records the pair in `mango-scope.json`, rejects a volume already bound to another pair, and rejects existing unbound contents. It also rejects alternate `gateway.json`, `.env`, `.op.env`, and nondefault or linked `active_profile` files, forces the documented supervised gateway mode, and disables profile multiplexing so native startup cannot switch away from the verified home or overwrite injected credentials. Managed overlays (HERMES_MANAGED_DIR or /etc/hermes) are unsupported and rejected. Reuse the same pair and volume across restarts. Run with a read-only image filesystem, a private writable `/tmp`, dropped capabilities, and no-new-privileges. Use persistent local/block storage suitable for SQLite WAL; network filesystem assumptions require separate verification.

Startup resolves only the authorized development OpenAI secret `arn:aws:secretsmanager:us-west-1:686458136219:secret:mangorts/dev/openai-api-key-EaABNe`. It accepts a raw `SecretString` or the existing named JSON properties `api_key`, `openai_api_key`, or `OPENAI_API_KEY`, and rejects unknown JSON objects. It pins the provider destination to https://api.openai.com/v1, keeps the result in process environment for the native provider, and never writes it into configuration. The local launcher uses `mangorts-dev` SSO outside the container; cloud startup requires an infrastructure-provisioned task role limited to this ARN. Do not copy keys into `.env` files. The local launcher generates the two service credentials and Go route for that launch. Cloud secrets, roles, routes, and services still require separate provisioning.

The generated native config selects `openai-api`, whose pinned upstream transport is OpenAI Responses. It enables only native `memory`, `skills`, `session_search`, and the `mango` toolset. The documented `tools.tool_search.enabled=off` setting keeps this small tool catalog directly available. Native Markdown memory curation and learning stay enabled. Shell, general file access, browser, external search, delegation, MCP, and cron tools are absent from the selected model toolset. Learned skill text can guide these allowed tools; it cannot grant new tools or Mango authority. Native cron storage remains in the home, but scheduled work is a later layer and Mango exposes no job routes.

Configure the Go API's `MANGORTS_HERMES_ROUTES` with this JSON shape. Use the actual Mango `user_id` returned by authenticated `/v1/me` and the selected company ID, not the Cognito subject. The example IDs must be replaced. Environment names refer to separately injected secrets; this JSON contains no credentials.

```json
[
  {
    "company_id": "11111111-1111-4111-8111-111111111111",
    "user_id": "22222222-2222-4222-8222-222222222222",
    "url": "http://hermes-private-user:8642",
    "api_key_env": "MANGORTS_HERMES_USER_API_KEY",
    "callback_key_env": "MANGORTS_HERMES_USER_CALLBACK_KEY"
  }
]
```

Inject the same service credential into the Go environment name and that service's `API_SERVER_KEY`; do the same for the separate callback credential. Go rejects reused scopes, URLs and credentials. The route URL, container scope variables and volume binding must describe the same pair. An empty route list leaves the rest of Mango available. HTTP URLs require a private service network; use TLS when crossing a network boundary. Service and callback requests ignore process proxy settings and reject redirects. No raw Hermes endpoint is exposed through Mango beyond the listed chat operations.

The local launcher runs this same image with `--runtime-stdin`. It supplies one bounded JSON line containing `OPENAI_API_KEY`, `API_SERVER_KEY`, and `MANGO_CALLBACK_KEY` through a private pipe. This mode does not load AWS credentials or call Secrets Manager inside Hermes. The human-run launcher resolves the authorized dev provider secret and keeps the matching service credentials in Go's process environment. No credential values enter Docker arguments, Docker configuration environment values, or local files. Cloud startup without this argument retains the runtime-role Secrets Manager lookup.

## Verified upstream boundaries

| Native data | Persistent path under the one scoped home |
| --- | --- |
| Curated memory | `memories/MEMORY.md`, `memories/USER.md` |
| Learned skills | `skills/` |
| Sessions and transcript | `state.db`, native session sidecars under `sessions/` |
| Responses continuity | `response_store.db` |
| Run acceptance deduplication | `runs_idempotency.db` |
| Pending Mango history delivery | `mango_history_outbox.db` |
| Cron definitions/output | `cron/jobs.json`, `cron/output/` |

These paths were checked in the pinned source (`hermes_constants.py`, `hermes_state.py`, `tools/memory_tool.py`, `tools/skill_manager_tool.py`, `gateway/platforms/api_server.py`, `gateway/platforms/api_server_run_idempotency.py`, and `cron/jobs.py`). A session ID alone does not isolate them. The complete home is the persistence boundary, and the dedicated container is the filesystem/process boundary. No native storage is replaced by PostgreSQL.

`POST /v1/runs` accepts `input`, `session_id`, and an `Idempotency-Key` header. Reusing the same key and request returns the original run, including after restart. Native retention is 24 hours after the last status update; Mango's action results and run record have their own durable backend checks. Before admitting a run, Go requires `/v1/capabilities` to report `features.runs_idempotency.durable=true`. Upstream can otherwise fall back to memory on storage failure.

`GET /v1/runs/{id}/events` emits data-only SSE JSON with `event`, `run_id`, and `timestamp`. Reply text arrives as `message.delta` with `delta`; completion carries `run.completed` with `output` and `usage`. The queue has one consumer, expires, and has no replay cursor. Go holds a scoped PostgreSQL advisory lock while consuming it, so another browser or API replica cannot steal events. Each active stream occupies one database connection; provision pool capacity for these streams as well as ordinary Mango commands. Collapsing the panel releases observation while leaving the run saved. Reconnection uses the saved local run and Mango's imported visible messages; a still-running response whose native stream has already closed requires another explicit Resume to obtain its eventual saved output. A restarted run is marked interrupted and is never automatically executed again. Stop prevents new Mango actions; a committed action remains committed.

The native Runs implementation binds `HERMES_SESSION_KEY` to its generated run ID and `HERMES_SESSION_ID` to the active transcript via `gateway.session_context` ContextVars. Supported `tool_execution` middleware supplies the runtime tool-call ID. The plugin captures these outside model arguments. Its handler itself rejects absent or mismatched context, so Hermes' fail-open middleware handling cannot authorize a callback. It sends only these identifiers, a fixed action name, and the action's typed arguments to the fixed Go endpoint. Go independently binds the callback credential to the pair, validates the accepted run and current membership/permissions, and owns durable action deduplication.

The first business tools list visible Processes, read an existing Process with its Steps/Nodes, and create a Node in one existing Step. Actor/company never appear in model tool schemas. Node creation uses the existing Go business command and required Process rules. Identical creation arguments within one run reuse the committed Node even if the model repeats the call with a new tool-call ID.

## Checks and rollout

```sh
# Use the pinned upstream Python environment, then install this local package.
uv pip install --python /path/to/pinned/hermes-agent/.venv/bin/python --no-deps ./hermes
python -m unittest discover -s hermes/tests -v
python hermes/tests/native_smoke.py --source /path/to/pinned/hermes-agent
python hermes/tests/native_smoke.py --source /path/to/pinned/hermes-agent --go-integration
```

Run the smoke with the pinned upstream virtual environment and installed Mango plugin. It enters the native `hermes gateway` CLI against loopback-only fake OpenAI and Go endpoints with fresh temporary homes, so no paid model, AWS secret, or live database is used. It checks native streaming, plugin action metadata, memory and learned-skill persistence, cancellation, transcript persistence, restart replay, and separate homes. The optional `--go-integration` mode invokes the real Go HTTP handlers and existing Node command in an isolated in-memory test fixture. On Windows, run both Python and Go inside WSL Ubuntu to keep communication on loopback. The deployment must also pass a human-authorized real provider check and the Go readiness checks before enabling a route.

Supported native hooks (`pre_llm_call`, API request hooks, `post_llm_call`, `on_session_end`) and tool middleware observe model calls, all allowed tools and the final reply. Before delivery, the plugin saves a stable event ID and serialized callback in `mango_history_outbox.db` using SQLite. One FIFO worker sends it to `/internal/hermes/history` at the configured callback origin with the same private credential, retries lost acknowledgements and resumes queued delivery after restart. The hook queue never depends on a browser event subscriber. The final callback confirms native terminal status and uses ordinary delivery retries while execution is still finishing. Unknown native IDs wait for exact admission binding; chat identity alone is insufficient. Definitively rejected observations retain their payload and rejection status in this same SQLite table for operator inspection; the worker parks every event for that run, including later snapshot markers, and continues later healthy runs. Parked observations are never silently deleted or automatically replayed. Include this file in any future complete-home backup.

Visible transcript snapshots run once for the initial input and once when the run finishes. Tool callbacks append their observations without rereading the entire chat. Snapshots use Hermes's decoded display projection and exact integer message IDs. Serialized snapshot batches are acknowledged before their complete-ID marker prunes obsolete copied representations. Native `assistant` becomes Mango `ai`; tool payloads and reasoning are excluded. Native message rows lack per-run provenance, so their optional Mango run link remains empty rather than guessing from timestamps or equal text. Final reply and execution observations still belong to the exact run. A visible message exceeding the callback batch limit remains native and logs a generic capture failure without pruning a partial snapshot.

Initial implementation verification passed 34 frontend/dictation tests, TypeScript, 15 focused Go HTTP tests, six Memory and eight disposable PostgreSQL AI contracts, migration checks, 24 runtime unit tests, and both native smoke modes. The native tests verify completion and imported messages without an SSE subscriber, retrying callback delivery, existing Node creation, duplicate protection, Stop and restart persistence.

The subsequent simplicity review passed 22 focused frontend tests, TypeScript, focused Go HTTP and Memory/PostgreSQL checks, 24 runtime unit tests and the native-to-Go fixture using this worktree's plugin source. It removed per-tool full-transcript copying and unchanged run writes, batched message reads and verified exact active-chat recovery.

One standalone native smoke attempt returned an unexplained empty model response; one repeat passed without a code change claimed to fix it. The runtime tests use local fake services. Live provider calls and cloud service provisioning require separate rollout verification.

Before enabling routes, a human operator must apply [20260907_hermes_action_receipts.sql](../backend/db/migrations/20260907_hermes_action_receipts.sql). It adds `ai_chats`, `ai_messages`, `ai_runs` and the shared `ai_actions` table. Every row carries the exact company and user. Chats use `name`; visible message roles are `user`/`ai`; local runs keep one `status` and JSON `history`. Each committed action stores its JSON `result` under `(company_id, user_id, run_id, action_name, action_key)`. See the [complete columns and examples](../docs/ai-data-structure-proposal.md). It does not alter native Hermes storage or existing resource relationships. The SQL supports PostgreSQL 17.x (the dev database is 17.7); isolated tests also use PostgreSQL 18. Run this read-only preflight directly in DBeaver and proceed only after READY:

```sql
SELECT current_setting('server_version') AS postgres_version,
       CASE WHEN current_setting('server_version_num')::integer >= 170000
                  AND current_setting('server_version_num')::integer < 190000
                  AND to_regclass('public.ai_chats') IS NULL
                  AND to_regclass('public.ai_messages') IS NULL
                  AND to_regclass('public.ai_runs') IS NULL
                  AND to_regclass('public.ai_actions') IS NULL
            THEN 'READY: apply the AI storage migration'
            ELSE 'STOP: unsupported server version or AI tables already exist; inspect before applying'
       END AS migration_preflight;
```

Some older deployments may retain the removed AI inspection archive under `public.ai_runs`. Any existing table with that name must stop this migration for human inspection. This migration neither reuses nor converts the archive, and any live removal requires separate approval.

The local launcher received ad-hoc verification in Windows PowerShell 5.1 and PowerShell 7 using a fake Docker process and the actual runtime credential reader. These checks covered private stdin, matching route credentials, authenticated readiness and cleanup. PowerShell prerequisite probes and 14 runtime/plugin unit tests passed.

Docker Desktop 4.89.0 was subsequently installed for the Windows user with the existing WSL2 backend. The real `mangorts-hermes:693641aa` image built successfully after including `mango_history.py` in the Docker context and explicitly selecting the base image's Python 3.13; upstream's Python-version file otherwise selected an interpreter under root's inaccessible home. A disposable container with networking disabled passed authenticated native capabilities, durable SQLite, scoped home ownership as UID 10001 and both Mango plugin module checks. This verifies the actual image packaging and startup without provider credentials or a live database. The user's real account route and provider request still need application-level verification.

Cloud deployment and the live database migration remain separate human rollout actions. Local container startup is available through the documented Cognito launcher once Docker, the image, the exact account scope and SQL are prepared. Verified exports, private S3 backups, full native archive imports, shared memory and scheduled workflow execution remain later work. Scheduled jobs and runs are not implemented.

Sources: [native HTTP API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/), [plugin API](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/), [native memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/), [reviewed source revision](https://github.com/NousResearch/hermes-agent/tree/693641aa8b4359c602283bdbbc14041e03bc47bc).
