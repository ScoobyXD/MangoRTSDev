# V1 Backend Task Audit

Date: August 18, 2026

Status: Source-code, history, documentation, and recorded cloud-evidence audit complete. Live DEV and PROD data preflights remain pending. This document records current behavior, risks, and recommended future work. It does not authorize or implement backend, database, infrastructure, development, or production changes.

## Contents

- [Executive Decision](#executive-decision)
- [Audit Boundary](#audit-boundary)
- [Why These Processes Matter to Aurora](#why-these-processes-matter-to-aurora)
- [The Actual Disconnected-UI Heartbeat](#the-actual-disconnected-ui-heartbeat)
- [Process 1: Workspace Projection Recovery](#process-1-workspace-projection-recovery)
- [Process 2: Attachment Deletion Cleanup](#process-2-attachment-deletion-cleanup)
- [Process 3: Realtime Recovery](#process-3-realtime-recovery)
- [Process 4: Expired Upload Cleanup](#process-4-expired-upload-cleanup)
- [Process 5: Notification Cleanup](#process-5-notification-cleanup)
- [Cross-Cutting Findings](#cross-cutting-findings)
- [Simplest Target Architecture](#simplest-target-architecture)
- [Recommended Future Work Order](#recommended-future-work-order)
- [Required Acceptance Matrix for Any Implementation](#required-acceptance-matrix-for-any-implementation)
- [Current Source Map](#current-source-map)
- [Final Audit Conclusion](#final-audit-conclusion)

## Executive Decision

In the current deployed PostgreSQL and S3 configuration, Mango starts five PostgreSQL-backed background processes from the backend. Four run only in the API role. The realtime process runs in both the API and email-worker roles. Some source startup paths are conditional on repository, storage, backplane, and direct-upload feature support.

The business outcome and the timer that currently produces that outcome are separate decisions. Three outcomes are clearly required, notification retention is conditional on an explicit product decision, and workspace projection appears obsolete. Their current fixed database polling is not the simplest way to provide the required outcomes.

| Process | Current cadence | Current role | Audit decision | Confidence |
| --- | ---: | --- | --- | --- |
| Workspace projection recovery | Every 30 seconds | API | Repair the separate current creation-path gaps, then remove the obsolete subsystem after a read-only data preflight | High |
| Attachment deletion cleanup | Startup, event wake, and every minute | API | Keep the deletion guarantee; replace the per-minute global scan | High |
| Realtime recovery | Event driven plus every 10 minutes | API and email worker | Keep the core and current fallback for now; redesign ownership before removing the timer | High on keeping core; medium on timer replacement |
| Expired upload cleanup | Startup and every 15 minutes | API | Keep cleanup; move the fixed scan to bounded scheduled maintenance | High |
| Notification cleanup | Startup and every hour | API | Keep only after confirming the 30-day unread-retention policy; run daily rather than hourly | Medium until the product policy is explicit |

The recommended target is:

1. Repair the current Logic Gate creation-path placement gaps, then delete the dead workspace-derived projection path after a clean data preflight.
2. Keep attachment deletion immediate and retry-safe, but make it work-driven in every process that can create pending deletion work.
3. Keep the realtime outbox, publisher, recovery, Valkey, and WebSocket delivery system. Remove redundant worker subscriber work and the unconditional safety timer only after a complete producer/wake and crash-recovery proof.
4. Run attachment safety reconciliation, expired-upload cleanup, and notification retention through one bounded maintenance task that starts, finishes, closes its database connection, and exits.
5. Change the database pool and cold-resume behavior so a timer-free backend can actually release all user connections and reconnect successfully after Aurora pauses.

None of the five processes is the heartbeat that controls Mango's red Disconnected UI.

## Audit Boundary

This audit is intentionally read-only apart from this Markdown document.

It does not:

- change Go, TypeScript, SQL, Terraform, tests, or business logic;
- query or write a live application database;
- modify AWS, RDS, ECS, S3, Valkey, SQS, EventBridge, or GitHub Actions;
- approve a production rollout;
- approve dropping the workspace projection checkpoint table;
- replace the current numbered laws in docs/tests.

Current code and current docs/tests laws remain authoritative until a separately approved implementation updates them together.

## Why These Processes Matter to Aurora

Aurora Serverless v2 automatic pause is based on user connections, not on whether a query is expensive. A short empty query still opens or reuses a user connection. Aurora cannot begin its idle countdown while any user connection remains open.

AWS documents the following behavior:

- MinCapacity must be zero.
- The minimum automatic-pause interval is 300 seconds.
- Any open user-initiated connection prevents pause.
- A typical resume can take approximately 15 seconds.
- A database paused for more than 24 hours can take 30 seconds or longer to resume.
- Client connection timeouts and retry behavior must account for that delay.

Official reference:

https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html

### Current DEV evidence recorded on August 18, 2026

A read-only AWS inspection recorded:

- Aurora PostgreSQL 17.7 with one Serverless v2 writer.
- MinCapacity 0 ACU.
- MaxCapacity 2 ACU.
- SecondsUntilAutoPause 300.
- No RDS Proxy, reader, global cluster, zero-ETL integration, or logical replication blocker.
- Thirty-day ServerlessDatabaseCapacity minimum 0.5 ACU, average 1.603 ACU, maximum 2 ACU.
- Thirty-day DatabaseConnections minimum 1, average 11.37, maximum 55.
- Thirty-day IdleSessionCount minimum 7, average 16.79, maximum 54.
- No observed zero-capacity period or automatic-pause event.
- Engine uptime consistent with continuous operation since approximately May 20, 2026.
- Performance Insights attributed the largest current database load to the API task, with a much smaller contribution from the email worker and additional human database-tool sessions.

The infrastructure settings were valid. The application never supplied the required connection-free window.

### Current database pool behavior

Both the API and email worker use the same defaults in backend/cmd/miraeopus-api/main.go:

- DB_MAX_OPEN_CONNS: 20
- DB_MAX_IDLE_CONNS: 10
- DB_CONN_MAX_LIFETIME: 30 minutes
- DB_CONN_MAX_IDLE_TIME: 5 minutes
- DB_CONNECT_TIMEOUT_SECONDS: 5 seconds

Two supporting problems exist:

1. DB_MAX_IDLE_CONNS cannot currently be set to zero because the environment parser rejects zero and restores the default.
2. The five-minute connection idle limit is equal to Aurora's five-minute pause interval. Even after database work stops, the pool can retain user connections for approximately the entire Aurora idle interval before Aurora can begin its own countdown.

The current five-second connection timeout is also shorter than AWS's typical paused-database resume time.

Removing the blocking timers is necessary but not sufficient. The pool and cold-resume path must also be fixed.

### Nominal scheduled passes per 24 hours

With one long-running API task and one long-running email-worker task, under the current deployed PostgreSQL and S3 feature configuration, and assuming each pass finishes before the next timer:

| Process | Nominal timer passes per 24 hours | Typical empty database work |
| --- | ---: | --- |
| Workspace projection recovery | 2,880 | One company list plus checkpoint and event queries for every returned company, capped at 200 |
| Attachment deletion cleanup | 1,440 | One query for companies containing pending deletion work |
| Realtime recovery | 288 total: 144 in API and 144 in worker | An unpublished claim attempt plus published-event recovery work in each process |
| Expired upload cleanup | 96 | One query for expired or failed upload jobs |
| Notification cleanup | 24 | One transaction containing an expired-notification delete query |
| Total | 4,728 process passes | Actual SQL statement count is higher |

These are nominal timer opportunities, not guaranteed exact counts. Pass duration, process downtime, and timer coalescing can reduce them. Startup scans, event wakes, retries, and real work can add more database activity.

When the API service has two tasks, every API-owned timer is duplicated. Under the same assumptions, that topology produces approximately 9,312 nominal timer passes per 24 hours before counting startup, recovery, or event-driven work.

Reducing the API from two tasks to one reduces duplicate work. It does not create a five-minute idle window because one remaining 30-second loop and one remaining one-minute loop are enough to keep Aurora active.

## The Actual Disconnected-UI Heartbeat

The global realtime connection indicator uses a separate WebSocket application heartbeat.

Every 25 seconds:

1. The API sends an RFC 6455 protocol Ping.
2. The API also sends heartbeat.challenge with a one-time value.
3. Browser networking answers the protocol Ping automatically.
4. Mango's frontend answers heartbeat.challenge with heartbeat.response.
5. The API validates that one-time value in memory.
6. The API sends heartbeat.confirmed.
7. The frontend updates its last-confirmed heartbeat time.

The repeating path does not query PostgreSQL, call Valkey, call healthz, or refresh an authentication token.

The frontend:

- closes and reconnects a socket after 35 seconds without heartbeat.confirmed;
- shows Reconnecting immediately after an outage;
- shows Attempting to reconnect after 10 seconds;
- shows Disconnected after 60 seconds;
- can also enter terminal Disconnected immediately after a terminal authentication failure.

Connected additionally requires the server ready message, a settled answer for each requested subscription, and successful canonical recovery for every accepted subscription. Database failure can therefore prevent a new or reconnecting client from becoming green, but the 25-second heartbeat itself is database-free.

Main sources:

- backend/internal/http/realtime_ws.go
- frontend/src/modules/realtime/realtimeWebSocket.ts
- frontend/src/modules/realtime/RealtimeHealthChrome.tsx

Important consequence: Aurora can pause while ECS and an existing WebSocket remain alive. The heartbeat should never be changed into a database health query because that would defeat automatic pause.

## Process 1: Workspace Projection Recovery

Decision: Remove after a read-only DEV and PROD data preflight.

Confidence: High.

### Original purpose

This subsystem was introduced to move some derived workspace work out of a user's main request.

Its remaining supported task is:

- place a Logic Gate into an intended Company Explorer folder if that placement did not complete with the original workspace command.

The intended reliability sequence was:

1. Commit the main workspace change and a durable derived-projection request event.
2. Try the derived placement asynchronously after the request commits.
3. Save a per-company projection checkpoint.
4. If the process crashes or projection fails, replay domain events after that checkpoint.

The word projection means a secondary representation derived from authoritative data. The Company Explorer placement is the secondary representation; the Logic Gate and domain event are the durable source.

### Current startup behavior

At API construction, initializeWorkspaceDerivedDomainEventCheckpoints:

1. Lists companies.
2. Reads each company's workspace-derived checkpoint.
3. If a company has no checkpoint, reads the company's latest domain event through the notification-projection cursor helper. The underlying query is not limited to notification event types.
4. Saves that latest event as the initial checkpoint.

Initializing to the latest event deliberately avoids replaying all historical domain events when the feature first appears.

Source:

- backend/internal/http/workspace_derived_projection.go:30-60
- backend/internal/http/server.go:252-258

### Current request-path behavior

Several workspace, Logic Gate work, and RACI/GVIC handlers pass committed domain events to projectCommittedWorkspaceDerivedEventsWithTiming.

That function:

1. Copies the event list.
2. Starts a goroutine.
3. Calls ProjectWorkspaceDerivedDomainEvent for every event.
4. Usually performs no derived work because almost every event type is unrelated.
5. Saves the workspace-derived checkpoint for every processed event, including no-op events.
6. Starts a catch-up scan after projection or checkpoint failure.

This means the subsystem creates database checkpoint writes after ordinary workspace events even when no current event requests derived work.

Sources:

- backend/internal/http/workspace_derived_projection.go:151-195
- backend/internal/http/gvic_matrix_handlers.go
- backend/internal/http/logic_gate_work_handlers.go
- backend/internal/http/workspace_entity_batch_handlers.go

### Current 30-second behavior

After each completed pass, each API task waits 30 seconds and then:

1. Selects up to the general company-list limit of 200 companies; it does not paginate beyond that result.
2. Reads that company's projection checkpoint.
3. Selects up to 100 domain events after the checkpoint.
4. Calls the projector for each event.
5. Advances the checkpoint after each event.

An empty system still performs the company, checkpoint, and event queries.

A busy system adds one checkpoint upsert per processed event, even when the event produces no derived change.

Sources:

- backend/internal/http/workspace_derived_projection.go:13-14
- backend/internal/http/workspace_derived_projection.go:63-148
- backend/internal/store/postgres_workspace_derived_projection.go
- backend/internal/store/postgres_domain_events.go

### What the projector can still do

The PostgreSQL projector recognizes:

- workspace_derived_projection_requested
- the legacy company_explorer_folder_item_assign_requested event

The only remaining task kind is Company Explorer folder placement for a Logic Gate.

It:

1. Validates the company, Logic Gate, and folder.
2. Finds the next row position if one was not supplied.
3. Inserts company_explorer_items only if the Logic Gate is not already placed.
4. Appends company_explorer_item_placed when a row is inserted.
5. Publishes that normal workspace event.

It no longer supports a general collection of workspace projections.

The surviving task data can still carry system_folder_key, but the projector does not read that field. It requires an explicit folder_id and returns without doing work when folder_id is blank. Historical requests that depended only on a system-folder key cannot be repaired by the current loop.

Source:

- backend/internal/store/postgres_workspace_derived_projection.go:57-145

### Producer audit

No non-test in-repository producer was found at the audited revision.

Current code still:

- defines WorkspaceEntityBatchResult.DeferredFolderItems;
- reads DeferredFolderItems in workspace_entity_batch_handlers.go;
- knows how to turn a nonempty field into workspace_derived_projection_requested.

A repository-wide non-test search found no production assignment or append to DeferredFolderItems.

The two derived event constructors also have no current non-test producer other than the handler that consumes this always-empty field.

### History explaining the orphan

- Commit 5142734a introduced the general workspace-derived projection checkpoint and recovery system on June 1, 2026.
- Commit d8b6a416 expanded and changed that design.
- Commit 7f0c65c4 performed the final Company Explorer cutover on June 20, 2026, removed the block that populated DeferredFolderItems, and also removed synchronous folder-placement SQL from the GVIC/Matrix Logic Gate helper.
- Commit 7229d49f made default Explorer placement synchronous in the workspace entity batch path, but did not repair the separate GVIC/Matrix creation path.
- Commit efd376ad later removed the old Node and Logic Gate map paths but left the projection loop.

Current Company Explorer laws require creation-time placement and prohibit reads from silently repairing placement. The workspace entity batch path writes explicit placement synchronously, but the audit found at least two current backend creation paths that do not.

The timer and async checkpoint machinery survived the request-event producer they were created to recover.

### Current Company Explorer correctness gaps found by this audit

#### GVIC/Matrix creation

The active GVIC/Matrix node creation endpoint can create a new Logic Gate from create_logic_gate_header.

That path:

1. Calls CreateRACIMatrixNode.
2. Creates the Logic Gate through createRACIMatrixLogicGateTx.
3. Enters a syncFolderItem timing block that currently contains no folder insert.
4. Returns no DeferredFolderItems request.
5. Appends logic_gate_created, but not workspace_derived_projection_requested.
6. Passes the event to the derived projector, which ignores logic_gate_created.

The result is that this current creation path can violate Company Explorer law E27, which requires a bare Logic Gate created outside Company Explorer to appear in Unfiled/Logic Gates. It can also violate the E71 creation-time-placement rule.

#### Communications email conversion

The communications triage conversion backend also accepts a new_logic_gate target.

That path:

1. Inserts the new row directly into logic_gates.
2. Inserts no company_explorer_items row for it.
3. Emits logic_gate_created, but not a derived-request event.
4. Passes no placement request to the workspace projector.

This path has the same E27 and E71 risk. Whether every current frontend exposes the mode does not change that it remains an accepted production backend path.

The 30-second recovery process does not repair these gaps because it has no derived-request event to consume. Keeping the timer therefore does not preserve the missing behavior.

These are separate future backend correctness changes. The simplest target is to place each new Logic Gate synchronously in its creation transaction, following the current Company Explorer laws. That implementation and its law/test updates require separate approval; this audit does not make them.

Sources:

- backend/internal/http/gvic_matrix_handlers.go:92-145
- backend/internal/store/postgres_gvic_matrix_commands.go:10-46
- backend/internal/store/postgres_gvic_matrix_commands.go:117-161
- backend/internal/http/communications_triage_handlers.go:21-40
- backend/internal/store/postgres_communications_triage.go:206-221
- backend/internal/store/communications_email_conversion.go:90-99
- backend/internal/store/communications_email_conversion.go:151-155
- docs/tests/company explorer.md, E27 and E71

### Correctness weakness if the subsystem were revived

The checkpoint is shared per company while async projection goroutines can overlap.

A newer unrelated event can finish first and advance the monotonic checkpoint past an older event whose derived projection has not finished. If the older projection then fails, a catch-up query starting after the newer checkpoint can skip it permanently.

This checkpoint race is dormant because no non-test in-repository path appears to emit the derived request. It is separate from the active creation-path placement gaps above. It does show that the subsystem should not be retained as a future generic recovery system.

### What breaks if it is removed

With current in-repository derived-request producers: no expected projector behavior.

Removal also does not worsen the active placement gaps because the recovery loop currently ignores their logic_gate_created events. The creation paths still must be fixed before the workspace subsystem is declared complete and removed.

If an external writer or unprocessed historical event still depends on it: a requested Logic Gate folder placement could remain missing.

That uncertainty is why removal needs a read-only data preflight rather than an assumption.

### Required read-only preflight before future deletion

First inventory every current project and Logic Gate creation path and repair any path that does not perform the Company Explorer placement required by E27 and E71. Then run the following separately in DEV and PROD using the database-enforced read-only credential:

1. Count domain_events for workspace_derived_projection_requested.
2. Count domain_events for company_explorer_folder_item_assign_requested.
3. List the latest such event for each company.
4. Compare those events with workspace_derived_domain_event_projection_checkpoints.
5. Identify any derived request after its company's checkpoint.
6. Separate requests containing an explicit surviving folder_id from legacy requests containing only system_folder_key, which the current projector ignores.
7. For each request, verify whether the intended company_explorer_items row exists.
8. Count every logic_gates row with no matching company_explorer_items logic_gate row and investigate its creation path without exposing unrelated data.
9. Confirm no external integration writes either event type.
10. Confirm every current project and Logic Gate creation path performs its required Explorer placement synchronously.

Do not retrieve or expose unrelated event payloads or credentials during that preflight.

### Recommended future removal scope

After the creation-path repair and a clean preflight:

- remove the 30-second timer;
- remove startup checkpoint initialization;
- remove post-request async projection hooks;
- remove the unused DeferredFolderItems result;
- remove derived task and event constructors;
- remove the repository interface and PostgreSQL projector;
- remove synthetic tests that exist only for the obsolete path;
- update Company Explorer and realtime test laws to state the synchronous invariant;
- separately migrate and remove workspace_derived_domain_event_projection_checkpoints from the canonical schema.

The final table removal would be a database/schema change and requires separate approval and rollout planning.

### Existing tests and gaps

Existing tests prove synthetic projector behavior:

- backend/internal/http/workspace_derived_projection_test.go
- backend/internal/store/postgres_workspace_derived_projection_test.go
- backend/internal/store/domain_events_test.go

No end-to-end test proves that a current non-test command creates a deferred request. That missing producer test is consistent with the source audit.

Current GVIC/Matrix and communications-email conversion tests exercise their Logic Gate creation operations but do not assert the Company Explorer E27 placement invariant. Future repair work needs direct tests that the new Logic Gate has exactly the required Explorer placement when the creation transaction commits.

### Relationship to the UI heartbeat

None.

When it did real work, it could publish an ordinary company_explorer_item_placed data event. That event never updated heartbeat confirmation state.

## Process 2: Attachment Deletion Cleanup

Decision: Keep the safety guarantee. Replace the unconditional one-minute per-API scan only after every producer and retry path has a durable replacement.

Confidence: High.

### Required business invariant

An attachment can have:

- one authoritative attachments row;
- an original S3 object;
- zero or more preview S3 objects;
- several attachment_relationships owners;
- an S3 key shared with retained attachment or upload records.

Removing one owner must keep the file when another valid owner survives.

Removing the last active owner must:

1. Mark the attachment pending deletion immediately so new reads and links fail.
2. Retain its database keys while storage cleanup is incomplete.
3. Recheck that no owner reappeared.
4. Protect an object still referenced by retained attachment, preview, or upload data.
5. Delete the original and preview objects from S3.
6. Treat an already-missing S3 object as successful deletion.
7. Hard-delete relationships, previews, and the attachment row only after every unprotected object is gone.
8. Leave a temporary failure retryable without losing the only stored object key.

This behavior is mandatory. PostgreSQL and S3 cannot participate in one atomic transaction, so retryable cleanup is the correct exception to same-transaction deletion.

Binding sources:

- docs/tests/attachments.md, especially ATT63 through ATT73
- docs/tests/relationships.md
- backend/internal/attachmentcleanup/service.go

### Current trigger topology

The API starts the cleanup and runs it:

- immediately at startup;
- after a value arrives on a process-local wake channel;
- every minute.

Known wake callers include:

- direct attachment unlink/delete handlers;
- communications handlers;
- email ingestion/convergence work.

Sources:

- backend/internal/http/attachment_deletion_cleanup.go:149-182
- backend/internal/http/attachment_handlers.go
- backend/internal/http/communications_handlers.go
- backend/internal/http/communications_email_ingestion_worker.go

### Current empty pass

Every minute, the API queries for distinct companies containing deleted attachments with no active relationship.

If none exist, that one query still opens or reuses a database connection.

If companies exist, the service processes up to 100 work items per company in that pass.

Sources:

- backend/internal/store/postgres_attachment_cleanup.go
- backend/internal/http/attachment_deletion_cleanup.go

### Current work pass

For each candidate:

1. Recheck that the attachment is still ownerless.
2. List the original and preview object references.
3. Check whether each object is shared with retained attachment or active upload data.
4. Delete each unprotected S3 object.
5. Skip deleting a protected shared object.
6. Treat object-not-found as already deleted.
7. Stop and leave the database record pending after other S3 errors.
8. Lock and recheck the database state.
9. Hard-delete the final rows only after storage success.

The operation is retry-safe and intentionally conservative.

### Why the one-minute timer currently matters

The wake channel exists only inside one process.

The email worker can create pending attachment deletion work and call wakeAttachmentDeletionCleanup. However, EmailWorkerOnly skips startAttachmentDeletionCleanup. The worker therefore writes to a process-local wake channel that has no consumer.

The API's global one-minute scan is currently the mechanism that eventually discovers that worker-created work.

In addition, several owner-deletion repository paths can mark an attachment pending without having a proven handler-level wake. There is no complete test demonstrating that every final-owner deletion produces a live wake in the correct process.

Deleting the timer today would create a real risk of permanent database tombstones and retained S3 bytes.

### What breaks if the entire cleanup is removed

- Deleted attachment bytes can remain in S3 indefinitely.
- Preview bytes can remain indefinitely.
- Pending-deletion attachment rows and relationships accumulate.
- Storage cost and data-retention exposure grow.
- Future identifiers or keys can remain blocked by tombstones.
- User-facing deletion may appear successful because access is denied immediately, while physical deletion never finishes.

It does not control the connection indicator.

### Recommended target

Keep the existing attachmentcleanup service and database rows as the durable work record.

Replace fixed empty polling with:

1. Start an event-driven cleanup consumer in every role that can create pending work.
2. Audit every final-owner deletion path and issue a post-commit wake in the same process.
3. Drain all available bounded batches after a real wake instead of processing only one batch.
4. Perform one recovery scan at process startup, when that process is already connecting to PostgreSQL.
5. Use bounded retry with delay only after genuine database or S3 failure.
6. Stop all database work after the queue drains.
7. Run one low-frequency, single-owner safety reconciliation through scheduled maintenance to cover a crash after commit but before wake, a missed producer, or a long-lived storage failure.

A daily safety pass is reasonable because normal deletions remain immediate. The daily task is only recovery insurance.

### Required verification before removing the minute timer

- Inventory every path that can retire an attachment's final relationship.
- Cover work created by the API and by the email worker.
- Kill a process after the database commit but before the wake; verify startup or scheduled recovery.
- Test concurrent consumers against the same attachment.
- Preserve shared-key protection.
- Preserve missing-object success.
- Preserve partial S3 failure and retry.
- Preserve S3-before-PostgreSQL finalization.
- Prove an idle consumer performs zero database calls after startup.
- Prove a scheduled run drains more than one 100-item batch but remains bounded.
- Record metrics for trigger reason, examined count, completed count, failed count, duration, and remaining work.

### Existing tests and gaps

The safety service has strong focused tests:

- backend/internal/attachmentcleanup/service_test.go
- backend/internal/attachmentcleanup/postgres_test.go
- backend/internal/http/attachment_deletion_cleanup_test.go
- backend/internal/store/attachment_upload_schema_test.go

The missing proof is topology:

- no test proves wake coverage for every deletion producer;
- no test proves the email-worker wake reaches a running consumer;
- no test proves multi-task single-owner behavior;
- no test proves zero repository calls after an idle wake-driven consumer drains.

### Relationship to the UI heartbeat

None.

Attachment deletion produces no heartbeat message. Heavy cleanup could indirectly consume shared resources, but it does not set realtime health state.

## Process 3: Realtime Recovery

Decision: Keep the realtime spine and keep the current ten-minute safety pass until a replacement has a complete correctness proof. Redesign the worker and safety ownership afterward.

Confidence: High that the core is required. Medium that the timer can be removed without a new durable owner.

### Required business invariant

The target invariant is: when a business transaction changes data that another browser should learn about, a compact realtime_outbox row must exist durably before the operation is considered complete.

Many store mutations meet the strongest form of that invariant by writing the business change and outbox row in the same PostgreSQL transaction. This audit found current production exceptions described below.

For an atomic producer, the durable path is:

1. Commit canonical product data and the outbox row atomically.
2. Return the durable HTTP result without waiting for Valkey.
3. Wake the local realtime publisher after commit.
4. Claim pending outbox rows.
5. Publish a compact event through Valkey.
6. Mark the outbox row published.
7. Deliver the event to matching local WebSocket subscribers.
8. Recover through PostgreSQL after a broker reconnect, sequence gap, or buffer overflow.

The outbox protects the save from broker failure. Valkey announces the change across ECS tasks. WebSockets deliver to browsers connected to the receiving API task.

Binding sources:

- docs/tests/valkey.md
- docs/tests/REST API & WebSocket.md, especially RW66 and RW67
- backend/internal/http/realtime_spine.go
- backend/internal/store/postgres_realtime_outbox.go

### Current outbox atomicity exception found by this audit

Not every realtime event is committed in the same transaction as its business change.

The concrete current gap is the message.opened webhook path. It first commits communications read-receipt status through UpsertCommunicationsMessageReadStatusContext. It then builds the mailbox-change hint and calls enqueueRealtimeOutboxAndWake, whose EnqueueRealtimeOutbox operation uses a separate transaction.

This creates a failure window:

1. The read-receipt status commits.
2. The process dies before the separate outbox enqueue commits.
3. No outbox row exists.
4. Startup recovery and the ten-minute safety scan have nothing to claim, so they cannot recover that missing mailbox hint.

This is different from a lost wake after a durable outbox insert. The current safety scan repairs an existing unpublished row; it cannot recreate a row that was never inserted.

The repository also uses standalone enqueue helpers for some terminal archive and email-queue redelivery paths, but those are not the same bug: their original state transition already inserted the outbox event atomically. The later call idempotently reasserts the stable event and wakes the publisher; it can wake an existing unpublished row but does not republish a row that is already marked published. Provider-only hints that have no local business transaction also need producer-specific retry analysis rather than being labeled an atomicity failure automatically.

Current laws intentionally use webhook redelivery as this path's recovery mechanism. An enqueue error releases the in-memory receipt and returns failure, and a process crash before the response cannot acknowledge the webhook. On a replacement process the in-memory receipt cache is also gone, so provider redelivery can repeat the idempotent read-status write and create the hint. The risk is therefore not necessarily permanent loss; it is dependence on an external, finite provider retry instead of recovery from Mango's committed database state. The ten-minute PostgreSQL scan cannot guarantee or observe that recovery from the read-status row alone.

Official provider retry reference:

https://developer.nylas.com/docs/v3/notifications/?redirect=webhooks#retry-a-webhook

Before changing the recovery cadence, a future implementation must classify every producer as atomic or standalone, decide whether any standalone loss is acceptable, and move every required durable notification into the business transaction. This audit records the gap but makes no backend change.

Sources:

- backend/internal/http/communications_stream_handlers.go:134-169
- backend/internal/http/communications_stream_handlers.go:390-450
- backend/internal/http/communications_archive_worker.go:156-206
- backend/internal/http/communications_email_queue.go:270-332
- backend/internal/store/postgres_communications.go:561-686
- backend/internal/store/postgres_communications_archive_jobs.go:308-415
- backend/internal/store/postgres_email_ingestion_jobs.go:289-423
- backend/internal/store/postgres_realtime_outbox.go:52-65
- backend/internal/http/realtime_spine.go:650-666
- docs/tests/email.md, EMAIL85
- docs/tests/REST API & WebSocket.md, RW52
- docs/tests/shared-triage.md, ST168

### Normal event-driven behavior

Normal publication does not wait ten minutes.

A producer inserts the outbox row and signals the local spine. The spine:

1. Claims fixed-size batches using a lease.
2. Publishes each event.
3. Marks it published.
4. Performs local delivery.
5. Chains another bounded wake when four full batches prove more work may remain.

Failures receive bounded retry:

- claim failure;
- Valkey publish failure;
- mark-published failure;
- claim-release failure;
- published-event recovery failure;
- Valkey subscriber reconnect.

This replaced the former 75-millisecond database poll.

### Startup and admission behavior

Every process first reads the current published outbox sequence.

The API does not admit realtime tickets or WebSockets until that cursor is certified and the subscriber and spine loops are launched. Before certification, realtime admission returns retryable realtime_not_ready while ordinary durable HTTP operations remain available.

Subscriber readiness and reconnect signal:

- claim unpublished work;
- recover published work after the certified cursor.

The admission gate protects a new API task from accepting a client while it could miss an event.

### Current ten-minute safety pass

Every API and every email-worker process starts the same full realtime spine.

Every ten minutes, each process:

1. Attempts to claim any unpublished outbox work.
2. Reads published events after its local cursor.

An empty pass still performs database work.

With one continuously running API and one continuously running worker, this is nominally 288 timer passes per 24 hours when each pass completes before the next tick.

This cadence still matters to Aurora. With the current five-minute pool idle limit followed by Aurora's five-minute pause countdown, a ten-minute safety scan leaves effectively no scheduling margin and can prevent a completed pause. If the pool is changed to close idle connections immediately, Aurora could pause between scans, but the next scan would deliberately resume it. Keeping this fallback for correctness is therefore a real cost tradeoff until ownership and recovery are redesigned.

Source:

- backend/internal/http/realtime_spine.go:195-217
- backend/internal/http/server.go:252-259

### Why the fallback exists

For atomic producers, the business change and outbox row commit together. The post-commit wake cannot be part of that PostgreSQL transaction.

Failure window:

1. PostgreSQL commits the business row and unpublished outbox row.
2. The process dies or a caller fails before the process-local wake is handled.
3. Valkey cannot announce an event it never received.

Current startup recovery normally repairs a crashed process after ECS replaces it. The ten-minute pass additionally protects against:

- a missing post-commit wake in one producer;
- an unexpected lost signal while a process remains alive;
- a broker message missed without an observed reconnect or sequence gap;
- a future defect in event-driven recovery.

Current numbered laws explicitly retain this fallback. It must not be deleted solely because it is less frequent than the old hot poll.

For a standalone publisher that creates a new required hint, this protection begins only after the separate outbox enqueue succeeds. That is why the fallback cannot close the message.opened atomicity exception documented above. A standalone reassertion of an already-durable outbox outcome does not have the same failure window.

### API versus email-worker audit

The API needs:

- outbox publication;
- a Valkey subscriber;
- a published-event cursor;
- sequence recovery;
- permission-aware local WebSocket fanout.

The email worker needs:

- to commit email-related outbox rows;
- to publish its local post-commit work;
- publication failure retry.

The email worker has no HTTP listener and no browser WebSocket registry to serve. Its full Valkey subscriber and published-event replay path currently consumes database and broker work without a local browser consumer.

The worker should eventually become publisher-only.

### Relationship to the UI heartbeat

The ten-minute recovery pass is not the 25-second WebSocket heartbeat.

Recovered Kanban, chat, notification, mailbox, editor, or other events do not update lastHeartbeatConfirmedAt.

An existing WebSocket can remain green while:

- Valkey is disconnected;
- an outbox row is waiting to publish;
- the ten-minute safety scan is failing.

Conversely, a browser can be disconnected while the outbox process and database are healthy because the WebSocket, load balancer path, authentication, or subscription recovery failed.

The initial cursor query is an indirect dependency: a new API task that cannot certify the cursor returns realtime_not_ready, causing clients to retry.

### What breaks if the entire realtime spine is removed

- New API tasks never become realtime-ready.
- Cross-task live updates stop.
- Email-worker changes do not reliably reach browsers.
- Broker failures can strand durable outbox rows.
- Reconnect and sequence-gap recovery disappear.
- Browsers can remain stale until manual canonical reads.

The core must remain.

### Recommended target

Do not remove the ten-minute pass in the first cleanup change.

First:

1. Audit every realtime producer, classify whether its business change and outbox row are atomic, close required atomicity gaps, and prove every committed outbox insertion issues a post-commit wake.
2. Split the email worker into publisher-only behavior.
3. Keep API subscriber and fanout behavior.
4. Trigger API recovery at startup, subscriber ready/reconnect, sequence gap, inbound overflow, bounded failure retry, and first active browser subscription after an idle period.
5. Add an observable alarm for oldest unpublished outbox age and unpublished row count.
6. Add fault tests for both a crash before the message.opened standalone enqueue and a lost post-commit wake after an atomic enqueue.

Only after that proof should Mango choose between:

- no fixed safety timer;
- one elected or dedicated unpublished-event safety owner;
- a substantially less frequent single-owner safety audit.

Published-event recovery remains task-local for API tasks because each API has its own cursor and local subscribers. Removing its timer requires proof that reconnect, gap, overflow, startup, and first-subscription signals cover every failure.

### Required verification before changing the fallback

- Business commit succeeds and the process dies before wake.
- A message.opened read-status commit succeeds and the process dies before its separate outbox enqueue.
- Valkey publish fails.
- Mark-published fails after broker publication.
- Claim release fails and the lease expires.
- A broker message is missed.
- A sequence gap occurs.
- The inbound buffer overflows.
- The API restarts with unpublished work.
- The worker commits an email event.
- Multiple API tasks publish and subscribe concurrently.
- A browser first subscribes after a long idle period.
- No users and no events cause zero periodic database queries in the proposed design.
- The WebSocket heartbeat stays green without querying PostgreSQL.

### Existing tests and gaps

Current recovery tests are extensive:

- backend/internal/http/realtime_backplane_test.go
- backend/internal/http/realtime_spine_retry_test.go
- backend/internal/store/realtime_outbox_query_test.go
- backend/internal/store/realtime_postgres_integration_test.go
- infra/tests/valkey_realtime.test.mjs

Required new evidence:

- an exhaustive producer-to-post-commit-wake contract;
- worker publisher-only tests;
- first-active-subscription recovery;
- explicit zero-database-work idle tests;
- metrics and alarms for unpublished age.

### Documentation contradiction

docs/tests/valkey.md describes one ten-minute pass for each API task. Current code also starts the full pass in the email worker.

Several documents say adding idle API tasks adds no steady-state outbox polling. The intended distinction is no hot 75-millisecond polling. A ten-minute per-task scan is still periodic database work and should be stated plainly.

## Process 4: Expired Upload Cleanup

Decision: Keep cleanup behavior. Replace the 15-minute API timer with one bounded scheduled maintenance runner.

Confidence: High.

### Required business invariant

Direct browser uploads use durable upload jobs because bytes go from the browser directly to private S3.

The control flow is:

1. Mango creates an attachment_upload_jobs row and permanent attachment ID.
2. Mango returns a short-lived signed single-PUT or multipart request.
3. The browser uploads bytes directly to S3.
4. The browser calls Mango completion.
5. Mango verifies S3 state.
6. Mango creates permanent attachment metadata and ownership only after successful completion.

A browser can close, lose its network, abandon multipart work, upload a single-PUT object without completing Mango's control request, or leave a failed job.

Those abandoned resources must eventually be cleaned.

Binding sources:

- docs/tests/attachments.md, ATT29 and AST5
- backend/internal/http/attachment_direct_upload_handlers.go
- backend/internal/store/postgres_attachment_uploads.go

### Current configuration

Defaults:

- Upload job lifetime: 24 hours by default and configurable per environment.
- Single-PUT signed URL lifetime: 1 hour.
- Multipart part signed URL lifetime: 15 minutes.
- Cleanup interval: 15 minutes.
- Cleanup batch: up to 100 jobs.

Sources:

- backend/internal/http/attachment_direct_upload_config.go
- backend/internal/http/attachment_direct_upload_handlers.go:613-685

### Current startup and timer behavior

At API startup, then every 15 minutes:

1. Select up to 100 expired jobs in pending, uploading, or completing status, plus any failed jobs regardless of expiration.
2. For a job whose upload strategy is multipart, call AbortMultipartUpload.
3. Delete the object key.
4. Mark the job expired.

If abort or object deletion fails, the job remains eligible for another pass.

An empty run still performs the selection query.

### Current completion-versus-cleanup race found by this audit

The current selection includes an expired job in completing status without first atomically claiming or locking it for cleanup. Cleanup then aborts or deletes S3 data before it owns a fenced database state.

A legitimate completion can therefore already be operating when the job crosses its expiration time:

1. Completion moves or observes the job in completing state.
2. The expiration time passes while completion is still working.
3. Cleanup selects the same job.
4. Cleanup deletes its S3 object.
5. Completion can still finish database work or cleanup can later observe a completed state after the bytes are gone.

That can leave durable attachment metadata referring to missing storage. A slower timer reduces how often the race is attempted but does not make it correct.

Any future cleanup redesign must first create mutual exclusion between completion and cleanup. The cleanup runner must atomically claim an eligible job, prove completion no longer owns it, and recheck the final state before deleting S3 data. The exact state-machine change needs a separately approved backend and possibly schema design; this audit does not implement it.

### Why S3 lifecycle is not a full replacement

DEV and PROD Terraform declare S3 AbortIncompleteMultipartUpload with a default of two days. Repository source alone does not prove that the rule is currently applied to both live buckets or that an untracked environment value did not override the default.

AWS lifecycle can delete the stored parts of an incomplete multipart upload. It does not:

- mark Mango's database job expired;
- remove a successfully completed multipart object that Mango never finalized;
- distinguish and remove an unfinalized single-PUT object stored at a final-looking attachment key.

Official S3 reference:

https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html

Application cleanup remains required. The declared lifecycle rule is the correct disaster-recovery backstop for multipart parts when it is applied to the live bucket.

### Why 15 minutes is excessive

At the default 24-hour job lifetime, the API asks the database approximately 96 times before a normally aging job first becomes eligible. A deployed override changes that ratio.

The business law requires eventual cleanup and correct expired versus aborted status. It does not require detecting natural expiration within 15 minutes.

### What breaks if cleanup is removed

- Incomplete multipart parts can incur S3 storage cost until lifecycle aborts them.
- Unfinalized single-PUT objects can remain indefinitely.
- Completed-in-S3 but unfinalized multipart objects can remain indefinitely.
- Failed and expired database jobs remain in active-looking states.
- Resume and retry behavior can encounter stale work.
- Database rows accumulate.

It does not control the connection indicator.

### Recommended target

Move this cleanup into the same explicit maintenance command used for low-frequency attachment safety reconciliation and notification retention.

Recommended behavior:

1. Run daily in DEV.
2. Choose daily or a deliberately approved tighter cadence in PROD.
3. Query a bounded batch.
4. Continue through bounded batches until no work remains or an explicit run limit is reached.
5. Report remaining work and exit nonzero or emit an alarm when the cap is reached.
6. Atomically claim cleanup ownership and exclude a concurrent completion before touching S3.
7. Abort multipart work before deleting the object.
8. Recheck the final state and mark expired only after storage cleanup succeeds or the object is already absent.
9. Verify and keep the declared S3 multipart lifecycle backstop in each live environment.
10. Close all resources and exit rather than sleeping.

AWS EventBridge Scheduler can run a one-time or recurring ECS task:

https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html

### Required verification

- Abandoned single PUT.
- Abandoned incomplete multipart upload.
- Multipart upload completed in S3 but not finalized in PostgreSQL.
- Cleanup racing with legitimate completion.
- Object already missing.
- Abort failure.
- Delete failure.
- Database expire failure.
- More than 100 eligible jobs.
- Repeated idempotent execution.
- Scheduled runner exits and leaves no database connection.

### Existing tests and gaps

Existing tests include:

- one handler success test for expired multipart abort, delete, and expired status;
- memory-repository selection behavior;
- static infrastructure coverage for lifecycle configuration.

Missing:

- S3 failure and retry tests for this exact cleanup;
- delete-before-expire ordering failure;
- batch continuation;
- timer/startup ownership;
- PostgreSQL integration coverage;
- multi-API-task races;
- cleanup metrics.

### Relationship to the UI heartbeat

None.

Expired-upload cleanup does not send or confirm the WebSocket heartbeat. Its database or S3 load can indirectly affect shared service performance, but it does not set the frontend connection state.

## Process 5: Notification Cleanup

Decision: First make the retention rule explicit. If 30-day unread expiration remains approved, keep the policy but run it daily through the single maintenance task.

Confidence: High that hourly execution is unnecessary. Medium on the retention policy because current law coverage is incomplete.

### Current policy

At API startup and every hour:

1. Calculate now minus the retention duration.
2. Default retention to 30 days.
3. Delete unread notifications older than the cutoff in batches.
4. Preserve notifications whose read_timestamp is non-null.
5. Insert one realtime outbox deletion event for each deleted notification in the same transaction.
6. Publish the deletion hints so an open Updates UI removes the rows.
7. Repeat until a batch returns no deleted rows.

Sources:

- backend/internal/http/notification_cleanup.go
- backend/internal/store/postgres_notifications.go:509-566
- backend/internal/store/repository.go

### Empty behavior

An empty run still:

1. Opens a PostgreSQL transaction.
2. Runs a delete common-table expression that finds zero rows.
3. Commits the transaction.

This happens hourly in every API task.

### Important policy detail

The process deletes old unread notifications.

It deliberately preserves read notifications as Seen Updates history, even when those rows are older than 30 days.

This means the job is not a complete table-retention policy. It prevents ignored unread items from growing forever, but read history can still grow without a bound.

Historical design notes once said notifications should not live forever. Commit 6e5f3695 deliberately changed cleanup to unread-only so Seen history survives. That newer behavior supersedes the older blanket statement.

The exact 30-day unread cutoff is not clearly stated as a numbered rule in docs/tests/updates.md. It should be made explicit before implementation changes.

### Realtime outbox side effect

The PostgreSQL cleanup creates one durable realtime_outbox row for every notification row it deletes.

There is currently no deletion policy for published realtime_outbox rows.

Therefore, notification cleanup:

- reduces notifications rows;
- creates new permanent outbox rows;
- can produce a large realtime delivery burst after a backlog;
- does not by itself bound total database growth.

This does not make notification cleanup wrong. It exposes a separate missing realtime-outbox retention policy that should be audited independently.

Possible future simplification is one coalesced notification-changed or cleared hint per user/company rather than one outbox event per expired row. That is a business and realtime-contract change and must be designed and tested separately.

### What breaks if cleanup is removed

If 30-day unread expiration is intended:

- ignored unread notifications remain forever;
- unread counts and feeds retain very old work;
- notification indexes and table storage grow;
- old inaccessible targets require visibility filtering indefinitely.

If the product does not intend automatic unread expiration, the current job is deleting product-visible rows without a clearly stated numbered law.

The policy must be explicit.

### Why hourly is unnecessary

A 30-day retention boundary does not need one-hour precision for an idle internal product.

Daily execution limits maximum extra retention to approximately one day while reducing 24 empty checks per API task to one bounded maintenance run.

### Recommended target

After product approval of the retention rule:

1. Add a numbered Updates law stating the exact unread cutoff.
2. Add a separate explicit decision for Seen/read history retention.
3. Move the job into the shared scheduled maintenance command.
4. Run daily.
5. Use bounded batches and a total run cap.
6. Coalesce realtime invalidation if the frontend can safely perform canonical reconciliation.
7. Add published outbox retention as a separately designed task rather than hiding it inside notification cleanup.
8. Emit metrics for rows deleted, users affected, outbox rows created, run duration, and remaining backlog.

### Required verification

- Old unread is deleted.
- Fresh unread is retained.
- Old read/Seen is preserved under the current rule.
- Product-approved read-history retention is enforced after any later change.
- Deletion and its realtime hint remain atomic.
- Batches continue safely.
- A retry is idempotent.
- A large backlog does not overload the outbox or WebSocket queue.
- The scheduled runner exits and releases its database connection.

### Existing tests and gaps

backend/internal/store/notifications_lifecycle_test.go proves that an old read row survives.

It does not prove:

- old unread deletion;
- fresh unread retention;
- the PostgreSQL delete/outbox transaction;
- batching;
- scheduler ownership;
- multi-task behavior;
- large-backlog realtime behavior.

### Relationship to the UI heartbeat

None.

The cleanup can send ordinary notification.deleted events. Those events do not confirm WebSocket health.

## Cross-Cutting Findings

### 1. Task count multiplies timers

The four API timers have no leader election or single-owner lease. Every API task starts its own copy.

The realtime timer also runs in every email worker.

Adding ECS capacity therefore adds database maintenance activity even when request volume is unchanged.

### 2. The API and worker roles are not cleanly separated

The email worker:

- starts the full realtime subscriber/recovery spine despite having no browser sockets;
- can signal attachment cleanup despite not running its cleanup consumer.

Those are opposite ownership errors: one unnecessary consumer exists, while one necessary consumer is missing.

### 3. Empty-pass metrics are missing

The processes generally log failures or completed work but do not expose a complete common set of metrics:

- trigger reason;
- pass count;
- empty pass count;
- database statements;
- rows examined;
- rows changed;
- duration;
- retry count;
- oldest pending age;
- remaining backlog.

Without those metrics, costs and failures must be inferred from database telemetry.

### 4. Current healthz is correctly database-free

The backend health endpoint returns deployment/configuration health without querying PostgreSQL.

That is desirable for auto-pause. An ALB health check should not wake Aurora.

### 5. Human database tools independently block pause

An open DBeaver or other user session prevents Aurora auto-pause even after application timers are fixed.

Idle verification must close those sessions.

### 6. RDS Proxy is not an auto-pause fix

AWS documents that RDS Proxy maintains database connections and prevents Aurora Serverless v2 auto-pause.

### 7. PostgreSQL pg_cron is not a suitable wake mechanism

AWS documents that Aurora does not resume a paused instance to run engine-scheduled jobs. Jobs scheduled while paused can be skipped.

Use an external scheduler when a paused database must be woken deliberately.

### 8. Realtime outbox retention is a separate unresolved task

Published realtime_outbox rows currently have no deletion policy.

That table is operational delivery history, not the permanent business source of truth. A separate audit must define:

- minimum replay window;
- how every API cursor remains safe during deletion;
- how long-disconnected clients recover canonically;
- batch deletion and indexes;
- alarms and rollback;
- whether the table should be partitioned.

This audit does not add a sixth background process or authorize an outbox cleanup.

## Simplest Target Architecture

~~~text
Always-running API
  HTTP commands and reads
  database-free health endpoint
  database-free WebSocket heartbeat
  realtime outbox publisher
  Valkey subscriber and local WebSocket fanout
  event-driven attachment cleanup
  no unconditional database timer

Always-running email worker
  SQS long polling
  email provider work
  realtime outbox publisher only
  event-driven attachment cleanup when worker work creates pending deletion
  no Valkey subscriber with an empty WebSocket registry
  no unconditional database timer

Scheduled maintenance task
  starts at an explicit low frequency
  runs attachment-deletion safety reconciliation
  runs expired-upload cleanup
  runs notification retention
  drains bounded batches
  records metrics
  closes PostgreSQL and exits

Removed
  workspace-derived projection timer
  workspace-derived async hooks
  unused deferred event and task model
  checkpoint table after separately approved data preflight and migration
~~~

This design uses one visible maintenance mechanism instead of several unrelated timers hidden inside every API task.

## Recommended Future Work Order

No step below is authorized by this document.

### Phase 1: Read-only inventory

1. Inventory every current project and Logic Gate creation path against Company Explorer E27 and E71.
2. Inventory Logic Gates missing a Company Explorer placement in DEV and PROD.
3. Inventory pending workspace-derived events and checkpoints, distinguishing explicit folder IDs from ignored system-folder-key-only requests.
4. Inventory pending attachment deletion counts and oldest age.
5. Inventory unpublished realtime outbox count and oldest age.
6. Inventory expired/failed upload jobs, current states, and storage strategy.
7. Inventory unread notifications older than 30 days and read-history age distribution.
8. Inventory published realtime_outbox row count and age distribution.
9. Record all application and human database sessions by safe application identity where possible.

### Phase 2: Remove the dead workspace subsystem

1. Repair synchronous Company Explorer placement in the GVIC/Matrix and communications-email Logic Gate creation paths.
2. Verify E27 and E71 on every project and Logic Gate creation path.
3. Repair any historical orphan placement approved by a separate data plan.
4. Confirm no pending or external derived requests remain.
5. Remove the timer and async hooks.
6. Remove unused code and synthetic-only tests.
7. Update Company Explorer and realtime laws.
8. Separately migrate and remove the checkpoint table.

This phase includes backend and database/schema changes and would require explicit approval.

### Phase 3: Make attachment cleanup work-driven

1. Map every final-owner deletion producer.
2. Start a consumer in every producing runtime role.
3. Add post-commit wakes.
4. Add bounded failure retry.
5. Add startup recovery.
6. Add daily single-owner reconciliation.
7. Prove zero idle repository calls.
8. Remove the one-minute ticker only after all gates pass.

### Phase 4: Move low-frequency maintenance out of the API

1. Fix the expired-upload completion race with atomic cleanup ownership and a final state recheck.
2. Create one run-once maintenance entry point using the existing backend image and services.
3. Run attachment safety reconciliation.
4. Run expired-upload cleanup.
5. Run approved notification retention.
6. Process bounded batches with an explicit total cap.
7. Expose metrics and alarms.
8. Schedule it externally.
9. Remove the 15-minute and hourly API timers.

### Phase 5: Correct pool and cold-resume behavior

1. Allow DB_MAX_IDLE_CONNS=0.
2. Test zero idle connections in DEV.
3. If zero creates unacceptable connection churn, use a small count and idle duration safely below the Aurora timeout.
4. Raise connection timeout to at least 30 seconds for a database expected to sleep longer than 24 hours.
5. Add bounded startup and request-side connection retry.
6. Ensure a resumed database starts at low capacity without request storms.
7. Keep healthz database-free.

### Phase 6: Simplify realtime role ownership

1. Classify every outbox producer as atomic or standalone.
2. Move every required durable realtime event into its business transaction, or explicitly approve any remaining loss window.
3. Prove every committed outbox insert receives a post-commit wake.
4. Make the email worker publisher-only.
5. Add first-active-subscription recovery.
6. Add oldest-unpublished metrics and alarms.
7. Run the full failure matrix, including a crash before the message.opened standalone enqueue and a lost wake after an atomic enqueue.
8. Decide whether the ten-minute pass can become a single owner, a slower safety audit, or be removed.
9. Update RW67 and docs/tests/valkey.md only with the implemented guarantee.

### Phase 7: DEV rollout and observation

1. Deploy only to DEV.
2. Close DBeaver and other user database sessions.
3. Wait for DatabaseConnections to reach zero.
4. Verify ServerlessDatabaseCapacity reaches zero.
5. Verify RDS pause events.
6. Keep an existing browser WebSocket open and verify its heartbeat remains green.
7. Trigger the first real database request and verify automatic resume succeeds.
8. Run attachment delete, abandoned upload, notification expiry, realtime failure, and worker-email acceptance tests.
9. Verify the scheduled task wakes the database, exits, releases connections, and allows another pause.
10. Observe for multiple idle/resume cycles before proposing PROD.

PROD changes require a separate explicit approval.

## Required Acceptance Matrix for Any Implementation

| Area | Required proof |
| --- | --- |
| Idle database | Zero application and human user connections for longer than the configured pause threshold |
| Aurora | ServerlessDatabaseCapacity reaches zero and later resumes |
| UI heartbeat | Existing WebSocket stays healthy without PostgreSQL traffic |
| Cold start | First database request succeeds with bounded delay and retry |
| Workspace | Every current project and Logic Gate creation performs required synchronous placement; historical orphans are inventoried; no pending derived request is lost |
| Attachment deletion | Final-owner work from API and worker deletes S3 before PostgreSQL and retries failure |
| Shared attachment object | A key retained by another attachment/upload is never deleted |
| Upload cleanup | Single PUT and multipart abandonment both clean safely; completion and cleanup cannot own the same job concurrently |
| Notification cleanup | Exact approved retention, atomic hints, bounded backlog |
| Realtime | Atomic business/outbox boundary where required; crash before enqueue, commit-before-wake crash, broker failure, mark failure, gap, overflow, reconnect, and multi-task delivery |
| Idle realtime | No unconditional database query after all event-driven work drains |
| Scheduled maintenance | Bounded, observable, closes connections, exits |
| Scaling | Adding an API task does not multiply low-frequency maintenance ownership |

## Current Source Map

### Startup and database pool

- backend/internal/http/server.go
- backend/cmd/miraeopus-api/main.go

### Workspace projection recovery

- backend/internal/http/workspace_derived_projection.go
- backend/internal/http/workspace_entity_batch_handlers.go
- backend/internal/store/mutation_context.go
- backend/internal/store/postgres_workspace_derived_projection.go
- backend/internal/store/postgres_workspace_entity_batch.go
- backend/internal/http/gvic_matrix_handlers.go
- backend/internal/store/postgres_gvic_matrix_commands.go
- backend/internal/http/communications_triage_handlers.go
- backend/internal/store/postgres_communications_triage.go
- backend/internal/store/communications_email_conversion.go
- backend/internal/store/repository.go
- backend/internal/store/workspace_read_versions.go
- backend/db/schema.sql
- docs/tests/company explorer.md
- docs/important tasks/Old Stuff/postput-context-notes.md
- docs/important tasks/Old Stuff/live-feed-audit.md

### Attachment deletion cleanup

- backend/internal/http/attachment_deletion_cleanup.go
- backend/internal/attachmentcleanup/service.go
- backend/internal/attachmentcleanup/postgres.go
- backend/internal/store/postgres_attachment_cleanup.go
- backend/internal/store/attachment_relationship_cleanup.go
- docs/tests/attachments.md
- docs/tests/relationships.md

### Realtime recovery

- backend/internal/http/realtime_spine.go
- backend/internal/http/realtime_ws.go
- backend/internal/http/communications_stream_handlers.go
- backend/internal/store/postgres_communications.go
- backend/internal/store/postgres_realtime_outbox.go
- backend/internal/realtime
- docs/tests/valkey.md
- docs/tests/REST API & WebSocket.md

### Expired upload cleanup

- backend/internal/http/attachment_direct_upload_config.go
- backend/internal/http/attachment_direct_upload_handlers.go
- backend/internal/store/postgres_attachment_uploads.go
- infra/modules/mangorts-platform/attachments_s3.tf
- infra/aws-prod/attachments_s3.tf
- docs/tests/attachments.md

### Notification cleanup

- backend/internal/http/notification_cleanup.go
- backend/internal/store/postgres_notifications.go
- backend/internal/store/notifications_lifecycle_test.go
- backend/internal/store/repository.go
- docs/tests/updates.md
- docs/tests.md
- docs/v4-architecture-doc.md

## Final Audit Conclusion

The current backend does not have five equally necessary always-on processes.

It has:

- one apparently dead projection system that should be removed after its historical data is checked and the separate current Logic Gate placement gaps are fixed;
- one mandatory attachment deletion guarantee attached to an unnecessarily frequent and incomplete wake topology;
- one mandatory realtime system whose email-worker and periodic safety ownership can be simplified only after its specific webhook atomicity exception and recovery behavior have a strict correctness proof;
- one necessary abandoned-upload cleanup running much more often than its default 24-hour policy requires and containing a completion-versus-cleanup race that cadence changes alone cannot fix;
- one notification-retention process whose hourly cadence is excessive and whose exact product policy needs to be stated explicitly.

The immediate source of Aurora never pausing is not one expensive query. It is the absence of any five-minute connection-free period. The 30-second workspace scan and one-minute attachment scan guarantee that condition. The shared five-minute idle pool and five-second cold-connect timeout then prevent the backend from taking advantage of pause even after the timers are changed.

The correct direction is to delete dead work, keep required safety guarantees, trigger normal work from real events, consolidate rare reconciliation into one run-once maintenance task, release idle database connections, and test the cold-resume path before touching PROD.
