# Mango AI setup and operation

Mango AI uses OpenAI's managed Agents API with a user-selected reasoning model and GPT-Live with `gpt-live-1` for voice. New tasks default to `gpt-5.6-luna`; `gpt-5.6-terra`, `gpt-5.6-sol`, and `gpt-6-astra` are also selectable. The Go API supplies authorized app functions; the React panel supplies requests and explicit action decisions. Sessions use `environment.type=none`, so this feature requires no separate agent service, Docker container, sandbox executor, or Hermes installation. OpenAI manages the agent session and conversation context. See the [Agents overview](https://developers.openai.com/api/docs/guides/agents-api/overview).

## Before enabling it

1. Use an OpenAI Platform project with billing and access to the selected agent model. Its application key needs `api.agents.read`, `api.agents.write`, and `api.responses.write`. The backend sends `Authorization: Bearer` and `OpenAI-Beta: agents=v1` for Agents calls. These requirements come from the [Agents quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart). A choice in Mango's model list does not confirm project entitlement; provider rejection is reported without substituting another model.
2. For voice, confirm GPT-Live access for that project and paid usage Tier 1 or above; Free tier is unsupported. The browser needs microphone permission and HTTPS or localhost. Live creation uses the project key on the backend. See [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1) and [Live WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live).
3. Use Mango's authenticated sign-in and an existing company membership. AI deliberately rejects anonymous `AUTH_MODE=disabled` requests; simple local anonymous mode alone is insufficient for this feature.
4. Have a human apply the database change described below before using AI with the PostgreSQL repository. The app checks that its session store is available before starting billable agent or voice work.

## Backend credentials

The API runtime calls the existing `loadRuntimeSecret` helper with these two settings:

| Setting | Required value |
| --- | --- |
| `OPENAI_API_KEY` | The application key injected into the backend process; takes precedence when nonempty. |
| `OPENAI_API_KEY_SECRET_ARN` | An exact AWS Secrets Manager ARN used when `OPENAI_API_KEY` is empty. |
| `AWS_PROFILE` | The appropriate existing AWS SSO profile when resolving the ARN locally. |

The referenced secret must contain the key itself as a nonempty `SecretString`; the helper does not parse a JSON credential bundle. ARN resolution uses its AWS region and requires `secretsmanager:GetSecretValue` for that secret. Keep dev and prod profiles separate. Use approved secret injection or Secrets Manager, and never put production keys in frontend variables, checked-in files, local plaintext files, or agent prompts.

The ordinary API still starts if both key settings are absent or secret resolution fails. Mango AI then reports that it is unavailable. After fixing the backend runtime configuration, restart that API process through the usual operator workflow so it loads the key. Deepgram retains its separate configuration and transcription path. No OpenAI key is sent to the browser; voice creation returns only the Live session ID and SDP answer.

## Human-controlled database rollout

For an existing database, review [20260911_openai_agent_sessions.sql](../backend/db/migrations/20260911_openai_agent_sessions.sql) through the [existing migration process](infra/mangorts-database-migrations.md). It reports the connected server version and stops outside PostgreSQL 17 and 18; PostgreSQL 17.7 is supported. Apply it once through the human-controlled migration workflow that records applied history. Application startup does not apply it. The matching definitions in [schema.sql](../backend/db/schema.sql) are for the canonical schema; do not execute the full schema over an existing application database.

The new objects are:

| Object | Stored data |
| --- | --- |
| `ai_agent_sessions` | Exact provider session ID; company/user owner; prompt and instructions as text; skills as JSON; stopped state; `awaiting_turn_after`; creation time. |
| `ai_agent_sessions_owner_idx` | Owner-scoped session listing by company, user, and creation time. |
| `ai_agent_tool_calls` | Exact session/turn/call identity; immutable tool name and arguments; approval category; execution state; result JSON or error text. |

The schema adds no AI relationship to a Process, Step, Node, email, or other ordinary resource. Existing business commands continue to own those records. Company or user deletion cascades app session records, and session deletion cascades receipts. Removing membership denies access without pretending that provider history was erased.

The optional [retire_ai_storage.sql](../scripts/retire_ai_storage.sql) still targets only `ai_actions`, `ai_messages`, `ai_runs`, `ai_chats`, and the exact `20260907_hermes_action_receipts.sql` history row. It does not target the new names. Do not assume it ran. A remaining history entry absent from the repository still blocks the migration planner; a human must investigate and use the already scoped legacy cleanup only when authorized. Do not disable that blocker, mark arbitrary migrations applied, or restore legacy readers. No agent applies either script to a database.

## Using typed requests and voice

Open **Mango AI** in the sidebar. Choose **New task**, select the **Task model**, expand **Instructions and skills**, and enter the workflow guidance before sending the first request. Each task accepts up to eight named skills; these are task-local text instructions, not executable packages. Start a new task to change its model or guidance. The selected model is also used when voice starts a new delegated task. New task resets to Luna instead of inheriting a previous task's more expensive model.

The backend supplies the model choices and default with the existing session-list response. Task creation requires an explicit allowed model. OpenAI already persists that model in the session configuration, which Mango reads for saved-task display; this selector requires no additional database table, column, or migration. Reasoning effort remains unspecified and uses provider behavior; there is no reasoning-level selector in this version.

For cost comparison, the [official model catalog](https://developers.openai.com/api/docs/models) lists these standard text-token rates as of September 11, 2026:

| Model | Input per million tokens | Output per million tokens |
| --- | --- | --- |
| GPT-5.6 Luna | $0.20 | $1.20 |
| GPT-5.6 Terra | $2.00 | $12.00 |
| GPT-5.6 Sol | $4.00 | $20.00 |
| GPT-6 Astra | $10.00 | $50.00 |

These are token rates, not a fixed task quote or spending cap. Context size, repeated reads and turns, reasoning output, caching, and provider pricing rules affect the total. Prompts over 272K input tokens use higher rates; consult the current [pricing documentation](https://developers.openai.com/api/docs/pricing). Voice remains GPT-Live and has its own charges regardless of the selected reasoning model. Compare results on representative workflows before relying on a cheaper model for complex work.

For example: “Review all of my emails, group them by our existing workflows, and explain the next step for each group.” The agent can enumerate the acting user's personal accounts, page through all provider-visible mail, read exact message bodies, and read accessible Processes, Step SOPs, flow connections, and Nodes. It can propose creating a Process Node, moving a Node into a Process/Step, or changing its status. Each proposed mutation pauses for **Approve this action** or **Reject**, with its exact arguments displayed.

This version does not read another user's mailbox, enumerate shared inboxes, analyze attachment contents, attach email to a resource, send email, delete business resources, change permissions, or execute arbitrary workflow code. It explains unavailable steps and waits for the user to perform them through existing app screens. Complete mailbox coverage requires every selected account's pages and message bodies; failures, remaining pages, provider synchronization uncertainty, and mail arriving during the scan must remain visible limits. Existing mailbox caching may return recent cached data during provider failures. Each captured app response is limited to 512 KiB: a larger message or Process view fails explicitly instead of supplying truncated content as a complete result.

Choose **Start voice** to start a Live WebRTC connection. Live uses client delegation to submit work through the same backend agent session; backend results return as brief spoken updates. Detailed workflow instructions stay with the reasoning agent, following the [Live delegation guide](https://developers.openai.com/api/docs/guides/live-delegation) and [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting). Spoken approval never replaces the panel's exact-action approval. **End voice** closes the conversation. Use the separate **Cancel task** control to cancel agent work.

## Progress, cancellation, and recovery

Provider rejection messages retain OpenAI's request ID when available. Known missing scopes, organization verification requirements, model access errors, and billing codes receive specific explanations; unknown HTTP 403 responses report only that OpenAI denied the request. Check both the saved key permissions and its service account's project role for missing scopes. Use the request ID with OpenAI support when the reason remains unknown. Raw provider response text is never saved or logged because it may contain private input or credentials. Fixing access does not prove that a workbook run has completed; verify its saved update history.

There is no AI scheduler or background app worker. After a user starts or continues work, the open panel calls `/advance` to handle pending read tools and refresh progress; mutations still require an action decision. Opening an existing task reads history only. Choose **Continue task** when available to resume handling app tools. Closing the panel stops those requests and ends voice, but OpenAI may finish the current reasoning turn. Use **Cancel task** to stop future app claims and request provider cancellation.

History snapshots load provider items incrementally in pages of ten and keep unfinished messages available for later updates. **Read progress** uses completed read-only receipt counts (`read_counts`); it does not repeatedly return mailbox bodies to the panel. Those counts show completed calls, not proof that all mail was analyzed.

Cancellation and deletion do not undo app commands that already committed. Stopped sessions reject follow-up requests; inspect the result and choose **New task** when ready. The stored `awaiting_turn_after` value prevents a previous completed turn from being mistaken for the result of a newly submitted follow-up. A definitive provider rejection clears that attempt's waiting state; transport failures remain uncertain and require inspection before resubmitting.

If a receipt remains **executing** after an interruption, its outcome may be unknown. Inspect the actual Process/Node before continuing. Do not clear the receipt or automatically repeat the command. Once the outcome is resolved, cancel the old task and start new work if needed. Completed, failed, and rejected receipts reuse their saved result when provider submission needs recovery. Requests have a 110-second backend deadline and a 120-second client timeout; a timeout does not prove that a mutation failed.

## Retention and deletion

OpenAI retains Agents session state and conversation history. Mango retains owner records, task instructions/skills, and execution receipts, whose outputs can contain retrieved data. The Agents API currently supports US data residency and does not support Zero Data Retention, including with a self-hosted environment. See the [Agents data controls](https://developers.openai.com/api/docs/guides/agents-api/overview).

Mango explicitly sets Live `store=false`, so it does not request a stored voice recording. That does not disable the separate Agents history: delegated transcript context and tool results can be part of that history. See [Live storage behavior](https://developers.openai.com/api/docs/guides/live-conversations#store-and-fork-a-session).

**Delete task and history** asks OpenAI to delete that exact session, then removes its Mango owner row and receipts. Retrying deletion finishes local cleanup if the provider confirms that the exact owned session is already absent. Completed business work remains. If a user or company is deleted first, database cascades remove app records but cannot call OpenAI; a human must handle any retained provider sessions through the appropriate Platform/provider deletion workflow. Do not treat a local cascade or Live `store=false` as confirmed deletion of provider-retained Agents data.

## Verification status and first live check

This implementation was checked with mocked OpenAI/Nylas responses, in-memory repository fixtures, frontend checks, and a browser fixture of the approval flow. `OPENAI_API_KEY` was absent from the checked environment. Project/model access was not checked, no live API call was made, and no schema was applied to an application database.

After the human rollout and project configuration, verify a harmless typed Process read first, then microphone connection and spoken delegation. Confirm that a proposed app change waits for panel approval and use **Reject** to test that path. Check mailbox pagination with a known account only when its owner requests it. Do not use outbound email as a smoke test; AI has no send tool. Investigate exact authentication, project/model-access, billing, database, or microphone errors before retrying uncertain work.
