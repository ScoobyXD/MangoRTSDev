# V3 Email to Node

Date: August 6, 2026

Status: Approved Phase 1 implementation contract.

## Process Story

Mango continuously protects a connected mailbox without requiring the user to be logged in.

When an email connection is first activated, Mango records that exact activation time. Mango does not scan or import the user's older mailbox history. From that point forward, a verified Nylas message event creates a small durable ingestion job. The webhook returns quickly; it never downloads a thread in the webhook request.

The background worker fetches the new message through the exact connection that received it. The message must have arrived after the connection's ingestion boundary and must be in Inbox. An eligible new Inbox message is stored even when its thread has never been placed on a Node.

If the eligible message belongs to a provider thread, Mango asks Nylas for the complete thread available in that mailbox. Mango imports every missing or incomplete real message in that thread, including older messages that predate the activation boundary. Mango does not copy messages that are already complete, and it never turns quoted body text into fake messages.

If that stored thread is already on one or more Nodes, each newly completed message receives only the missing Node-wide email relationships for those same Nodes. Existing messages and relationships are not recopied. Text-box relationships are not propagated in this phase.

My Triage and Shared Triage remain responsive. Their visible email cards are a high-priority recovery signal and can enqueue ingestion immediately. A thread indicator shows that the provider card represents a thread. After a new message and its Node relationship commit, the Node indicator appears; clicking it opens the existing Node and shows the newly appended message inside the stored thread.

If a Nylas grant expires, Mango keeps the permanent connection, stored mail, checkpoint, and pending jobs. The user reauthenticates the same connection. Mango then catches up from the saved checkpoint in the background. Live webhook jobs and emails currently visible in My Triage or Shared Triage run before older reconnect-backlog jobs, so catch-up never blocks login or normal triage.

## Product Goal

The long-term product should make three actions easy:

1. Put an email on a Node.
2. Discuss that email with other people.
3. Create a shared draft for that email.

Phase 1 implements only the storage foundation required by those actions:

- continuously ingest new Inbox email;
- append missing messages to exact stored threads;
- propagate existing Node-wide placement to newly completed messages;
- expose the existing thread and Node indicators in My Triage and Shared Triage.

## Explicitly Out of Scope

Phase 1 does not implement:

- the universal email-to-Node picker;
- creating Nodes, Logic Gates, Projects, or text boxes from a picker;
- chat creation or chat-side-panel changes;
- shared-draft creation or collaborative-draft changes;
- automatic text-box placement;
- automatic Project or Logic Gate placement;
- importing provider drafts as received mail;
- deleting durable Mango mail when provider mail is deleted;
- a second sync service, Kafka, SQS, or another queue system.

## Core Terms

- Email connection: Mango's permanent internal record for one connected mailbox.
- Ingestion boundary: ingestion_started_at, set exactly once when ingestion is activated.
- Scan checkpoint: last_successful_scan_at, the end of the latest mailbox window whose discovered messages were all durably queued.
- Provider message ID: Nylas's message identity within one exact connection.
- Provider thread ID: Nylas's thread identity within one exact connection.
- Mango email thread ID: Mango's permanent internal thread identity.
- Mango email message ID: Mango's permanent internal message identity.
- Node-wide placement: an email_relationships row whose resource_type is node and whose resource_textbox_id is null.
- Live job: a job created directly from a verified new-message webhook.
- Visible-triage job: a job created because the message is currently visible in My Triage or Shared Triage.
- Backlog job: a job discovered by a checkpoint scan, including reconnect catch-up.

## Business Logic Laws

### Connection identity and activation

E2N1 - Mango has one email_connections table. Personal and shared connections are rows distinguished by connection_type, not separate runtime tables.

E2N2 - email_connection_id is Mango's permanent connection identity. Provider grant IDs are mutable provider metadata and never replace Mango identity.

E2N3 - A personal connection belongs to one exact company, one exact Mango user, and one normalized account email. A shared connection belongs to one exact company and normalized account email. Personal and shared connections never match one another.

E2N4 - A successful first OAuth connection sets ingestion_started_at and last_successful_scan_at to the same current database transaction timestamp.

E2N5 - Existing connected rows receive the migration transaction timestamp for both fields when this feature rolls out. This prevents a rollout from treating thousands of historical emails as new.

E2N6 - ingestion_started_at is immutable. Disconnect, expiry, scope change, reauthentication, deployment, and worker restart must not reset it.

E2N7 - Reauthentication updates the existing connection row in place. It preserves email_connection_id, ingestion_started_at, last_successful_scan_at, stored threads, stored messages, relationships, and queued jobs.

E2N8 - A new Mango user does not start ingestion merely by existing. Ingestion starts only after that user's mailbox connection succeeds.

E2N9 - Personal connection creation requires an exact company. Migration or runtime code must not guess between multiple company memberships.

### What Mango ingests

E2N10 - Every new Inbox message received on or after ingestion_started_at is eligible for durable storage, whether or not its thread is on a Node.

E2N11 - A message-created webhook is only a signal. The worker fetches the authoritative message through Nylas before storing it complete.

E2N12 - A triggering message whose provider received timestamp is before ingestion_started_at is ignored unless it is reached as historical membership of an eligible post-boundary thread.

E2N13 - Automatic ingestion requires exact Inbox membership. Sent-only, Drafts-only, Spam-only, Trash-only, and other non-Inbox trigger messages do not start automatic ingestion.

E2N14 - When an eligible message has a provider thread ID, Mango imports the complete provider thread available through that exact mailbox connection.

E2N15 - Thread messages older than ingestion_started_at are imported when they belong to an eligible post-boundary thread. This is thread completion, not mailbox-history backfill.

E2N16 - Mango cannot retrieve messages the connected mailbox never received and Nylas cannot expose. Quoted history stays inside the real message body and is never split into invented messages.

E2N17 - Unknown or unplaced threads are stored without Node relationships.

E2N18 - Completed stored messages are never downloaded or copied again. Only missing messages or rows whose download_complete is false are fetched.

E2N19 - If two or three messages arrived during an outage, reconciliation imports all missing messages available in that thread, not merely the newest visible card.

E2N20 - The unique database identity is exact company plus email connection plus provider thread for threads, and exact company plus Mango thread plus provider message for messages.

E2N20A - Triage placement enrichment must match company, permanent email_connection_id, and provider message ID. A provider message ID from another personal or shared mailbox must never supply a Node or Logic Gate icon.

E2N21 - Subject, participants, timestamps, quoted text, and similar content are never used to merge thread identity.

E2N22 - history_complete means complete as observed during the latest successful reconciliation. It never means a provider thread can no longer receive replies.

### Node placement

E2N23 - email_relationships remains the typed relationship authority. Phase 1 adds no central resource registry and no untyped generic edge.

E2N24 - For each newly completed message, Mango derives the distinct current Node-wide destination set from existing Node-wide relationships in that exact Mango thread.

E2N25 - Mango creates only the missing Node-wide relationship for the newly completed message and each current destination. It does not rewrite the thread or copy old relationships.

E2N26 - If the thread is currently placed on multiple Nodes, each newly completed message is placed on every one of those Nodes.

E2N27 - If the thread has no current Node-wide destination, ingestion stores the message and creates no Node relationship.

E2N28 - Text-box relationships are ignored when deriving automatic destinations in Phase 1. No new message is automatically placed on a text box.

E2N29 - Creating an email relationship does not create permissions, GVIC assignments, ownership, participants, or access. Normal Node authorization remains authoritative.

E2N30 - Message finalization and automatic Node-wide relationship creation are one database transaction. The Node icon must not appear before the relationship commit succeeds.

E2N31 - Relationship uniqueness remains company, internal Mango message, resource type, resource ID, and optional textbox ID. Repeated processing cannot create duplicate Node edges.

### Webhooks and priority

E2N32 - The fast path is a verified Nylas message.created webhook containing an exact grant ID and provider message ID.

E2N33 - The webhook validates its signature, resolves one exact connection, durably enqueues one job, preserves existing mailbox cache invalidation/live hints, wakes the worker, and returns. It performs no thread download.

E2N34 - Nylas webhook delivery is at least once. Duplicate deliveries must converge on the same active job and the same final stored message.

E2N34A - After a message ingestion job completes, another signal for that exact company, connection, and provider message reuses the completed result. Repeated triage views and delayed duplicate webhooks must not create fresh provider work for an already completed message.

E2N35 - My Triage and Shared Triage list responses inspect visible message identities and enqueue missing ingestion work without waiting for it.

E2N36 - Job priority order is:

1. live message-created webhook jobs;
2. emails visible in My Triage or Shared Triage;
3. ordinary periodic checkpoint scan jobs;
4. older reconnect-backlog jobs.

E2N37 - A newer higher-priority job may run before older backlog work. Priority changes processing order only; it never bypasses company, connection, Inbox, thread, or relationship validation.

E2N38 - Within the same priority, jobs run oldest available first.

E2N39 - Provider and attachment calls use the existing per-grant Nylas request gate. The worker claims only a small bounded batch and never creates unbounded parallel provider calls.

E2N39A - Checkpoint discovery and ingestion processing run in separate background loops under the same server shutdown lifecycle. A long reconnect scan may continue discovering backlog, but it cannot block the worker from claiming already queued live or visible-triage jobs.

### Checkpoint scans

E2N40 - Webhooks are the fast path, but a backend checkpoint scan is the reliability path. It runs while users are logged out.

E2N41 - A scan covers Inbox messages received after last_successful_scan_at minus a small fixed overlap and at or before scan_started_at.

E2N42 - The overlap prevents timestamp-boundary loss. Job and message uniqueness make overlap duplicates harmless.

E2N43 - Scans paginate with Nylas's supported message-list pagination and received-time filters. They enqueue identities; they do not download bodies inside the scan loop.

E2N44 - last_successful_scan_at advances to scan_started_at only after every page in that window has been read and every discovered message has been durably enqueued.

E2N45 - A failed page or failed enqueue leaves last_successful_scan_at unchanged so the entire window is safely retried.

E2N46 - Multiple backend instances may scan the same connection. Active-job uniqueness and final message uniqueness make this safe without a separate leader-election system.

### Expiry, disconnect, and reconnect

E2N47 - Mango subscribes to grant.expired and grant.updated and also treats a provider 401 as an expiration signal.

E2N48 - Expiration changes the connection status to reauth_required. It does not delete the grant record in Mango, reset checkpoints, erase mail, or fail waiting ingestion jobs permanently.

E2N49 - Jobs waiting on reauthentication do not burn through the normal provider retry limit. They become available again after the connection returns to connected.

E2N50 - The user reauthenticates through the normal Nylas OAuth flow. The OAuth callback updates the same Mango connection and wakes both the scanner and worker.

E2N51 - Reconnect never downloads mail inside login, OAuth callback, or page-load requests. Catch-up always runs in the background.

E2N52 - Nylas can replay a large notification burst after a short outage and may provide no notification backfill after a longer outage. Mango always performs its own checkpoint catch-up after reconnect.

E2N53 - Replay notifications and checkpoint discoveries use the same job identity. Receiving both cannot duplicate stored messages or relationships.

E2N54 - An explicit disconnect preserves the connection row, boundary, checkpoint, and durable stored mail. Reconnect resumes the same connection unless the product later defines an explicit permanent-forget command.

### Failure, security, and observability

E2N55 - Provider calls and object-storage calls occur outside long database transactions.

E2N56 - A provider or attachment failure leaves completed messages and existing relationships unchanged. Retry resumes from missing or incomplete messages.

E2N57 - Safe logs may include stable Mango IDs, provider operation names, status codes, and attempt counts. They must not include tokens, bodies, attachment bytes, temporary URLs, or secrets.

E2N58 - A job stores stable email_connection_id and provider identities. At execution time it loads the connection's current grant ID, so reauthentication does not require rewriting queued jobs.

E2N59 - Stored email access remains company-scoped and Node-authorized. A connection or relationship never permits cross-company reads.

E2N60 - During the in-place job-table cutover, an old full-thread job and old message job may both map to the same new connection/message identity. Mango keeps every job row, leaves the oldest such active row active, and marks only later redundant active rows completed with superseded_by_email_ingestion_cutover. The new worker's full-thread reconciliation makes the retained job sufficient.

## Required Storage Shape

### email_connections

The surviving table is company_email_connections renamed in place to email_connections. Its existing UUIDs and company rows remain in place.

Required columns:

- email_connection_id;
- company_id;
- connection_type: personal or shared;
- personal_user_id for personal rows;
- provider;
- account_email;
- grant_id;
- status: connected, disconnected, or reauth_required;
- connected_by_user_id;
- ingestion_started_at;
- last_successful_scan_at;
- created_timestamp;
- updated_timestamp.

Personal rows are copied once from user_email_connections into the surviving table, verified, and then user_email_connections is dropped. Ambiguous personal rows with zero or multiple possible companies must stop the migration rather than being guessed.

### email_threads

email_threads is altered in place:

- add and fill email_connection_id;
- make connection identity the mailbox authority;
- keep existing email_thread_id and every message/relationship reference;
- replace personal/shared provider indexes with one company, connection, provider-thread identity;
- remove duplicated account-scope columns after all code uses email_connection_id.

### email_ingestion_jobs

email_thread_download_jobs is renamed and altered in place to email_ingestion_jobs:

- ingestion_job_id;
- company_id;
- email_connection_id;
- nullable email_thread_id because a webhook can discover a novel thread;
- provider_message_id;
- provider_thread_id when known;
- priority;
- status, attempt count, error, availability, lease, and completion timestamps.

One active job is allowed for the same company, connection, and provider message. Completed historical jobs may coexist.

## Exact Runtime Flows

### New live email

verified message.created
-> resolve exact email connection by grant
-> ensure priority live job
-> invalidate mailbox cache and publish existing mailbox hint
-> return 200
-> worker validates boundary and Inbox
-> worker reconciles full available thread
-> store only missing/incomplete messages
-> atomically add Node-wide relationships for newly completed messages
-> publish exact mailbox and Node invalidations

### Visible triage email

provider My Triage or Shared Triage page
-> enrich existing thread/Node indicators
-> ensure priority visible-triage job for missing message
-> return page immediately
-> worker performs the same ingestion flow

### Reconnect catch-up

grant.expired or provider 401
-> mark permanent connection reauth_required
-> preserve checkpoint and waiting jobs
-> user reauthenticates
-> update same connection and mark connected
-> wake scanner
-> scan checkpoint window in pages
-> enqueue backlog jobs
-> advance checkpoint only after durable enqueue completes
-> process live and visible jobs before old backlog

## UI Contract

- The existing provider-thread indicator remains visible when the card represents multiple messages in a provider thread.
- The Node indicator is based only on an authorized committed Node-wide relationship for that exact provider message.
- My Triage and Shared Triage use the same indicator rules.
- Clicking the Node indicator opens the existing Node.
- After ingestion commits, the Node's stored email thread includes the newly completed message.
- List rendering never waits for thread ingestion.

## Rollout and Verification

The database rollout must:

1. preflight PostgreSQL 17.x compatibility and exact expected source columns;
2. stop on ambiguous personal connection-to-company mapping;
3. rename and alter existing tables in place;
4. preserve all existing UUIDs, messages, relationships, drafts, signatures, and attachments;
5. set both checkpoint timestamps to the rollout transaction timestamp for existing rows;
6. verify source/destination connection counts before dropping user_email_connections;
7. deploy code that uses only the final tables, with no compatibility readers or dual writes.

Required tests include:

- rollout does not backfill old mailbox history;
- an eligible new message imports older real messages from its available thread;
- unknown threads store without Node relationships;
- a known Node thread appends only missing messages;
- Node-wide relationships propagate only to newly completed messages;
- text-box rows do not propagate;
- duplicate webhooks and overlapping scans are idempotent;
- scan checkpoints advance only after complete durable enqueue;
- expired connections preserve jobs and checkpoints;
- reconnect backlog does not block login and has lower priority than live/visible work;
- My Triage and Shared Triage show thread and Node indicators correctly;
- clicking the Node shows the newly ingested message in the stored thread.

## Nylas Operational Basis

Nylas documents that expired grants should be reauthenticated rather than deleted, preserving the grant and sync state. Nylas also documents that short outages can cause notification replay while outages longer than 72 hours are not backfilled. Mango therefore treats webhooks as the fast path and its saved checkpoint scan as the permanent reliability path.

- https://developer.nylas.com/docs/cookbook/use-cases/build/handle-grant-expiry/
- https://developer.nylas.com/docs/reference/api/webhook-notifications/
- https://developer.nylas.com/docs/reference/api/messages/
