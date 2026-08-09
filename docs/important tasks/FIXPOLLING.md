# Process Story: Mango reacts to real work instead of continuously asking whether work exists

A user pauses typing and Mango commits the editor save through authenticated HTTP

↓

The durable database transaction finishes first and records one small realtime event

↓

Valkey immediately tells every running API backend about that committed event

↓

Each backend sends the hint only to its own authorized browsers subscribed to that exact editor

↓

Separately, Nylas sends Mango a verified webhook when a mailbox changes

↓

Mango places one exact, small email job onto SQS and quickly acknowledges Nylas

↓

One bounded email worker downloads the exact affected message or thread and saves it durably

↓

Rare bounded reconciliation repairs a missed notification without returning to hot database or provider polling

Last updated: 2026-08-08

# Fix Polling

Status: Approved implementation plan. This file records the incident, the current behavior, the chosen architecture, the rollout order, and the tests required before the work is complete. It does not itself change runtime behavior or AWS resources.

## Executive decision

Mango currently uses PostgreSQL as both the durable source of truth and a high-frequency signaling system. It also uses repeated Nylas and PostgreSQL scans to discover email work that the existing webhook path can already announce. Multiple ECS backend tasks multiply all of these loops.

The replacement is deliberately simple:

- PostgreSQL remains the durable source of truth.
- Valkey becomes the cross-backend realtime announcement system.
- SQS becomes the email work queue.
- Nylas webhooks become the normal new-email trigger.
- EventBridge Scheduler creates one rare email reconciliation signal approximately every 10 minutes.
- Indexed, bounded database recovery remains as a safety net, never as a hot normal path.
- Permanent provider failures change connection status and stop retrying.
- Existing typed editor, permission, email-connection, email-message, and email-relationship identities remain authoritative.

Valkey and SQS are not interchangeable:

| Need | Service | Delivery shape |
| --- | --- | --- |
| Tell every API backend that one committed editor/mailbox event exists | Valkey Pub/Sub | Every subscribed backend receives the announcement |
| Give one email download/archive/reconciliation job to one worker | SQS FIFO | One worker processes the job; other workers do not repeat it |

## Incident summary

On 2026-08-08, the development Aurora PostgreSQL database was observed at approximately 100% CPU utilization per ACU while ACU utilization was also at 100%. The supplied CloudWatch view showed sustained CPU saturation beginning around August 5, elevated database connections, frequent commits, and intermittent active/blocked transaction spikes.

The strongest measured database evidence points to the realtime outbox loop as the primary continuous load source:

- `realtime_outbox` contained approximately 114,600 rows during the read-only sample.
- PostgreSQL statistics showed approximately 66.9 million sequential scans and approximately 4.19 trillion tuples read from that table since the relevant statistics reset.
- The current scan rate was approximately 40.15 sequential scans per second.
- One 75 ms loop produces about 13.33 polls per second. The observed 40.15 rate is almost exactly three loops.
- That implies approximately three live backend processes at the sample time, even though Terraform requests two steady-state tasks. A rolling ECS deployment or live override can temporarily create a third task.
- The database was also committing roughly 100 transactions per second in the observed window, consistent with background loops generating work even when user activity was low.

The email loops add avoidable provider and database pressure, amplify with backend count, and contain a permanent-error retry bug. The investigation did not prove that email polling alone caused the 100% CPU condition. It is a separate confirmed design problem that must also be removed.

The original report of roughly 12-second regular-user Node loads may be amplified by the saturated database. The Node endpoints still require separate performance verification after database pressure is removed:

- `GET /v1/nodes` lists all visible Nodes and may perform company-wide permission work.
- `GET /v1/nodes/{id}` loads one Node and filters its relationships.

Valkey and SQS do not excuse inefficient Node permission queries. They first remove the constant background competition so endpoint-specific profiling becomes trustworthy.

## Current AWS request shape

The repository's intended deployment is:

```text
Browser
  -> CloudFront
  -> Application Load Balancer
  -> one of the ECS Fargate API tasks
```

The repository configuration is appropriate for load balancing:

- Dev and production both request two backend tasks.
- The ALB target group uses IP targets, which is correct for Fargate `awsvpc` networking.
- The ALB checks `/healthz`.
- ECS tasks are private and accept application traffic only from the ALB security group.
- CloudFront forwards `/v1/*` and `/v2/*` to the ALB without API caching.
- The realtime WebSocket is `/v1/realtime/ws`.
- The backend sends a WebSocket ping every 25 seconds, below the ALB's 60-second default idle timeout.

AWS service responsibilities are different:

- ECS starts, replaces, and maintains the requested number of backend tasks.
- The ALB chooses a healthy task for each HTTP request or WebSocket upgrade.
- A WebSocket remains attached to the task that accepted it.
- The ALB does not relay application events between tasks.
- Backend A and backend B are not different programs. They are separate running copies of the same Mango backend image with separate in-memory WebSocket registries.

The cross-task delivery problem is therefore an application backplane problem, not an ALB misconfiguration. Cookie stickiness would not solve it because two different users viewing the same editor can still be attached to different tasks.

Live AWS ECS desired/running counts, deployment state, target health, and live ALB attributes were not verified during the investigation because the designated read-only AWS agent profile was unavailable. Human/admin AWS profiles were intentionally not used.

## Confirmed realtime polling problem

### Current code path

`backend/internal/http/realtime_spine.go` defines:

- a 75 ms default poll interval;
- one realtime spine per backend process;
- an immediate flush after local wake signals;
- a database claim of unpublished outbox rows;
- a database read of published rows after each process's cursor;
- local delivery through that process's own in-memory WebSocket subscription registry.

Every backend process therefore asks PostgreSQL for outbox state approximately 13.33 times per second. Two steady tasks create approximately 26.67 loops per second. Three tasks create approximately 40 loops per second.

This polling was introduced to solve a real correctness problem: a save handled by backend A must reach a WebSocket connected to backend B. The problem is valid. The database polling implementation is not.

### Expensive query

`backend/internal/store/postgres_realtime_outbox.go` currently finds the contiguous published boundary with this shape:

```sql
select coalesce(
  min(outbox_sequence) filter (where published_timestamp is null) - 1,
  max(outbox_sequence),
  0
)
from realtime_outbox;
```

That aggregate appears in both the current-sequence read and the published-events query. PostgreSQL can repeatedly inspect the growing table instead of performing one tiny bounded lookup. Running it every 75 ms from every backend makes its cost grow with both history and backend count.

### Relevant Git history

- `eb4b56f9f7024cf969368e96025a4d1ab4ee9a33` (`Implement automatic email ingestion`, 2026-08-06) introduced the current automatic email ingestion system and its scanner/worker loops.
- `3a8dda0d9cdd10fb7049894bb0e9014efcd5c11c` (`Fix realtime outbox polling database load`, 2026-08-07) replaced the full aggregate with bounded ordered probes and added a regression test.
- `0d3073d385a3496a43a4962f1760c845cc3bfd75` reverted that fix shortly afterward on the branch where those commits existed.
- Neither the fix nor its revert is an ancestor of this task's starting HEAD. The current code nevertheless contains the original aggregate query and does not contain the bounded-query regression test.

The bounded indexed query is a valid emergency mitigation and a required property of any recovery path. It is not the final architecture because even a cheap query should not execute every 75 ms on every idle backend.

### Request cancellation issue

The realtime outbox repository uses `context.Background()` for normal enqueue, claim, mark, cursor, and event-list database calls. The spine itself is correctly given a server-lifecycle cancellation context, but that context is not propagated into these repository calls.

Consequences:

- Shutting down the server cannot promptly cancel an in-flight outbox query.
- A slow query can continue consuming PostgreSQL resources after the caller no longer needs it.
- The same pattern is dangerous when used in request-owned work because browser cancellation cannot reach PostgreSQL.

The implementation must pass the real worker or request context through the repository boundary. `context.Background()` remains appropriate only when deliberately creating the top-level server lifecycle context.

## Confirmed email polling problems

### Current connection scanner

`backend/internal/http/communications_email_thread_download_worker.go` currently starts two loops inside every API backend:

- an email connection scanner every 30 seconds;
- an email download-job database poll every 250 ms.

Every 30 seconds, every backend process:

1. reads all connections whose Mango status is `connected`;
2. calls Nylas `ListFolders` for each connection;
3. identifies Inbox;
4. calls paginated Nylas `ListMessages` with a five-minute overlap;
5. writes durable ingestion jobs for discovered messages;
6. advances the scan checkpoint only after successful discovery.

This design multiplies Nylas calls and database work by backend count. Existing uniqueness constraints prevent many duplicate final rows, but uniqueness does not make repeated discovery free.

### Current download worker

Every 250 ms, every API backend calls the database to claim a small batch of email download jobs. This loop is not checking download progress for the browser. It is using PostgreSQL as a queue and repeatedly asking whether work exists.

The worker's actual download and persistence rules are valuable and should be preserved. The hot database polling used to find work should be removed.

The communications archive worker has the same 250 ms database-queue pattern. It should move to the same SQS worker boundary, using a distinct job kind and the existing durable archive job rows for status.

### Mango already has the webhook fast path

Mango already exposes and protects `/nylas/webhook`:

- CloudFront and WAF route it to the backend.
- The handler verifies the Nylas HMAC signature.
- It understands `message.created`, `message.updated`, `message.deleted`, folder events, `message.opened`, `grant.expired`, and `grant.updated`.
- A `message.created` event already ensures one durable ingestion job for the exact Mango connection/message and wakes the local worker.

The system therefore already has an event-driven foundation. The 30-second scanner is a reliability fallback running as if it were the primary path.

The current webhook duplicate receipt cache is in process memory, has a two-minute TTL, and is not shared across ECS tasks. Durable job/message uniqueness already provides the important final idempotency. SQS FIFO deduplication will reduce immediate duplicate work, but the worker must remain idempotent because Nylas and SQS both permit redelivery.

### Broken connection retry loop

Two user-reported connection failures repeated every 30 seconds:

```text
company_id=11111111-1111-1111-1111-111111111111
connection_id=6c54ac7d-6dc8-dbee-e614-a0e2d8c7cd8a
nylas_api_404_grant.not_found: No Grant found for this Grant ID.
```

```text
company_id=11111111-1111-1111-1111-111111111111
connection_id=0aae6e73-48bd-7022-1cfb-768e2246019d
nylas_api_400_general_error: Google Workspace/Gmail API precondition check failed.
```

Reported connection interpretation:

- one Mango connection refers to an old or deleted Nylas grant;
- one has Google authorization but Gmail is not enabled or correctly configured;
- Mango still labels both as `connected`;
- the current normalization stops normal scanning for only a limited set of authentication failures, so these 404 and 400 results never change the status and retry forever.

The Nylas dashboard also showed a separate valid Google grant for `mangotestxd@gmail.com`, Grant ID `60d86c88-5fa4-4ecd-a080-a2364e8b1b2e`, updated August 7, 2026. That valid grant is evidence that the global Nylas application is not uniformly broken. It must not be disconnected or treated as the source of the two failing connection logs. Exact connection-to-grant mapping must be verified with designated read-only database access during implementation without exposing provider credentials.

## Architecture after the fix

```text
EDITOR / REALTIME

Browser save over HTTP
  -> PostgreSQL transaction: business data + durable realtime outbox row
  -> Valkey publish of a small committed event
  -> all API backend subscribers receive it
  -> each backend authorizes and fans out only to its own exact WebSocket subscribers

EMAIL INGESTION

Nylas message.created webhook
  -> Mango verifies signature and resolves exact permanent email connection
  -> SQS FIFO email job
  -> dedicated ECS email worker
  -> exact Nylas message/thread/attachment reads
  -> PostgreSQL durable email records and typed relationships
  -> Valkey mailbox hint after commit

EMAIL RECOVERY

EventBridge Scheduler approximately every 10 minutes
  -> one SQS reconciliation tick
  -> worker selects due connected accounts in a bounded batch
  -> one ordered reconcile job per exact email connection
  -> checkpointed, paginated, bounded Nylas catch-up
```

## Valkey implementation plan

### What Valkey is responsible for

Valkey is a fast cross-process announcement system. It is not the source of truth and does not contain editable documents, email bodies, attachments, permissions, or relationships.

The event payload contains only what the existing realtime delivery path needs, such as:

- stable event ID;
- company ID;
- exact subscription scope;
- event type;
- typed resource identity and committed revision;
- compact hint payload;
- existing audience restriction metadata when required.

### AWS infrastructure

Create AWS-managed ElastiCache Serverless for Valkey with:

- placement in Mango's private VPC/subnets;
- encryption in transit;
- encryption at rest where supported/configured;
- a dedicated security group;
- inbound access only from the ECS API-task security group on the required Valkey ports;
- no public endpoint;
- authentication material managed through AWS, never committed to the repository;
- least-privilege ECS task permissions;
- connection, failure, latency, and capacity alarms.

The existing Terraform module and the production Terraform layout must both describe the intended resources. Live creation or modification of AWS resources requires the normal explicit deployment approval and environment separation.

### Backend connection

Add one maintained Go Valkey/Redis-protocol client dependency. Each API backend process maintains:

- one normal publishing client/pool;
- one long-lived subscriber connection;
- automatic reconnect and resubscription with exponential backoff and jitter;
- a bounded local deduplication window keyed by event ID;
- clear health and failure metrics that do not expose payloads or secrets.

The WebSocket connection registry remains local to each backend. Valkey does not replace it.

### Database-first publication rule

The durable product transaction remains first:

1. validate authorization and the exact typed resource;
2. commit the editor/chat/notification/mailbox mutation and realtime outbox row in one PostgreSQL transaction;
3. after commit, publish the exact outbox event to Valkey;
4. every API backend receives the event and runs the existing local authorization/fan-out path;
5. mark the outbox event published only after the Valkey publish is accepted;
6. treat duplicate event delivery as harmless through the stable event ID and committed revision.

No WebSocket message is evidence that a database save succeeded. The initiating HTTP response remains the save acknowledgement.

### Normal typing behavior remains unchanged

- The browser renders typing locally.
- Ordinary Node and Project editor saving begins after approximately 500 ms of quiet, the existing maximum-delay rule, focus loss, or close.
- Logic Gate structured operations retain their established micro-batch contract.
- Writes remain authenticated HTTP commands.
- Mango never sends every raw keystroke directly through WebSocket or Valkey.
- Valkey carries only committed change hints.

### Recovery without hot polling

Valkey Pub/Sub has at-most-once delivery. The existing PostgreSQL outbox therefore remains the durable recovery record.

Recovery runs only:

- once when an API process starts;
- after the Valkey subscriber reconnects;
- after a detected cursor gap;
- on a rare periodic safety interval, approximately 10 minutes, if still required after failure testing.

Every recovery read must:

- use bounded ordered index probes;
- fetch a fixed maximum batch;
- continue in bounded batches only while actual backlog exists;
- stop immediately when caught up;
- use the real worker cancellation context;
- never execute the current table-wide `min/max/filter` aggregate;
- never return to a 75 ms idle ticker.

If Valkey is unavailable, user saves remain durable. Realtime fan-out may be delayed, the outbox remains pending, reconnect uses bounded backoff, and recovery publishes the missing events after service returns.

### What is removed

After rollout and verification, remove rather than preserve:

- the 75 ms realtime database ticker;
- the normal-path read of all published events after every idle tick;
- obsolete interval configuration and tests that assume database polling is the backplane;
- any compatibility path that silently falls back to hot polling when Valkey is unavailable.

The safe failure mode is delayed realtime with durable saves, not a database retry storm.

## SQS email implementation plan

### What SQS is responsible for

SQS is a durable work queue. A job should be processed by one email worker, not broadcast to every API backend.

Use one FIFO queue for ordered provider work plus one FIFO dead-letter queue. The main queue supports small typed job kinds:

- `webhook_event` for verified Nylas mailbox/grant events;
- `download_message` for an exact durable ingestion job;
- `reconcile_connection` for one exact checkpoint catch-up;
- `archive_messages` for an existing durable archive job;
- any future provider mutation only after its business contract is documented.

Using one queue and grouping by permanent `email_connection_id` preserves ordering for one mailbox while allowing different mailboxes to run in parallel.

### Queue identity and payload

- SQS message group ID: the permanent Mango `email_connection_id`. The single scheduler control tick uses one fixed control group and creates connection-specific jobs before provider work begins.
- SQS deduplication ID: stable Nylas webhook ID or stable Mango job/idempotency ID.
- Internal identity: permanent typed Mango connection ID, never the mutable provider grant ID alone.
- Payload: job kind and small stable identifiers only.
- Never include OAuth tokens, Nylas API keys, webhook secrets, message bodies, attachment bytes, presigned URLs, or unnecessary addresses/subjects.

### Webhook fast path

For Nylas `POST /nylas/webhook`:

1. read the raw body within a strict size limit;
2. verify the HMAC signature before trusting any identifier;
3. parse the supported event and resolve the exact permanent personal/shared Mango connection;
4. send one compact FIFO message using the stable provider event ID;
5. return `200 OK` only after SQS accepts the message;
6. return `503 Service Unavailable` if SQS cannot accept it so Nylas treats the failure as temporary;
7. perform no Nylas message/thread/attachment download inside the webhook request.

Nylas requires a quick response, retries selected temporary failures, and provides at-least-once delivery. Worker idempotency is therefore mandatory even with FIFO deduplication.

### Dedicated worker

Run a small ECS email-worker service from the same Mango backend image in an explicit worker mode:

- it is not registered with the ALB;
- it serves no browser requests or WebSockets;
- it long-polls SQS using AWS's supported wait behavior;
- it starts at one ECS task with bounded provider/database concurrency;
- ECS restarts it if it fails;
- SQS retains work while it is unavailable;
- additional worker tasks can be added only when queue-age evidence requires them;
- FIFO message groups ensure two workers never process the same mailbox concurrently.

SQS long polling is not Mango database or Nylas polling. AWS holds a queue receive request until a message exists or the wait expires. An idle email worker performs no repeated PostgreSQL job claim and no provider mailbox scan.

### Message ingestion work

For `message.created`:

1. load the exact permanent Mango email connection and its current provider grant metadata;
2. reject cross-company, wrong-scope, missing, disconnected, or unhealthy connection use;
3. idempotently ensure the existing durable ingestion job;
4. fetch the exact authoritative Nylas message;
5. confirm it is at/after the ingestion boundary and in Inbox;
6. fetch the exact provider thread when existing business rules require thread completion;
7. download only missing/incomplete messages and attachments;
8. commit messages and any derived typed Node-wide email relationships under existing relationship laws;
9. mark the durable Mango job complete;
10. publish a compact mailbox/realtime hint through Valkey only after commit;
11. delete the SQS message only after successful completion.

The existing `email_connection_id` remains the permanent identity. Reauthentication can replace grant metadata without rewriting queued jobs or relationships.

### Archive work

Existing browser archive commands continue to create durable archive job/job-item rows before returning Accepted. After commit they send one `archive_messages` SQS message containing only the stable job identity.

The email worker performs the existing provider mutation and writes final durable job-item state. The API backend no longer checks the archive job table every 250 ms. Browser-visible status remains a canonical read of the durable archive job when that surface needs it.

### Bounded retries and connection status

Provider outcomes must be classified before retrying:

| Provider outcome | Mango action | Automatic retry |
| --- | --- | --- |
| `401` or `403` authentication/authorization failure | Set the exact connection to `reauth_required`; preserve stored mail/checkpoint/jobs | No repeated provider calls until reauthentication |
| `404 grant.not_found` | Set the exact connection to `reauth_required`; preserve stored data and show that the provider grant is missing | No |
| Gmail/Workspace `400` precondition or configuration failure | Set the exact connection to `configuration_required`; show repair guidance | No |
| Explicit `grant.expired` webhook | Set `reauth_required` | No |
| Valid `grant.updated`/successful reconnect | Return the same permanent connection to `connected` and enqueue one reconcile job | Not applicable |
| `429` rate limit | Honor `Retry-After` when present | Yes, bounded |
| Provider `5xx`, timeout, or temporary network failure | Keep the job available with increasing delay and jitter | Yes, bounded |
| Invalid Mango identity, cross-company scope, or malformed job | Record terminal safe failure | No |

Temporary retry policy must be finite. The intended simple schedule is an immediate attempt followed by increasing delays, capped at a small fixed attempt count. Exhausted work moves to the dead-letter queue and raises an alarm. It does not silently loop forever.

If `configuration_required` is not an existing allowed database status, the implementation must add one deliberate PostgreSQL 17-compatible migration, canonical schema change, UI state, and Process Story update. It must not overload Mango `401` or log the user out for a provider configuration problem.

### Rare reconciliation

Webhooks remain the normal path, but a rare checkpoint catch-up is required because webhook endpoints can fail or be unavailable and Nylas does not promise historical backfill while a webhook is inactive.

Use one EventBridge Scheduler rule at approximately 10-minute cadence:

1. EventBridge places one reconciliation tick onto SQS.
2. One email worker runs one indexed database query for connected accounts whose checkpoint is due.
3. It creates at most one FIFO `reconcile_connection` job per due exact connection.
4. Work is staggered and bounded so accounts do not hit Nylas or PostgreSQL simultaneously.
5. Each connection scans only after `last_successful_scan_at` minus the existing small overlap and at/before its scan start.
6. Pagination, pages, messages, provider concurrency, and total runtime are capped.
7. The checkpoint advances only after every discovered identity is durably accepted.
8. Broken, disconnected, `reauth_required`, and `configuration_required` connections are excluded.

Initial activation, explicit reconnect, and a deliberate user repair action may enqueue one immediate connection reconciliation. They do not run downloads inside OAuth or browser requests.

### What is removed

After rollout and verification, remove rather than preserve:

- the per-backend 30-second connected-account scanner;
- the per-backend 250 ms email ingestion job database poll;
- the per-backend 250 ms communications archive job database poll;
- wake channels whose only purpose was to interrupt those tickers;
- the rule allowing every backend instance to scan the same connection;
- infinite or status-blind retry behavior for permanent 400/404 failures;
- any compatibility path that silently restarts hot database polling when SQS is unavailable.

The safe failure mode is queued/delayed email work, visible queue age, and an alarm—not a retry storm.

## Existing contracts that implementation must update

This plan intentionally changes business logic currently recorded elsewhere. Implementation is incomplete until the relevant Process Stories and numbered laws are updated in the same change.

At minimum review and update:

- `docs/tests/REST API & WebSocket.md` for Valkey cross-worker publication, recovery, failure, and removal of hot database polling;
- `docs/tests/editor.md` only where committed realtime delivery/recovery wording changes; autosave timing and HTTP ownership remain unchanged;
- `docs/important tasks/v3 emailtonode.md`, especially the explicit SQS exclusion and E2N40-E2N53 scanner/reconnect rules;
- `docs/tests/email.md` for webhook receipt, provider error, and mailbox realtime behavior;
- `docs/tests/my-triage.md` and `docs/tests/shared-triage.md` for SQS-backed durable archive work if archive polling is migrated;
- `docs/tests/relationships.md` before changing any email connection, message, attachment, or Node relationship behavior.

The implementation must not create:

- a central resource registry;
- an untyped generic relationship;
- a translated/surrogate resource identity;
- a second provider grant as the Mango connection identity;
- a compatibility layer that preserves obsolete polling.

## Implementation order

Valkey and SQS must be separate reviewable commits and separate production rollouts. They must not be one giant deployment.

### Phase 0: Baseline and emergency protection

- Capture RDS CPU/ACU, sessions, commits, top SQL, `realtime_outbox` scan rate, and table/index statistics using designated read-only access.
- Capture current ECS desired/running task count and deployment state through designated read-only AWS access.
- Confirm the current Nylas webhook subscriptions and states without modifying them.
- Recreate and verify the bounded-index realtime query test from the reverted fix as emergency protection if RDS remains saturated before Valkey is ready.
- Do not treat increased ACU capacity as the architectural fix.
- Do not modify live AWS, RDS, Nylas, or connection status without the required approval.

### Phase 1: Valkey infrastructure and backend support

- Add private ElastiCache Serverless Valkey Terraform, security, IAM/configuration, and alarms.
- Add the Go client and server lifecycle handling.
- Publish committed outbox events and subscribe every API task.
- Reuse exact local authorization and WebSocket fan-out.
- Add startup/reconnect/gap recovery using bounded indexed reads.
- Add unit, integration, multi-instance, failure, and query-budget tests.
- Update the realtime/editor Process Stories.

### Phase 2: Valkey rollout

- Create Valkey first without changing production traffic.
- Verify network/TLS/authentication from an approved non-user-facing task.
- Deploy API tasks through the normal ECS rolling deployment.
- Verify a save handled by one task reaches a WebSocket on another task.
- Verify database scan rate and CPU fall.
- Verify a Valkey interruption delays hints but never loses durable saves.
- Remove the old 75 ms path after all running tasks use Valkey.

### Phase 3: SQS infrastructure and email worker

- Add FIFO queue, dead-letter queue, encryption, least-privilege IAM, queue policy, retention, visibility timeout, and alarms.
- Add EventBridge Scheduler's rare reconciliation tick.
- Add the explicit ECS email-worker mode/service using the same image.
- Change verified webhooks and durable manual jobs to publish small SQS messages.
- Move ingestion and archive job execution behind the SQS worker.
- Implement permanent/transient provider error classification.
- Update the email/triage Process Stories.

### Phase 4: SQS rollout

- Confirm Nylas webhook triggers include required message and grant events.
- Deploy the queue and worker before removing any old path.
- Send official Nylas test events and verify deduplication.
- Verify real message ingestion for personal and shared connections.
- Verify one repaired/reconnected mailbox performs one bounded catch-up.
- Verify the known 400/404 cases change status once and stop.
- Verify queue age, worker concurrency, provider calls, and database load.
- Remove the 30-second and 250 ms loops after the queue path is healthy.

### Phase 5: Soak and cleanup

- Soak across normal traffic, an ECS rolling deployment, a backend restart, a Valkey reconnect, and an email-worker restart.
- Confirm no old ticker, interval, environment variable, wake channel, or test preserves the retired design.
- Confirm dead-letter queues are empty or every entry is understood.
- Confirm CloudWatch alarms and operational runbooks name safe remediation steps.
- Run the complete repository verification gate.

## Required realtime tests

### Correctness

- A committed editor save handled by API task A reaches an authorized browser whose WebSocket is attached to task B.
- An unauthorized user or wrong-company subscriber receives nothing.
- Only the exact Node, Project, Logic Gate, mailbox, notification, or board subscription receives its event.
- No event is published before the database transaction commits.
- A rolled-back transaction publishes nothing.
- Duplicate Valkey delivery does not duplicate an operation or canonical refresh.
- WebSocket ticket issuance on one task and upgrade on another remains valid.
- Ordinary typing remains local and uses the existing save batching, not per-keystroke messages.

### Failure and recovery

- Valkey unavailable before publish: save succeeds, outbox remains recoverable, retry backs off.
- API process dies after database commit and before Valkey publish: recovery publishes the event.
- Subscriber disconnects during publication: reconnect recovery fills the gap.
- API process restarts: it resumes from the correct durable cursor.
- Valkey delivers a duplicate after uncertainty: event ID/revision deduplication is harmless.
- Recovery respects cancellation and shuts down promptly.

### Performance

- An idle API backend executes no 75 ms outbox query.
- Two, three, or four API tasks do not multiply idle PostgreSQL scans.
- Recovery queries use the intended indexes and fixed limits under realistic outbox history.
- No table-wide outbox aggregate appears in the hot or recovery path.
- Commit-to-fan-out latency remains within the existing realtime target.

## Required email tests

### Webhook and queue

- Valid signature plus `message.created` produces one FIFO job and returns promptly.
- Invalid signature produces no job.
- Duplicate Nylas webhook IDs and later duplicate provider events converge safely.
- SQS send failure returns a retryable webhook response and creates no false success.
- Oversized/truncated Nylas notifications enqueue identifiers and fetch canonical provider state in the worker.
- Personal and shared connection resolution remains exact and company-scoped.

### Worker correctness

- One job is processed by one worker.
- Different connection groups can progress concurrently; one connection remains ordered.
- A worker crash before SQS delete causes safe redelivery.
- A completed durable message, attachment, or relationship is not duplicated.
- Provider calls occur outside long database transactions.
- Email bodies and attachment bytes never enter SQS or logs.
- Archive Accepted state remains durable and separate from confirmed provider completion.

### Error handling

- `401` and `403` set `reauth_required` and stop provider retry.
- `404 grant.not_found` changes the exact broken connection status and stops.
- Gmail/Workspace `400` precondition changes to `configuration_required` and stops.
- A valid unrelated grant remains connected.
- `429` honors the provider delay and remains bounded.
- Temporary `5xx`/network failures retry with increasing delay, then enter the dead-letter queue.
- A dead-letter entry raises an alarm and contains only safe identifiers/categories.
- Repair/reconnect updates the same permanent connection and enqueues one reconciliation job.

### Polling removal and reconciliation

- No API backend lists all connected accounts every 30 seconds.
- No API backend claims email download or archive jobs every 250 ms.
- EventBridge produces one rare reconciliation tick.
- Reconciliation excludes non-connected accounts, caps account/page/message/provider concurrency, and advances checkpoints only after durable acceptance.
- Multiple ECS API tasks do not multiply reconciliation.
- A missed webhook is eventually recovered without duplicate durable messages.

## Acceptance measurements

The rollout is not complete merely because messages appear to work. It must show:

- RDS CPU and ACU utilization return to a stable range under ordinary traffic.
- `realtime_outbox` sequential-scan rate falls from approximately 40 per second to effectively zero while idle.
- Idle API tasks perform no realtime outbox table scan.
- Idle email workers perform no PostgreSQL job claim and no Nylas mailbox scan.
- Editor saves remain durable during Valkey interruption.
- Queue age remains low during normal operation.
- SQS dead-letter count is zero or fully explained.
- Nylas webhook response time remains safely below its 10-second requirement.
- The two known permanent provider failures do not repeat every 30 seconds.
- Cross-instance editor and mailbox delivery succeeds during a normal ECS rolling deployment.

Recommended operational measurements:

- RDS CPU, ACU utilization, active sessions, blocked transactions, commit throughput, query latency, and top SQL;
- PostgreSQL outbox/job table scan and tuple-read deltas;
- Valkey publish failures, subscriber reconnects, active connections, message count, and commit-to-fan-out latency;
- SQS visible/in-flight message count, age of oldest message, receive count, delete count, and dead-letter count;
- Nylas calls by operation/status category and per-connection bounded attempt count;
- email worker job duration, success, terminal failure, retry, and backlog.

## Security and privacy requirements

- Use only designated database-enforced read-only credentials for live investigation and verification queries.
- Never retrieve, print, copy, or store database writer/admin credentials, AWS session tokens, Nylas API keys, OAuth tokens, webhook secrets, or unrelated secrets.
- Do not write to a live database during agent investigation.
- Use AWS SSO profiles and keep dev/prod separate.
- Valkey and SQS remain private AWS resources with least-privilege task roles/security groups.
- Enable AWS-managed encryption and avoid secrets in Terraform state/configuration where possible.
- Do not put message bodies, attachments, subjects, addresses, tokens, or presigned URLs into Valkey, SQS, metrics, DLQs, or logs.
- Safe logs may contain stable Mango IDs, fixed operation names, status categories, and attempt counts.
- Preserve exact company scope, permanent typed connection identity, and existing Node authorization before any realtime or email delivery.

## Explicit non-goals

- Do not send every keystroke over WebSocket or Valkey.
- Do not store canonical documents or emails in Valkey.
- Do not use Valkey as a durable queue.
- Do not use SQS as a broadcast system for editor subscribers.
- Do not introduce Kafka, a custom broker, custom leader election, or Valkey Streams without measured evidence that the simpler design is insufficient.
- Do not make the ALB sticky to hide shared-state problems.
- Do not remove the durable PostgreSQL realtime outbox or durable email/archive job records.
- Do not make Nylas provider state the Mango relationship identity.
- Do not combine Valkey and SQS into one unreviewable deployment.
- Do not preserve the old polling loops as automatic fallbacks.

## Investigation verification and gaps

Verified from repository code and history:

- 75 ms realtime spine interval and per-process startup;
- full-table aggregate shape in the current PostgreSQL realtime cursor path;
- `context.Background()` in the outbox repository hot methods;
- 30-second per-process email connection scanner;
- 250 ms per-process email ingestion worker poll;
- 250 ms communications archive worker poll;
- existing verified Nylas webhook path and `message.created` durable job creation;
- dev/prod Terraform desired backend count of two;
- correct Fargate IP target group, health check, CloudFront/API routing, private ECS ingress, and WebSocket heartbeat contract;
- recent automatic email-ingestion commit and the separate fix/revert history for the realtime query.

Verified through designated read-only database access during the investigation:

- outbox row scale and PostgreSQL table statistics described in the incident summary;
- approximately 40.15 current sequential scans per second, consistent with three 75 ms loops;
- no live database writes were performed.

Provided by operator logs/screenshots and requiring exact live mapping confirmation during implementation:

- sustained RDS CPU/ACU saturation;
- the two repeating connection IDs and 404/400 categories;
- the reported deleted-grant and Gmail-configuration interpretation;
- the separate valid `mangotestxd@gmail.com` Nylas grant.

Still missing or not verified:

- live ECS desired/running/pending task counts at the exact incident timestamps;
- live ALB target health and CloudFront/ALB configuration drift from Terraform;
- Performance Insights top-SQL/AAS breakdown for the complete incident window;
- exact connection-to-grant mapping for the two broken Mango connections;
- current Nylas webhook destination state and exact subscribed triggers in the affected environment;
- production-scale SQS throughput, Valkey connection, and cost measurements;
- post-fix Node endpoint plans after database contention is removed.

## Implementation completion checklist

- [ ] Capture current live baselines with approved read-only access.
- [ ] Add bounded-index outbox recovery queries and cancellation propagation.
- [ ] Add private ElastiCache Serverless Valkey and alarms.
- [ ] Add Valkey publish/subscribe, deduplication, reconnect, and recovery.
- [ ] Prove cross-task editor delivery and remove the 75 ms ticker.
- [ ] Add FIFO email queue, DLQ, encryption, IAM, and alarms.
- [ ] Add the dedicated ECS email-worker mode/service.
- [ ] Make Nylas webhook acceptance enqueue SQS and return quickly.
- [ ] Route durable ingestion and archive work through SQS.
- [ ] Add permanent/transient Nylas error classification and repair states.
- [ ] Add one approximately 10-minute EventBridge reconciliation tick.
- [ ] Remove 30-second and 250 ms database/provider polling loops.
- [ ] Update all affected Process Stories and numbered business laws.
- [ ] Run targeted unit/integration/failure/performance tests.
- [ ] Run the complete repository verification gate.
- [ ] Roll out Valkey and SQS separately with metrics and rollback evidence.
- [ ] Confirm RDS CPU/ACU, scan rates, queue age, and known broken-account behavior.

## Primary references

- AWS Application Load Balancer WebSocket/stickiness behavior: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html>
- AWS ECS with Application Load Balancers: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html>
- AWS ECS deployment task-count behavior: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-options.html>
- AWS ElastiCache deployment choices: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.deployment.html>
- Valkey Pub/Sub and at-most-once semantics: <https://valkey.io/topics/pubsub/>
- Nylas webhook delivery, retries, security, and failure states: <https://developer.nylas.com/docs/v3/notifications/?redirect=webhooks>
- Nylas `message.created` payload: <https://developer.nylas.com/docs/reference/notifications/messages/message-created/>
- AWS SQS FIFO queues: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html>
- AWS SQS visibility timeout, retries, and dead-letter queues: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
- AWS EventBridge Scheduler to SQS: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/getting-started.html>
