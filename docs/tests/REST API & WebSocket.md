# Process Story: Email HTTP acceptance, SQS delivery, and realtime recovery have separate owners

The API verifies a Nylas webhook, resolves the exact permanent email connection, and creates/finds one tiny stable PostgreSQL job identity
↓
The API returns webhook success only after the compact FIFO message is accepted by SQS and that acceptance is durably marked; every duplicate request independently requires a successful send
↓
One private worker receives one bounded unit with an eight-minute context, starts one exact-token provider attempt, and commits the email result
↓
Before deleting the SQS message, the worker durably records the required realtime outbox hint; an outbox insert failure therefore leaves the queue item undeleted
↓
The worker does not wait for Valkey publication. Once the outbox row exists, the SQS item is acknowledged and any Valkey outage is recovered by the lifecycle-owned realtime spine without repeating provider work
↓
AWS receive count controls redelivery/DLQ movement, PostgreSQL refuses provider attempt 4, and no API/worker hot-polls the database or changes SQS visibility

Last updated: 2026-08-09

# Process Story: Archive completion uses canonical reads without polling

The archive request returns its durable job identity after the exact SQS item is accepted
↓
The private worker settles the exact provider archive result in PostgreSQL
↓
The same transaction records a compact exact-mailbox realtime hint; Valkey carries no archive job, email body, or provider result
↓
After recording the returned identity, the browser reads once to close a fast-completion race. If the job remains active, the exact hint or subscription reacceptance triggers the next canonical job read; no timer polls the resource

Last updated: 2026-08-09

# Process Story: Committed realtime events cross API tasks without hot database polling

An authenticated HTTP command commits product state and its compact `realtime_outbox` row in one PostgreSQL transaction
↓
The API response acknowledges that durable commit immediately and wakes the lifecycle-owned publisher; it never waits for Valkey I/O or current-audience lookup
↓
The publisher sends that committed event ID, revision, exact scope, and compact hint to the private Valkey channel, with one bounded retry scheduler for publish failures
↓
Every API task receives the hint, deduplicates it, rechecks the exact current audience where required, and fans out only through its local WebSocket registry
↓
If Valkey disconnects, durable HTTP saves keep succeeding while reconnect uses bounded exponential backoff and jitter
↓
Startup first certifies the current published cursor with one bounded retry loop; only then may reconnect or a detected sequence gap perform fixed-limit indexed outbox recovery, wait for in-flight writers, and treat unused `BIGSERIAL` values as harmless gaps
↓
Until that cursor is certified and the subscriber/spine loops are launched, realtime ticket and WebSocket admission return retryable `503 realtime_not_ready` without minting or consuming a ticket or registering a socket; durable HTTP commands remain available
↓
No API task queries `realtime_outbox` every 75 milliseconds, no full document or keystroke enters Valkey, and deployed DEV fails fast without both its Terraform-wired Valkey configuration and a ready PostgreSQL repository

Last updated: 2026-08-08

# Process Story: A healthy heartbeat cannot be overridden by one rejected optional subscription

The authenticated realtime socket receives server `ready` and completes the application heartbeat challenge
↓
Each mounted feature requests only its exact scope and receives either accepted or rejected admission
↓
Accepted scopes perform their canonical recovery; a rejected scope reports its own feature error and performs no recovery
↓
Once every initial scope has an admission result and accepted recoveries finish, the global indicator follows the healthy heartbeat
↓
One stale pin, forbidden chat, or other rejected optional scope cannot show the global disconnected modal or block unrelated mutations
↓
A missing/stale heartbeat, socket close, authentication failure, or accepted-scope recovery failure still drives the established reconnect and disconnected states

Last updated: 2026-08-07

# Process Story: Realtime remains map-free after complete Map retirement

A committed Node, Logic Gate, Editor, Explorer, Kanban, communications, Project, permission, or notification mutation appends its retained domain event
↓
The backend publishes only the exact authorized realtime scopes for that product
↓
Frontend caches invalidate or reconcile the affected surviving entity and title views
↓
Node authored-change annotations and unread/seen ETags keep their existing routes and state transitions
↓
No Node Map or Logic Gate Map route, API, workspace scope, geometry event, coordinate payload, read-version scope, or derived position task exists

# Process Story: Logic Gate document commands use final storage

A UI or headless caller loads the current Logic Gate document
↓
The projection-shaped read is assembled from `logic_gate_textboxes` and final relationships
↓
The caller saves through the authenticated editor JSON document route; manual Save and restore use `logic_gate_textboxes_history`
↓
Legacy information/projection commands cannot write a compatibility row
↓
Committed revision events keep the existing exact realtime behavior

Last updated: 2026-08-05

# REST API & WebSocket Tests

Coverage Status:
- RW51-RW54 and RW57 have focused coverage in `backend/internal/http/realtime_audience_hardening_test.go`, `backend/internal/http/realtime_websocket_test.go`, `communications_singleflight_cancellation_test.go`, `communications_handlers_test.go`, and `tests/frontend/pages/home/homeMailboxRealtime.test.ts`; mounted React race coverage remains partial.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial overall. Backend realtime, collaboration HTTP/store, and disposable-PostgreSQL tests cover exact admission/publication authorization, revocation, retryable cursor behavior, atomic outbox rollback/retry/idempotency, Node/Logic Gate/Project document isolation, and backend-A to backend-B delivery. Frontend tests cover one shared socket, exact refcount, ticket bootstrap while health is degraded, heartbeat recovery, mutation gating, bounded rich-HTML patches, IndexedDB recovery, and legacy cleanup. The dedicated production-path realtime runner and its Chrome workflow coverage were removed from CI on 2026-07-28. Focused transport, store, HTTP, frontend, and infrastructure suites remain; visible multi-user workflows require manual acceptance until replacement automation is added. Unrelated retained-family and mounted React races retain their stated partial coverage.

## Business Logic

RW1 - Node, Logic Gate, and Project collaborative editor writes use authenticated HTTP operation commands; WebSocket is committed fan-out and health, never an uncommitted write path.
RW2 - Exact editor delivery uses `editor:{node|logic_gate|project}:{resource_id}:{document_id}`. Every healthy authorized exact subscriber receives committed operations live; unrelated resources, documents, companies, users, and inactive connections receive nothing.
RW3 - A browser reports an editor operation Saved only after the backend atomically commits the accepted operation, next document revision, canonical state, and transactional outbox event and returns acknowledgement.
RW4 - The whole-document checkpoint/revision-conflict endpoint, per-tab full-body drafts, restored-draft blocker, and end-user version-choice UI are deleted from migrated editors. Their routes reject migrated `Text box` writes/deletes rather than acting as a fallback.
RW5 - A timeout or lost acknowledgement leaves the stable operation durable and retryable. Retrying the same operation ID deduplicates against a prior commit; it does not create duplicate content or imply failure before reconciliation.
RW6 - Editor state distinguishes local pending, Saving, Saved, Reconnecting with changes stored locally, recovery/syncing, globally blocked reconnect attempts, and manual-refresh disconnected state without exposing merge-conflict engineering language.
RW7 - Unacknowledged HTML patches are retained durably under authenticated user, company, exact document, browser client, and operation ID and survive unmount, refresh, disconnect, and reconnect.
RW8 - Timeout investigations must identify the exact HTTP method, route, request duration, and backend log line for the affected request.
RW9 - Backend request logs must make it possible to distinguish slow durable writes from slow background reads or refetches.
RW10 - Notifications/Updates, mounted Node chat, mounted Logic Gate Kanban, the exact active mailbox, and exact collaborative editor documents all publish through the one durable outbox/shared-backplane/local-registry realtime spine. Payload/recovery rules differ, but no feature owns a second livestream system.
RW11 - Approved scope patterns are `notifications:user:{user_id}`, `chat:node:{node_id}`, `board:{board_id}`, exact personal/shared mailbox scopes, and `editor:{node|logic_gate|project}:{resource_id}:{document_id}`. Broad workspace, company, directory, communications, Explorer, graph, RACI/My Work, Project Management, permission, wildcard editor, and user-wide editor scopes are forbidden.
RW12 - Socket open never means Connected or Saved. Green requires server ready, a confirmed application heartbeat, an admission result for every initial exact subscription, and successful recovery for accepted mounted scopes. A rejected scope is resolved but unavailable and reports through that feature's `onRejected` path; it is not evidence that the authenticated socket or unrelated features are disconnected. Saved still requires the affected write's own acknowledgement.
RW13 - Browser-side API request timing should make status=error timeout cases visible with the route that timed out.
RW14 - Dev or production timeout triage must consider backend, database, and cache-refetch load before changing the client timeout threshold.
RW15 - Successful Node and Logic Gate renames publish one concrete same-window committed-title event after the HTTP command succeeds. Every supported Editor, Kanban, Home/My Work, and Company Explorer rename entry point patches matching mounted Editor, Kanban/Arena, Explorer, Home, My Work, Updates current Node/Logic Gate row, selected-panel, and open-action labels, AppLayout dock/popup/sidebar-pin, AppTimeline, and Project Management labels as applicable. For Logic Gates only, Updates also resolves saved Logic Gate grouping headers and sort values from the current title; stored notification title/body prose remains historical. The wired async title-bearing setters capture the shared registry version before awaiting and overlay only newer same-window commits before storing their result. The app-lifetime publication coordinator synchronously patches or invalidates affected title-bearing communications, project-relationship, Kanban, My Work matrix, entity-record, workspace-snapshot, and graph caches. Request-start version folding and targeted cache generation/invalidation guards prevent pre-commit requests from repopulating an old title. Denormalized persisted sidebar-pin responses overlay all latest commits. A later canonical request remains authoritative rather than being permanently masked. Passive convergence preserves dock recency, pin persistence, dirty editor text, and every active title `contentEditable` draft/caret; another user revalidates on activation/navigation because there is no broad title browser stream.
RW16 - Explicit editor saved versions remain HTTP commands after pending editor operations are acknowledged. The save transaction materializes each canonical document before writing one batch to its permanent textbox-history table; ordinary typing never appends saved-version rows.
RW17 - Confirmed saved-version restore atomically replaces the current permanent textbox snapshot and inserts compact exact-scope outbox events. Subscribers fetch full snapshots; restore never fans out a whole document body or revives the legacy projection-conflict path.
RW18 - A terminal `401` or failed auth refresh must make realtime and API recovery quieter: stop ticket requests, WebSocket reconnects, fallback refetches, editor saves, and background retries, then rely on the auth layer to force the normal Mango login page.
RW19 - WebSocket reconnects after backend replacement/deploy must use randomized delay, exponential backoff, and bounded or very slow retry behavior; clients must not all reconnect immediately.
RW20 - First subscription acceptance and reconnect acceptance reconcile only the active notification summary, mounted Node chat, mounted board, exact actively viewed mailbox, or active/visible archive-status canonical reads. A late local handler joining an already accepted shared scope receives immediate local acceptance; accepted state resets on disconnect, rejection, or last unsubscribe. Notifications acceptance is tagged summary-only; an open Updates feed reloads only for a real notification-created/deleted/cleared change. Each slow canonical read is single-flight with at most one queued final refresh; later acceptance/hints never overlap or abort/restart it, and no path refetches the whole app.
RW21 - A `404` for a node, Logic Gate, or other resource is terminal for that resource until explicit user navigation or an authoritative event says the resource exists; the client must stop refetching that exact missing resource and unsubscribe from its realtime scope.
RW22 - Failure handling for `401`, `404`, and WebSocket disconnects must reduce frontend/backend work rather than creating retry, reconnect, or fallback-refetch storms.
RW23 - Realtime WebSocket tickets must be short-lived, HTTP-only, and valid across backend worker instances in the same environment so a ticket issued by one ECS task can be accepted by another task during WebSocket upgrade.
RW24 - Attachment upload control, metadata, linking, and content reads are HTTP operations. No attachment WebSocket message exists, and socket payloads never carry file bytes, base64 blobs, presigned URLs, or S3 object contents.
RW25 - Calendar invitation responses use authenticated `POST /v1/communications/calendar-invites/respond` HTTP requests. The request supplies the company/mailbox scope plus `message_id` and `status` (`yes`, `maybe`, or `no`); the backend resolves the iCalendar UID and exactly one provider event under the authorized personal/shared mailbox scope instead of accepting client-supplied grant, calendar, or event identifiers. Shared inbox responses require edit access, WebSocket messages never send the RSVP, and expired/revoked grants or missing calendar scope return a recoverable mailbox/provider error rather than Mango logout or false success.
RW26 - Normal browser upload uses Mango HTTP JSON endpoints for policy, intent creation/state, multipart signing, completion, and abort, then raw HTTPS PUT directly to private S3 through the presigned URL. Mango API requests and WebSocket payloads never carry the browser file body. Intent creation carries active company context only in the membership-validated `X-Mango-Company-ID` Mango header, never in intent JSON or an S3 request; the S3 request also never carries Mango Authorization/cookies.
RW27 - `GET /v2/logic-gates/{logic_gate_id}/work` is the primary Kanban-specific Arena read and returns only `logic_gate`, actor `permissions`, `board`, `columns`, and minimal `cards`. The legacy `GET /v1/logic-gate-arena` route may delegate to the same representation but is not the primary path.
RW28 - The Logic Gate work response omits top-level repeated IDs, statuses, assignments, nodes, cards limits, and the full RACI collection; contract tests must assert both required fields and absent redundant fields.
RW29 - A conditional Logic Gate work request performs owning-gate authorization first, then reads one `logic_gate_work_versions` primary-key row; it must not search multiple `domain_events` payload shapes to calculate an ETag.
RW30 - Logic Gate work ETags include actor identity/permission flags and a response-contract salt in addition to the work version, so permission and code-only representation changes cannot reuse an unsafe `304`.
RW31 - Arena HTTP reads accept an `AbortSignal`; selecting another Logic Gate cancels the obsolete request, and an aborted request does not report an application error or commit response state.
RW32 - A `kanban.changed` hint on the mounted `board:{board_id}` scope coalesces one targeted canonical `/work` revalidation. There is no browser projection delta, sequence, replay, or broad workspace refetch.
RW33 - One committed card-visible change publishes only to each affected mounted board scope, and one logical change cannot start duplicate board revalidations.
RW34 - `304 Not Modified` reuses the current complete snapshot without clearing board state or creating duplicate render churn.
RW35 - A conditional `GET /v2/nodes/{node_id}/view` performs effective Node authorization first, then reads one dedicated shared node-view version and one actor-specific version. Its ETag includes company, node, actor, effective permission flags, response-contract salt, and both versions; a match returns `304` before `GetNodeView`, serialization, body hashing, object reads, or seen-state writes and never depends on `event_rows`.
RW36 - Attachment content conditionals remain HTTP-authorized: one repository read selects attachment, requested-or-original variant, and active links; specialized resource checks authorize those links; and a strong validator match returns private `304` before the single object-storage read.
RW37 - The realtime handshake rejects unauthenticated clients and token-bearing URL query authentication, signed tickets work across Server instances that share the environment signing contract, and closing a connection removes its subscriptions. Admission validates scope shape/length, rejects malformed, nonexistent, cross-company, cross-user, and wrong-account resources even for administrator overrides, permits at most 16 distinct subscriptions per connection, keeps duplicates idempotent, and stores no durable subscription rows.
RW38 - Backend WebSocket writes use a bounded deadline and at most 16 concurrent fan-out workers per serialized publish batch, preserving per-connection write safety and event order without making N stalled clients cost N sequential deadlines. Failed connections are removed and closed; healthy subscribers continue receiving messages; and attempted, delivered, failed, no-subscriber, and no-authorized-subscriber metrics remain distinct.
RW39 - Notification create, delete, and clear operations publish only to the matching authenticated user's notification scope. First acceptance/reconnect reconcile canonical state. A local delete/clear marker records HTTP and socket observers separately. HTTP-first keeps the local optimistic source, while socket-first uses a canonical non-local source so open Updates reloads even if the HTTP response is lost; the matching second observer emits nothing, and after both claim the marker is removed so a distinct later clear is not suppressed. Duplicate socket frames remain suppressed while a lost response is pending. A failed HTTP request with no socket emits no update and releases its marker.
RW40 - Ordinary `node_updated` processing does not query Kanban projection rows when there are no relevant local board subscribers; a mounted local board preserves exact affected-board lookup and delivery.
RW41 - Node chat and Logic Gate Kanban publication re-resolve the current exact resource audience before writing already-subscribed sockets. Shared-mailbox publication likewise uses the current exact inbox audience. Access revoked after a legitimate subscription therefore suppresses every later hint without requiring reconnect; authorization lookup failure is fail-closed and does not broaden company fan-out.
RW42 - Home retains at most one exact mailbox scope: the selected connected personal account for My Triage or the selected mail-bearing shared inbox for Shared Triage. Shared root/headings/group rows/plain folders, Drafts, non-mail views, inaccessible resources, and inactive mailboxes retain no fallback mailbox subscription and issue no provider GET because of a hint. Navigation loads and subscribes the destination mailbox and cancels timers, pending work, and the old subscription. Equivalent shared-inbox metadata/callback replacement retains the existing exact company/scope subscription lifetime; only an actual target or mail-bearing transition reinstalls it.
RW43 - First mailbox acceptance and reconnect acceptance each coalesce one canonical exact-mailbox folder/list reconciliation, closing the initial-list-to-subscription race. The worker's deterministic post-ingestion hint and true already-stored `message.updated` (including moves) or `message.deleted` hints reconcile the active list and folder metadata; a raw `message.created` webhook does not publish before ingestion. Folder create/update/delete hints reconcile folder metadata; selected detail reloads only when its message/thread is identified and that captured selection is still active when delayed/queued work executes. Archive status uses this same selected-mailbox subscription and refreshes only active/visible jobs containing the exact changed message; inactive cached jobs are marked stale without an immediate GET, and unrelated mailbox/message hints cause zero archive reads. Exact cache invalidation and delayed request keys include company plus personal account/shared inbox, and obsolete or off-view work issues no provider read. Realtime reconciliation uses authoritative exact-key refreshes: it bypasses reusable mail caches, coalesces with same-key in-flight work, and generation-fences provider reads begun before invalidation from repopulating folder, page, detail, or status caches.
RW44 - `POST /v1/communications/triage/convert` resolves the provider connection from exactly one source mailbox key. A personal conversion sends normalized `account_email` in the query and the backend verifies that account belongs to the authenticated user; a shared conversion sends `shared_inbox_id`, ignores/suppresses personal identity, and performs exact inbox permission and company-connection resolution. The drag payload, every Explorer/Kanban/project/pin handoff, and the same-browser committed-result event retain that same key.
RW45 - My Triage and Shared Triage email collaboration chat retain only the collaboration Node's existing `chat:node:{node_id}` scope. Email and Node mounts perform the same canonical Node projection/chat read on first acceptance, reconnect, and compact chat hints; no `chat:email`, collaboration-document, draft-body, presence, cursor, replay, or broad communications scope is added.
RW46 - Email-collaboration ensure/create, participant expansion, chat writes, shared-draft create/update/send/discard, source-thread reads, and attachment authorization are authenticated HTTP operations. A durable chat commit may publish the existing Node chat hint and mention notifications; a shared-draft revision remains canonical HTTP state and never travels as editable body content over WebSocket.
RW47 - Shared-draft optimistic concurrency is not CRDT/OT collaboration. Every update/send/discard supplies the expected revision, stale HTTP commands return conflict plus canonical metadata, and another participant observes the newer body through an authorized canonical draft read rather than WebSocket document deltas.
RW48 - A never-opened My Triage or Shared Triage chat rail mounts no email-collaboration surface, performs no collaboration resolve or Node projection/chat read, and installs no `chat:node:{node_id}` subscription. The explicit Chat control may resolve an existing collaboration through authenticated HTTP; a pre-collaboration open rail has no Node chat scope until a successful ensure returns its Node. After a same-message rail has been opened, closing it may retain only an inert hidden component so an unsent composer survives reopening; the closed rail reserves no layout width, initiates no read merely because it is closed, and retains no Node chat subscription. Closing the rail or changing the exact message, mailbox, or view logically invalidates obsolete resolve/projection generations so their eventual results cannot update the current rail, and removes that rail's subscription; transport-level abort is not required. Reopening an existing collaboration follows RW45's canonical acceptance/reconnect behavior.
RW49 - Every unexpected PostgreSQL failure during email-collaboration ensure/create is tagged with one fixed creation stage. A failure before a successful commit rolls back when a transaction exists; `begin_transaction` has no transaction to roll back, and a commit-stage error retains the database driver's commit outcome rather than claiming a rollback. Recognized missing/drifted table, column, type/function, privilege, datatype, unique/check-constraint states map to HTTP `503 email_collaboration_storage_not_ready`; invalid enum input maps there only at the two attached-email projection insertion stages. Existing domain validation/not-found/principal errors retain their 4xx mappings and all other store errors retain the generic 500 path. The failure log contains only request ID, company ID, actor user ID, personal/shared scope, fixed stage, SQLSTATE, and fixed category; it must never include the raw database message/detail/hint, SQL parameters, mailbox address, provider message/thread ID, subject, or serialized email body.
RW50 - A committed cross-Logic-Gate Node assignment event carries canonical source and destination board/Logic Gate IDs. Realtime deduplicates those board IDs and publishes one compact `kanban.changed` hint to each currently authorized mounted board audience; same-window success invalidates/announces the same exact boards. Clients reconcile through canonical conditional work reads, while command failure publishes no success hint and transport payloads contain no projection delta.
RW51 - A committed Logic Gate deletion publishes one `resource_deleted` hint to the exact mounted-board audience captured while the Logic Gate still existed and access was authoritative. Ordinary board events continue to reauthorize at publication time. The tombstone path must not perform a post-delete existence check that necessarily empties the audience, and it must not broaden delivery beyond pre-delete authorized local subscribers.
RW52 - Publication-time entity existence and audience resolution are deadline-bound, limited to distinct users currently subscribed to the exact local scope, and fail closed. No-subscriber and no-current-authorized-recipient outcomes are successful no-ops; repository timeout or lookup failure is a distinct error. A shared provider webhook propagates that error, releases its deduplication receipt, and returns a retryable failure instead of acknowledging a lost hint. Retrying an identical `message.opened` delivery reuses the receipt's first timestamp so read-signal aggregation remains idempotent.
RW53 - Backend folder, message-page, and message-detail singleflight keeps one shared provider leader per exact generation while every joined waiter observes its own context. Canceling a joined waiter returns promptly without canceling or duplicating the leader; the waiter releases its generation admission, the leader retains its own admission until completion, and only the still-current generation may cache the result.
RW54 - Mailbox work uses separate ownership domains. Message-list/detail work may include mailbox tab, search, unread-only state, and selection generation; folder metadata uses only company plus exact mailbox scope; a queued provider mark-read is captured mutation intent rather than disposable list-refresh work. Navigation may detach stale UI results but cannot silently drop the mark-read command or let a prior scope overwrite the destination.
RW55 - Canonical HTTP reconciliation owns durable server data, not transient local presentation state. Notification summary acceptance does not revalidate the Updates feed; real feed hints atomically replace canonical rows without clearing selection/group expansion first. Mounted-board work/view reconciliation may update cards and titles but a controlled same-Node reopen must not reset that popup's fullscreen mode.
RW56 - The unified collaboration rollout is coordinated: apply `20260715_unified_realtime_collaboration.sql` before the matching backend/frontend release, then require pre-cutover tabs to reload. Migrated `Text box` projection POST/DELETE compatibility writes remain rejected; no revisionless or whole-document fallback is restored.
RW57 - An otherwise healthy realtime WebSocket remains connected while idle. The backend sends an empty protocol-level ping every 25 seconds, below the deployed load balancer's 60-second idle timeout; the browser networking stack answers without JavaScript timers, API fetches, auth refreshes, or new realtime tickets. Only a genuine transport failure invokes bounded reconnect and scoped canonical recovery.
RW58 - Node and Project chat edits use author-checked `PATCH .../projection/{projection_id}` commands. The request may replace trimmed message text and resolved mention IDs but cannot replace the stored author, created timestamp, source selection, reply context, attachments, text-box ownership, or arbitrary payload fields. Node edits enqueue a durable compact `chat.message.updated` event on `chat:node:{node_id}`; mounted clients respond with one canonical projection refresh. The existing exact-scope authorization, current-audience resolution, retry/outbox behavior, and no-project-chat-subscription boundary remain unchanged.
RW59 - Global realtime health is transport/authentication/heartbeat truth, not the logical AND of every optional feature subscription. Rejection removes only that exact scope from accepted delivery, invokes its scoped rejection handler, and skips its recovery callback. It must not start or extend the global attempting/disconnected modal while server ready and heartbeat remain healthy. Genuine socket, heartbeat, ticket/authentication, or accepted-recovery failure retains the existing global outage behavior.
RW59 - Logic Gate document writes use `/v1/editor-json/logic_gate/{logic_gate_id}/documents/{document_id}` and `logic_gate_textboxes`. A legacy text information write returns `editor_collaboration_required`; every unsupported legacy information type returns `logic_gate_information_type_not_supported`; neither path writes `logic_gate_information` or `logic_gate_projection_table`.
RW60 - `project_information_created` and `project_information_deleted` advance the `projects`, unfiltered Company Explorer, and Project-folder Company Explorer read-version scopes. Conditional reads after either event must not reuse an older ETag or return an incorrect `304`.
RW61 - Node Map and Logic Gate Map are fully retired. The backend exposes no Map layout or Map workspace route, accepts or returns no Map coordinates or position results, creates no Map-derived task, publishes no Map realtime event, and maintains no Map read-version scope or cache key. Historical shipped migrations remain records only.
RW62 - PostgreSQL product rows and `realtime_outbox` are the durable source of truth. Valkey carries only a best-effort committed-event signal; it is not document storage, an acknowledgement authority, or a replacement for transactional outbox atomicity.
RW63 - An API task may publish an outbox event only after its enclosing product transaction commits. An ordinary mutation acknowledges that durable enqueue and wakes the lifecycle-owned publisher without waiting for broker I/O or current-audience lookup. The Valkey envelope contains only event sequence, stable event ID, resource revision, exact company/scope, event/resource identity, existing audience boundary, compact payload, and creation time. It never contains every keystroke, a complete editor document, attachment bytes, credentials, or claim/lease internals.
RW64 - Every API task subscribes to the one environment Valkey channel. A received event can reach clients only after event ID/revision deduplication, ordered sequence handling, exact-scope current authorization where required, and the existing local WebSocket registry; a task never broadcasts to all company sockets merely because Valkey delivered a message.
RW65 - Valkey subscribe/reconnect and publish retry use bounded exponential backoff with nonzero jitter and automatically resubscribe with a fresh short-lived IAM credential. Duplicate event ID/revision deliveries are harmless. One authorization-retry timer owns its deadline; later broker hints and recovery signals cannot bypass that deadline or multiply timers.
RW66 - Valkey or outbox-claim storage failure does not roll back, delay, or reject an already-durable HTTP save. The unpublished outbox row remains retryable, realtime may be delayed, and broker failure attempts to release its fixed claim batch with a short storage deadline, switching to the API-task lifecycle when the initiating context was canceled. One controlled publish timer retries broker, mark, and claim failures even if the subscription stays healthy; producer wakes during backoff do not create a database retry storm. If claim release is incomplete, that timer cannot fire before the 15-second claim lease expires, and the resulting lease-safe claim pass resolves the outstanding failure state even when it finds no row. A failed or zero claim must never strand pending work until the ten-minute safety cadence.
RW67 - Normal realtime dispatch has no periodic 75 ms database query. Before publisher, subscriber, or recovery loops start, one lifecycle-owned bootstrap must successfully read the current published cursor. A failed initial cursor read retries only that cursor query with bounded exponential backoff and jitter; buffered producer wakes remain coalesced, and no uncertified-zero history replay, list query, subscriber, publisher, or timer multiplication is allowed. During that uncertified window durable HTTP commands remain available, but realtime ticket and WebSocket admission return retryable `503 realtime_not_ready`; the server must not mint or consume a ticket, accept or register a socket, or expose a client that can miss an event another task publishes before cursor certification. Certification launches the subscriber and spine loops before admission opens. Admission does not wait for broker subscription readiness: any event published after the certified cursor but before that readiness must be recovered forward from the certified cursor when the subscriber becomes ready. Every current-cursor and published-list recovery snapshot has both a short caller deadline and a PostgreSQL lock deadline. Timeout or storage failure leaves the cursor unchanged and schedules exactly one lifecycle-owned bounded recovery retry; later signals cannot bypass its deadline or multiply timers. Other spine-owned claim, publication-state, claim-release, and audience storage calls also have short deadlines, so a database network stall cannot freeze the sole spine indefinitely. After certification, outbox recovery runs only at subscriber readiness/reconnect, a detected gap/overflow, a self-signal after four full fixed-size batches, one controlled storage retry, and a bounded ten-minute safety cadence. Recovery waits for in-flight outbox writers, uses fixed limits and sequence indexes, and may cross only sequence values thereby certified as nonexistent; it never waits forever for a rolled-back `BIGSERIAL` value or computes a table-wide `min`/`max` aggregate. Adding idle API tasks therefore adds no steady-state outbox polling work.
RW68 - HTTP request contexts reach durable realtime enqueue calls, while the cancelable API-task lifecycle context owns broker publication, audience authorization, subscriber dispatch, recovery, claim cleanup after request cancellation, and delayed retry work. `context.Background` creates only deliberate top-level application lifecycles.
RW69 - Simple local development may explicitly use the process-local backplane when no Valkey variables are configured. Terraform-managed DEV sets `MANGORTS_VALKEY_REQUIRED=true`; missing or partial coordinates fail startup instead of silently isolating ECS tasks. Its private ElastiCache Serverless security group accepts TCP 6379-6380 only from the ECS task security group. First creation waits for the updated GitHub deploy-policy attachment, and task registration/service rollout wait for the exact runtime `elasticache:Connect` policy attachment.
RW70 - `APP_ENV` never authorizes the in-memory repository. No-database local mode requires both an absent `DB_HOST` and explicit `ALLOW_INMEMORY_FALLBACK=true`. Once a PostgreSQL host is configured, open, connection, or schema-readiness failure terminates startup for every runtime role, including the private email worker; a deployed API must never pass health checks against an empty in-memory repository after database failure.
RW71 - A valid Nylas `message.created` webhook resolves the exact permanent email connection and uses `ingestion_job_id` as the one Mango job identity in PostgreSQL, the compact SQS body/deduplication identity, and worker lookup. It returns success only after SQS accepts that identity and PostgreSQL records `sqs_accepted_timestamp`. The request performs no provider download, cache invalidation, or pre-ingestion realtime publish. `enqueue_source_id` is only an immutable fingerprint proving the exact original producer retry; it is never a second job, lease, or delivery authority. Only that matching source may retry while acceptance is unrecorded; accepted-recorded, processing, completed, parked, or exhausted jobs cause no producer send.
RW72 - The DEV email worker receives one SQS item at a time with 20-second long polling, an eight-minute attempt context, and no visibility change API. AWS fixed visibility, receive count, redelivery, and DLQ movement are authoritative. PostgreSQL increments only a provider-processing start, fences settlement by the exact attempt token, and refuses attempt 4; it has no claim/reclaim lease, availability timer, or retry scheduler.
RW73 - Every webhook lookup, marker/acceptance write, transaction, SQS send, and query uses the HTTP request context; cancellation must stop blocked PostgreSQL and SQS work. Worker/provider/database work uses the bounded attempt context. Cancellation or an ambiguous failure after marker creation leaves the same stable identity; only the exact original producer request may retry it before acceptance is recorded. Generic/later reconciliation never resends that existing marker. After the provider/email transaction commits, the worker must durably insert the required deterministic realtime outbox row before SQS deletion. The event identity derives from the stable job plus exact company/audience scope, so completed redelivery—including after SQS delete failure—does no provider work and creates no second outbox event. Once the row is committed, Valkey publication is lifecycle-owned asynchronous work: broker failure does not block SQS acknowledgement or repeat provider work, and the existing realtime spine recovers the row.
RW74 - Provider 401/403 and exact 404 `grant.not_found` atomically park only the exact connection as `reauth_required`; the known Google/Gmail 400 precondition failure parks it as `configuration_required`. Status-write failure leaves the SQS item undeleted. Rare EventBridge reconciliation uses only `reconciliation-control` for control messages and the permanent email connection ID for provider work, reads one bounded connection/provider page per message, and creates/sends only when no stable ingestion job exists. A redelivery of the exact same reconciliation source may finish only its own accepted job whose acceptance is unrecorded; a later schedule with another fingerprint and every accepted-recorded, processing, completed, parked, exhausted, archive, or DLQed identity cause zero sends. It never lists age-based unsent work, recreates an identity, or automatically replays the DLQ.
RW75 - Before its first receive, the private worker requires PostgreSQL with the exact final schema, complete Nylas configuration, an SQS sender/receiver, and connected external Valkey; it never substitutes process-local realtime. A persistent SQS Receive error ends the worker so ECS restart backoff applies, while ordinary item failure remains native SQS redelivery.
RW76 - Every archive provider mutation is one compact SQS item; the API has no single-message provider archive route, non-background batch mode, local archive goroutine, or background switch. Only the exact original request may retry the same unaccepted item identity; generic reconciliation never resends it. PostgreSQL is status truth. After recording the returned job identity, the browser performs one canonical `GET /v1/communications/archive-jobs/{job_id}` read to close a fast-completion race. The existing selected-mailbox subscription then refreshes only affected active/visible message/job identities, marks inactive cached jobs stale until navigation, and permits at most one active status pass plus one final queued pass regardless of hint burst. Unrelated hints cause zero archive reads. Valkey never carries the job or email payload, and the browser never polls job status.
RW77 - An attached-email surface whose stored thread is `downloading` performs its initial canonical HTTP read, subscribes to the exact personal-account or shared-inbox mailbox scope, and performs one new canonical thread read only after the worker's post-commit hint. It installs no one-second timer and never replaces that timer with another polling loop.

## Scenarios

### Scenario RW-S0: Valkey Outage Delays Hints Without Delaying Durable Saves

Business logic covered:
- RW10
- RW41
- RW62 through RW70

Given:
- Two development API tasks have exact authorized WebSocket subscribers.
- PostgreSQL is available and Valkey may be connected, duplicated, disconnected, or reconnecting.

Expected:
- A successful HTTP mutation commits its product state and durable outbox event before publication.
- When Valkey is healthy, both API tasks receive the compact event and only their exact authorized local subscribers receive one ordered hint.
- Duplicate delivery does not produce a second socket message.
- During a Valkey outage the HTTP mutation still succeeds, the outbox row remains unpublished/retryable, and idle tasks do not query the outbox on a 75 ms cadence.
- Reconnect resubscribes, publishes pending committed rows, performs fixed-limit indexed gap recovery, and delivers the delayed hint without a database retry storm.
- Full editor documents remain on canonical HTTP reads and writes; Valkey carries only the compact revision hint.

### Scenario RW-S0A: Deployed Runtime Requires PostgreSQL

Business logic covered:
- RW62
- RW70

Given:
- A Terraform-managed development task has `APP_ENV=dev` and `ALLOW_INMEMORY_FALLBACK=false`.
- Its PostgreSQL host is missing, unreachable, or has an unready application schema.

Expected:
- Repository construction returns the startup error; the API never starts its health endpoint against an empty in-memory repository.
- The same repository selection remains fail-closed for every runtime role, including a later email-worker mode.

### Scenario RW-S0B: Realtime Waits For A Certified Initial Cursor

Business logic covered:
- RW62
- RW63
- RW67

Given:
- PostgreSQL returns transient errors for the initial current-published-cursor query while durable mutations continue to enqueue outbox rows.
- Retained published history already exists.
- Another API task may publish an event while this task remains uncertified, and may publish another event after certification but before this task's broker subscription becomes ready.

Expected:
- One lifecycle bootstrap retries only the cursor query with bounded exponential backoff and jitter.
- No publisher, subscriber, published-row list, or recovery loop starts before cursor certification, and producer wakes remain coalesced.
- Realtime ticket and WebSocket attempts receive retryable `503 realtime_not_ready` before certification; no ticket is minted or consumed and no socket is accepted or registered.
- After the cursor query succeeds, realtime starts from that certified position and drains newly pending durable work without replaying retained history.
- Admission opens after the loops launch. Subscriber-ready recovery delivers an event published after the certified cursor but before broker readiness, while an event published before certification was never promised to a socket because no socket could be admitted.
- A blocked recovery lock/list query times out without moving the cursor; durable request enqueues remain independent, and one backoff timer retries recovery in order after storage becomes available.
- A claim query error arms one bounded publish retry without another producer wake. If broker/mark failure cannot release a lease, repeated wakes cannot bypass the lease-safe retry deadline; publication resumes at or after lease expiry without a hot loop.

### Scenario RW-S1: Editor Save Uses HTTP As The Durable Source Of Truth

Business logic covered:
- RW1
- RW2
- RW3
- RW4
- RW10
- RW56
- RW59

Given:
- A user edits a node or logic gate editor document.
- The frontend has access to the normal HTTP API.

Expected:
- Local editor mutations render immediately, enter the exact authenticated editor JSON HTTP route, and commit to the permanent owner textbox row.
- The backend authorizes the exact company/resource/document and atomically commits collaboration integration, next revision, canonical state, and outbox event before acknowledging Saved.
- Every healthy exact subscriber applies the committed operation once through the shared cross-instance spine; unrelated scopes receive nothing and remote apply creates no echo save.
- Reconnect/gap recovery restores the exact subscription, full snapshot/ETag, buffered order, and durable pending operations before green health.
- The matching final-storage migration is applied before the coordinated app release; pre-cutover tabs reload and legacy Logic Gate information/projection writes remain rejected without compatibility rows.

### Scenario RW-S1B: Editor Saved Versions Use Explicit HTTP Version Routes

Business logic covered:
- RW1
- RW2
- RW3
- RW4
- RW16
- RW17

Given:
- A user edits a node or logic gate editor document.
- Pending projection autosaves may still be queued.
- The user clicks Save, an interval auto-save fires, or the user restores an existing saved version.

Expected:
- Manual and interval saved versions flush pending document writes before creating the saved-version batch.
- Saved-version creation writes only to the resource permanent textbox-history table through the save-version route.
- No per-keystroke collaboration WebSocket traffic or endpoint exists.
- Restoring a saved version asks for confirmation, then overwrites the current permanent textbox row through the restore route.

### Scenario RW-S2: API Timeout Does Not Automatically Prove Save Failure

Business logic covered:
- RW5
- RW6
- RW7
- RW13
- RW14

Given:
- A user edits a node or logic gate editor document.
- The HTTP save request takes longer than the frontend API timeout.
- The backend may still be processing the request after the browser stops waiting.

Expected:
- The editor shows a state that is clearly different from a confirmed save.
- The editor preserves the latest local document value for retry or reconciliation.
- The UI does not imply that a WebSocket failure caused the durable save result.
- Browser request timing identifies the route and timeout status for the failed wait.

### Scenario RW-S3: Timeout Investigation Identifies The Exact Slow Route

Business logic covered:
- RW8
- RW9
- RW13
- RW14

Given:
- A user reports an API request timeout on the dev site.
- Browser request timing or the Network tab records the failed request.
- Backend logs are available for the same approximate timestamp.

Expected:
- The investigation records the HTTP method and route that reached the timeout.
- Backend logs show whether the matching request completed, failed, or never reached the backend.
- The investigation distinguishes editor save routes from background reads such as workspace snapshots, node views, logic gate views, company explorer loads, or kanban loads.
- The investigation focuses on the route, backend work, database behavior, and request fanout before changing the generic client timeout.

### Scenario RW-S4: Only Explicit Product Scopes Publish

Business logic covered:
- RW10
- RW11
- RW12

Given:
- A durable notification, Node chat change, mounted-board-visible mutation, or exact active-mailbox provider change commits.
- A matching retained scope has a local subscriber.

Expected:
- The backend publishes only to the matching notification, Node chat, board, exact personal-account mailbox, or exact shared-inbox mailbox scope.
- First acceptance and reconnect use only that active surface's coalesced canonical HTTP read; Updates fetches its feed only while open and mail reconciles only while the exact mailbox is active.
- Ordinary workspace, Explorer, graph, My Work, Project Management, broad communications, permission, and document mutations emit no product socket message.

### Scenario RW-S4B: Retired Map Contracts Stay Absent

Business logic covered:
- RW61

Given:
- A caller attempts a retired Map layout or Map workspace request, or old browser state names a retired Map scope.
- A normal Node, Logic Gate, relationship, Editor, Explorer, or Kanban mutation commits.

Expected:
- No Map route or compatibility handler accepts the request, and no response contains Map coordinates or position results.
- No Map realtime event, read-version scope, cache key, or derived position task is created.
- Surviving product mutations continue through their exact non-Map contracts without querying Map position storage.

### Scenario RW-S5: Same-Window Node And Logic Gate Titles Converge

Business logic covered:
- RW1
- RW2
- RW3
- RW10
- RW15

Given:
- The same Node or Logic Gate is visible in concurrently mounted Editor, Kanban/Arena, Company Explorer, Home, My Work, Updates, AppLayout dock/popup/sidebar pins, AppTimeline, and Project Management caches as applicable.
- Each supported rename entry point successfully commits once; one editor document is dirty/in flight and one Editor title `contentEditable` has a live draft and caret.

Expected:
- Each successful HTTP rename publishes one concrete committed-title event after commit.
- All matching same-window labels converge immediately, including Updates current Node/Logic Gate row, selected-panel, and open-action labels, dock and popup-parent labels, visible Node/Logic Gate sidebar pins, current/history timeline labels, and Project Management `display_title`/workspace labels. Logic Gate titles also update Updates saved Logic Gate grouping headers and sort values; notification title/body prose stays historical, and passive updates do not bump dock recency or write pin rows.
- Dirty, debounced, queued, or in-flight editor text remains unchanged, and an actively edited title defers the incoming label without changing its DOM draft or caret.
- Failed renames publish no event.
- No workspace WebSocket event is published.
- Another user sees the new title after opening or revalidating the surface.
- A full browser refresh is not required.

### Scenario RW-S6: Terminal Auth Failure Stops Realtime And Refetch Storms

Business logic covered:
- RW12
- RW18
- RW22

Given:
- A realtime ticket request, WebSocket open, API fallback refetch, or editor save receives a terminal auth failure.
- The auth layer cannot silently refresh the access token.

Expected:
- Realtime ticket requests stop.
- WebSocket reconnect attempts stop.
- Fallback refetches stop.
- Editor save attempts stop.
- Background API retries stop.
- The normal auth flow forces the existing Mango login page instead of keeping a half-authenticated work surface alive.

### Scenario RW-S7: Missing Resource 404 Does Not Refetch Forever

Business logic covered:
- RW11
- RW21
- RW22

Given:
- The client asks for a node, Logic Gate, board, or editor resource that the backend returns as `404`.
- The client may still have stale UI state, route state, or a realtime subscription for that resource.

Expected:
- The client treats the `404` as terminal for that resource.
- The client stops refetching that exact missing resource.
- The client unsubscribes from the missing resource's realtime scope when applicable.
- The client clears or closes the stale UI reference.
- The client does not retry until explicit user navigation or an authoritative event says the resource exists.

### Scenario RW-S8: Backend Replacement Reconnects Are Calm And Scoped

Business logic covered:
- RW19
- RW20
- RW22

Given:
- A new backend version is deployed and old backend workers are replaced.
- Existing WebSocket connections drop as old workers stop.
- Multiple browser tabs or users may reconnect at the same time.

Expected:
- Reconnect attempts use randomized delay so all clients do not reconnect at once.
- Reconnect attempts use exponential backoff after repeated failures.
- Reconnect behavior is capped or becomes very slow instead of retrying aggressively forever.
- A reconnect does not refetch the whole app by default.
- First acceptance and reconnect each request only the canonical data for active subscriptions; a closed Updates view requests no feed and an off-view mailbox requests no provider data.

### Scenario RW-S9: Realtime Tickets Work Across Backend Workers

Business logic covered:
- RW18
- RW19
- RW23

Given:
- The dev or production backend is running more than one worker/task.
- A browser requests a realtime ticket from one backend worker.
- The subsequent WebSocket upgrade is routed to a different backend worker.

Expected:
- The ticket is accepted by the upgrade worker when it is unexpired and scoped to the requested company.
- The ticket is not exposed as a query parameter or normal JavaScript-readable credential.
- Cross-worker routing does not create repeated `401` WebSocket upgrade failures for a still-authenticated user.

### Scenario RW-S10: Attachments Use HTTP APIs, Not Realtime Byte Payloads

Business logic covered:
- RW10
- RW11
- RW24
- RW26

Given:
- A user uploads, links, unlinks, or reads an attachment.
- Other clients may later open the affected resource.

Expected:
- Browser upload policy/intent/part/complete/abort, metadata reads, link/unlink writes, and authenticated content reads use permissioned Mango HTTP routes.
- Browser raw File/Blob bytes use the short-lived presigned S3 HTTPS PUT and bypass Mango API; backend-originated producers retain the server streaming storage path.
- Attachment changes use canonical HTTP reads and local command responses only.
- Realtime payloads do not include attachment metadata, raw file bytes, base64 strings, presigned URLs, or S3 object content.
- S3 PUT requests include only exact signed headers and no Mango access token, cookies, company headers, or API-client interceptors.
- Clients fetch attachment content through the attachment HTTP content route only when they need to render or download it.

### Scenario RW-S11: Calendar Invitation RSVP Uses A Scoped HTTP Command

Business logic covered:
- RW25

Given:
- A personal or shared mailbox message contains one valid `METHOD:REQUEST` iCalendar event.
- The user chooses Accept, Tentative, or Decline in an email viewer.

Expected:
- The frontend posts the source `message_id`, normalized RSVP status, company scope, and shared inbox scope when applicable to `/v1/communications/calendar-invites/respond`.
- The endpoint requires the authenticated communications connection and shared-inbox edit access when a shared scope is supplied.
- The backend reads the source MIME, extracts the invitation UID, resolves exactly one non-cancelled event in the provider calendar, and sends the provider RSVP.
- Missing invitations or events return a validation/not-found response, and ambiguous event matches return a conflict instead of choosing an arbitrary event.
- The request does not accept or trust a client grant ID, provider event ID, calendar ID, provider token, or attachment bytes.
- Each provider request is rate-gated and the action is not sent through WebSocket.
- Expired or revoked grants, insufficient calendar scope, and provider failures return a recoverable reconnect/provider response and never report a successful RSVP or force Mango logout.
- Environment OAuth scopes must include Google/Microsoft calendar write access before integrated provider verification. Scope changes are not retroactive: existing grants must be reauthorized/reconsented after the configured scopes change. This route is invitation RSVP, not a full calendar workspace.

### Scenario RW-S12: Conditional Logic Gate Work And Mounted Board Hint

Business logic covered:
- RW27
- RW28
- RW29
- RW30
- RW31
- RW32
- RW33
- RW34

Given:
- An authorized Arena client has a complete Logic Gate work snapshot and ETag.
- The client starts a conditional read, changes Logic Gates, receives first subscription acceptance, and later receives a `kanban.changed` hint and reconnect acceptance.

Expected:
- The backend checks access before deciding whether to return `304`.
- ETag calculation uses the dedicated primary-key version row and actor/contract fingerprint, not domain-event searches.
- The obsolete HTTP request is aborted without committing stale state.
- First acceptance, the compact hint, and reconnect each coalesce through the same targeted work loader.
- Duplicate hints do not start a second concurrent revalidation.
- No projection-delta sequence or replay path exists.
- A `304` keeps the complete snapshot unchanged, and a `200` body contains no redundant collections.

### Scenario RW-S13: Conditional Node View And Attachment Content

Business logic covered:
- RW24
- RW35
- RW36

Given:
- An authorized client has current ETags for a consolidated Node view and one attachment variant.

Expected:
- Each conditional request reauthorizes the caller before evaluating its validator.
- The node-view match reads dedicated shared/user version rows and returns `304` without building the consolidated response or writing seen state.
- The attachment match uses the minimal attachment/link/variant read and returns `304` before S3/object storage.
- Neither route uses `event_rows` as canonical version state or exposes object-storage keys.

### Scenario RW-S14: Retained Transport Authentication, Authorization, And Routing

Business logic covered:
- RW11
- RW23
- RW37
- RW39
- RW41

Given:
- Clients attempt unauthenticated and token-query WebSocket handshakes.
- One Server instance signs a ticket and another Server instance accepts the upgrade.
- An authenticated client requests malformed, nonexistent, cross-company, cross-user, wrong-account, unauthorized, and over-limit retained scopes, later subscribes to an authorized scope, repeats that subscription, and then closes.
- Notification create, delete, and clear commands commit.
- A Node-chat, mounted-board, or shared-mailbox subscriber then loses access before another event commits.

Expected:
- Unauthenticated and token-query handshakes are rejected.
- The signed ticket works across Server instances under the shared signing contract.
- Invalid and unauthorized scopes are denied and never stored, including nonexistent administrator-selected resources and the former user-wide personal mailbox scope.
- The 17th distinct scope is rejected while a duplicate accepted scope remains idempotent.
- Closing removes all retained subscriptions.
- Notification create, delete, and clear publish only to the matching user scope.
- A user revoked after subscribing receives no later Node-chat, board, or shared-mailbox hint.

### Scenario RW-S15: Acceptance Reconciliation, Dead Connections, And Board Lookup Guard

Business logic covered:
- RW20
- RW38
- RW39
- RW40

Given:
- Notification, mounted Node chat, mounted board, and active-mailbox subscriptions receive first acceptance, later reconnect acceptance, and compact hints while a canonical read is slow; a second local same-scope handler also joins after the shared scope is already accepted.
- Several controlled WebSocket writers are stalled or dead while another subscriber is healthy.
- A local notification delete/clear result is followed by its matching socket echo.
- In the opposite ordering, the server commits and the socket echo arrives before a lost/rejected HTTP response for an Updates-local Seen mutation.
- Ordinary `node_updated` publication runs both without and with a relevant local board subscriber.

Expected:
- Each active retained surface performs one single-flight canonical reconciliation on first acceptance and reconnect, with at most one queued final read and no overlap/restart; notification acceptance reconciles summary only, and mail fetches only for the active exact mailbox.
- A late handler joining an already accepted shared scope receives immediate local acceptance; accepted state clears on disconnect, rejection, or last unsubscribe.
- Stalled writes proceed within the bounded worker fan-out rather than one serial deadline per client; failed connections are closed and evicted, and the healthy subscriber still receives delivery.
- Delivery failures and no-subscriber publishes increment distinct metrics.
- HTTP-first plus its matching echo causes at most one summary request and, subject to the local optimistic source filter, at most one open-feed request.
- Socket-first plus a lost/rejected HTTP response performs exactly one summary reconciliation and one mounted Updates feed reconciliation; the later HTTP failure emits no second update.
- No-subscriber `node_updated` performs no Kanban projection lookup; a mounted board preserves correct lookup and board-scoped delivery.

### Scenario RW-S16: Exact Active Mailbox Reconciliation

Business logic covered:
- RW10
- RW11
- RW20
- RW42
- RW43
- RW44

Given:
- My Triage initially loads personal Account A, a message commits before first subscription acceptance, and acceptance then arrives.
- The user receives a burst of message/folder hints while one canonical reconciliation is active, switches to personal Account B or Shared Inbox A before a delayed timer runs, later visits a Shared Triage root row, and reconnects while the exact inbox is open.
- One hint identifies selected message/thread A, selection changes to unrelated B before its delayed/queued turn, another creates unrelated mail, and equivalent shared-inbox metadata objects replace the current inventory without changing the exact target.
- The user drags mail from personal Account B through Explorer, Kanban, project, and pin conversion owners, then performs the equivalent drop from Shared Inbox A.

Expected:
- First acceptance discovers the between-load-and-subscribe message with one canonical reconciliation, and reconnect acceptance performs the same one-shot recovery.
- Bursts coalesce; work arriving during an active read produces at most one necessary final read.
- Equivalent metadata replacement keeps one subscription/acceptance lifetime, and the stale A detail hint performs no provider read for B.
- Account A never wakes Account B, one shared inbox never invalidates another mailbox, and a timer captured for the old mailbox is canceled or discarded.
- Shared root/headings/group rows/plain folders and off-view mailboxes retain no fallback scope and perform no hint-triggered provider GET.
- The worker's deterministic post-ingestion hint and true already-stored `message.updated` (including moves) or `message.deleted` events reconcile only the active list/folders; raw `message.created` publishes nothing before ingestion, folder events reconcile folders, and selected detail reloads only for a directly named selected message/thread.
- Payloads remain compact hints and canonical HTTP data remains authoritative.
- Personal conversion requests retain normalized Account B `account_email` end to end and cannot fall back to Account A. Shared conversion requests retain only Shared Inbox A as the client request selector; the backend resolves its canonical company mailbox account after exact permission checks.

### Scenario RW-S17: Email Chat Reuses Node Scope And Shared Drafts Stay HTTP

Business logic covered:
- RW1
- RW2
- RW10
- RW11
- RW20
- RW45
- RW46
- RW47
- RW48
- RW49

Given:
- A user opens an email detail while Chat remains closed, then explicitly opens and closes its collaboration rail; the same durable chat may also be mounted from its standalone Node.
- Two participants edit one shared draft at different revisions.

Expected:
- The closed email rail performs no collaboration HTTP resolution, Node projection/chat read, or socket subscription and reserves no hidden email-chat scope.
- Explicit open may resolve the collaboration over authenticated HTTP; only an existing or successfully ensured Node installs the existing `chat:node:{node_id}` scope, and close or exact-scope navigation removes it.
- A schema/ownership/constraint drift failure rolls the ensure transaction back, returns `503 email_collaboration_storage_not_ready`, and records only the fixed safe diagnostic fields from RW49; domain 4xx and unrelated 500 mappings do not change.
- Both chat mounts retain the same `chat:node:{node_id}` subscription and coalesce canonical Node chat reads on acceptance/reconnect/hints.
- No email-chat, document, draft, presence, cursor, replay, or broad communications scope is introduced.
- Ensure/create, mentions, source reads, chat writes, shared-draft commands, and attachment checks remain authenticated HTTP operations.
- Chat commit publishes only the existing Node chat hint plus applicable notification hints; WebSocket carries no durable message/draft body or attachment bytes.
- A stale shared-draft command conflicts by expected revision and the participant reloads canonical HTTP state; no CRDT/OT or draft-body socket path is implied.

### Scenario RW-S18: Cross-Gate Assignment Publishes Both Board Hints

Business logic covered:
- RW20
- RW27
- RW41
- RW50

Given:
- A Node moves from Logic Gate A to Logic Gate B while A, B, neither, or both boards have retained subscriptions.
- A same-window completion and its socket echo may arrive in either order, or the command may fail.

Expected:
- The committed event identifies both board IDs once; the server reauthorizes each mounted audience and sends one compact hint per affected subscribed board.
- No-subscriber boards cause no unnecessary projection fan-out, and local/socket duplicates coalesce through the existing canonical single-flight read path.
- Failure emits no success hint, and realtime never carries card deltas or false optimistic membership.

### Scenario RW-S19: Bounded Audience Resolution And Independent Mail Waiters

Business logic covered:
- RW51
- RW52
- RW53
- RW54

Given:
- An authorized user has a mounted Logic Gate board while another local connection lacks Edit access, and the Logic Gate is deleted.
- A retained entity publisher has local subscribers plus unrelated company users, then its repository lookup stalls or fails.
- A signed shared-mailbox delivery repeats after that transient lookup failure.
- Two HTTP callers join one provider folder/page/detail read; the joined caller cancels while the leader remains active.
- A mailbox filter transition occurs while folder work and provider mark-read intent are pending, followed separately by an exact scope transition.

Expected:
- The committed deletion sends one `resource_deleted` tombstone only to the pre-delete authorized mounted-board audience; ordinary events still resolve current existence/access.
- Audience lookup receives only distinct exact-scope local subscriber IDs, obeys its deadline, and fails closed without scanning every company user.
- No-subscriber/no-authorized results succeed, but shared lookup failure returns retryable failure and releases deduplication before the repeated delivery succeeds without duplicating its open-signal count.
- The canceled waiter returns immediately without canceling or duplicating the leader and releases only its own cache-generation admission.
- Filter transitions preserve exact-scope folder work and captured mark-read intent while invalidating stale list/detail presentation work; scope transitions reject every old-scope result.

### Scenario RW-S20: Canonical Reconciliation Preserves Local Presentation

Business logic covered:
- RW20
- RW32
- RW39
- RW55

Given:
- Notifications accepts/reconnects while Updates has selection and collapsed grouping state.
- A real notification hint later commits.
- Logic Gate work/view reconciliation updates cards while its controlled same-Node popup is fullscreen.

Expected:
- Acceptance refreshes notification summary but performs no Updates roots/branch read.
- The real notification hint coalesces one atomic feed reconciliation without first clearing visible rows, selection, or expansion.
- Board reconciliation applies canonical card/title data without changing same-Node fullscreen.
- No whole-app refresh, projection delta, or loss of necessary realtime correctness is introduced.

### Scenario RW-S21: Quiet Realtime Connections Stay Open Without API Polling

Business logic covered:
- RW19
- RW20
- RW57

Given:
- A browser has active notification, mounted-board, and open-Node scopes.
- The deployed load balancer closes connections that have no traffic for 60 seconds.
- No product event occurs for several minutes, and the tab may be backgrounded with JavaScript timers throttled.

Expected:
- The backend sends a protocol-level ping every 25 seconds and the browser answers below JavaScript.
- The quiet connection stays open without ticket, token, notification-summary, Logic Gate work, or Node-view HTTP requests.
- A genuine transport failure still causes one bounded reconnect followed by the existing scoped canonical recovery.

#### Why the heartbeat is 25 seconds

The 25-second cadence is intentionally conventional rather than Mango-specific. Common realtime stacks use keepalive defaults in the same range: Microsoft SignalR uses 15 seconds, Socket.IO uses 25 seconds, and Cloudflare Agents uses 30 seconds. These are reference defaults, not a statistically rigorous industry-wide mean, but their median is 25 seconds and they establish a normal operating range of roughly 15–30 seconds.

Mango's deployed Application Load Balancer uses the AWS default 60-second idle timeout. A 25-second server heartbeat leaves 35 seconds of margin before that cutoff and remains below the common rule that the heartbeat interval should be no more than half the enclosing idle timeout. NGINX likewise documents a 60-second default WebSocket proxy timeout and recommends periodic WebSocket ping frames as the alternative to increasing that timeout.

Transport and traffic requirements:
- The heartbeat is an empty RFC 6455 WebSocket Ping control frame (opcode `0x9`), not an application message.
- The browser networking stack automatically answers with Pong; no React effect, JavaScript interval, page reload, Fetch/XHR request, access-token refresh, or realtime-ticket request is involved.
- Ping/Pong traffic must not invoke notification summary, Logic Gate work, Node view, mailbox, or other canonical API reads.
- Only an actual socket close or transport failure enters the bounded reconnect path, obtains a new ticket, and performs the existing one-time scoped canonical recovery.
- If an infrastructure idle timeout changes, keep the heartbeat comfortably below the smallest timeout on the path and retain an automated assertion that the production heartbeat is below 60 seconds.

Reference defaults:
- [AWS Application Load Balancer attributes](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)
- [Microsoft SignalR keepalive interval](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.signalr.huboptions.keepaliveinterval)
- [Socket.IO ping interval](https://socket.io/docs/v4/server-options/#pinginterval)
- [Cloudflare Agents keepalive interval](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)
- [NGINX WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)
- [RFC 6455 Ping and Pong](https://www.rfc-editor.org/rfc/rfc6455#section-5.5.2)

### Scenario RW-S22: Chat Edit Command And Exact Reconciliation

Business logic covered:
- RW58

Given:
- A comment author and another entity editor can both read the same mounted Node chat.

When:
- The author PATCHes the exact comment projection and the other editor attempts the same command.

Expected:
- The author's command changes only trimmed message text, mention IDs, and edit timestamp.
- The nonauthor request is forbidden even though that user otherwise has entity Edit access.
- The committed Node edit produces one durable `chat.message.updated` event on the exact Node chat scope.
- The frontend maps that hint to one canonical projection refresh; it never treats the WebSocket body as chat persistence truth.
- Project edits remain HTTP-only and do not create a new Project chat subscription.

Automated coverage:
- `backend/internal/http/realtime_websocket_test.go`
- `backend/internal/http/chat_comment_edit_test.go`
- `tests/frontend/modules/realtime/realtimeWebSocket.test.ts`
