# Hermes Integration Business Logic Laws

Status: first HTTP integration implemented in source. Service provisioning, runtime credentials and the receipt migration are required before activation. Exports, backups, S3 archives, PostgreSQL history imports, shared learning and scheduled workflows remain later work.

1. Mango must connect to the pinned self-hosted Hermes HTTP Runs API through its existing authenticated Go backend and shared frontend transport.
2. Each provisioned user/company pair must have one private Hermes process, distinct service and callback credentials, and its own persistent home volume.
3. A Hermes home must reject a different user/company binding and must retain native Markdown memory, learned skills, session SQLite databases, response data and cron storage.
4. Mango must reject unconfigured scopes and Hermes services without durable run deduplication.
5. Each browser request must derive its user from Mango authentication and recheck current company access.
6. Only explicit Send may submit a draft; Enter and dictation must never invoke Hermes.
7. Account or company changes must clear visible drafts, history and pending replies, cancel dictation, and reject late results from the previous scope.
8. One user/company pair may have only one unsettled submission; a repeated request ID with the same input must reuse its saved run, and different input under that ID must fail.
9. An uncertain submission must keep its original request ID and text for explicit retry; an unbound submission older than 23 hours must close without another native admission.
10. Saved conversations must resume from native history, and interrupted streams must recover through saved status and explicit Resume without submitting another run; only one browser may consume a run's native stream at a time.
11. Browser messages must display literal user/assistant text and must exclude raw tool arguments, tool results and reasoning events.
12. Mango tool handlers must require authenticated service context and a currently running native run bound to Mango's admitted user, company and conversation.
13. Model arguments must never select the actor, company, credential, callback URL or business command endpoint.
14. Process listing and Process/Step/Node reads must use the existing current permission checks and canonical source IDs.
15. The first write tool must create a Node in one exact existing Process Step through the existing Node assignment command, preserving its default status, relationships, permissions and committed events.
16. Node creation with the same Process, Step and trimmed title within one submission must return one durable outcome regardless of UUID letter case or tool call ID; the receipt and business command must commit atomically.
17. Replaying a committed action must create no duplicate event or Node and must never recreate a Node that was later deleted.
18. Stop must close Mango action admission before calling native cancellation and must preserve actions that already committed.
19. Membership removal must deny dormant conversations and receipts; restoring the same membership must retain deduplication, while permanent user/company deletion must remove its Mango receipt records.
20. Provider credentials must stay in server runtime memory and must never enter browser responses, model arguments, tools, logs or plaintext local configuration.
21. Native memory curation and skill learning must remain enabled within the scoped home; shell, general filesystem, network, delegation and scheduled execution tools must remain unavailable in this first integration.
22. Missing Hermes configuration must show a useful error while preserving ordinary Mango behavior, typed drafts and independent Deepgram dictation.
23. The application runtime must require PostgreSQL receipt storage before enabling Hermes; the in-memory repository is only a test fixture for this integration.

## Process story

The user explicitly sends a message. Mango verifies the account and company, reserves one durable request and sends it to that pair's private Hermes service. Hermes streams the reply and keeps native history and memory. If the user requests work, the supported Mango plugin calls Go with runtime run/session metadata. Go checks the stored admission and current access, then uses the existing Process/Step/Node command and saves its action receipt in the same transaction. Closing the panel or losing the connection does not resubmit work; reopening reads saved state. Stop blocks new Mango actions before asking Hermes to stop.

Mango's `assistant_runs` and `assistant_node_actions` tables hold admission and committed-action receipts only. The pending message is cleared when the native run ID is bound. These tables do not replace native memory, session history, response storage or cron data and do not create a resource registry or another relationship authority. A Node receipt is historical command evidence, not a live ownership link.

Runtime routing is explicit provisioning in `MANGORTS_HERMES_ROUTES`; there is no automatic container scheduler or profile multiplexing. One route must point to one independently bound persistent home. Unprovisioned accounts receive an unavailable error. A native home is retained privately after membership removal; operations must retire user/company volumes according to their retention policy after permanent deletion, and must never reassign them to another identity. The deleted `ai/` and `docs/tests/AI&MCP.md` remain removed.

## Later archival laws

1. Mango-controlled infrastructure must run scheduled verified exports and backups.
2. Raw recovery backups must live in private S3 storage.
3. Selected searchable memory/history imported into PostgreSQL must preserve source, user and company access restrictions.
4. Automation must verify backup completeness before success or retention cleanup depends on that copy.
5. Archive retrieval, external memory providers, shared company learning and scheduled Process execution require separate later capabilities.

## Verification and operation

Focused frontend tests cover explicit sending, dictation independence, streaming, stop, saved/pending request recovery, scope changes and pagination. Go HTTP tests cover private routing, durable admission, filtered streams, saved conversations and the existing Node action. Shared memory/PostgreSQL tests cover transaction rollback, concurrent deduplication, permissions, restart, deletion and cancellation. The native Hermes smoke test uses local fake provider/callback services and separate persistent homes; it never uses provider credentials.

See [runtime setup](../../hermes/README.md), [STT laws](STT.md) and [STT setup](../setup/stt.md). No live schema, service deployment or provider call is performed by these tests.

Pinned upstream: [Hermes 693641aa8b4359c602283bdbbc14041e03bc47bc](https://github.com/NousResearch/hermes-agent/tree/693641aa8b4359c602283bdbbc14041e03bc47bc). References: [HTTP API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/), [plugins](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins/), [native memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/), [persistent volumes](https://hermes-agent.nousresearch.com/docs/user-guide/docker/#persistent-volumes), [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
