Last updated: 2026-07-16

# MangoRTS Current Data And Realtime Architecture

Status: current architecture contract. This document supersedes the former process-local four-surface contract and the deleted broad workspace/projection fan-out designs. The complete implementation record and rationale live in `docs/important tasks/realtimechanges.md`.

## Core Data Rule

Authenticated HTTP commands are the only product write path. A successful collaborative editor command means the backend has authorized the exact company/resource/document and atomically committed the accepted operation, next document revision, canonical collaboration state, and transactional realtime outbox event. WebSocket frames are never an uncommitted write path or durable source of truth.

Canonical HTTP reads remain recovery truth. Ordinary feature wake-ups reconcile their existing canonical reads. Collaborative editors use exact full-HTML snapshots and ETags for open, refresh, reconnect, revision gaps, divergence, and explicit canonical replacement; normal typing uses bounded edits to the serialized rich HTML rather than full-body writes or fan-out.

## One Shared Realtime Spine

Every approved live event follows one architecture:

```text
committed mutation
  -> realtime_outbox
  -> PostgreSQL published-event backplane
  -> every backend instance
  -> existing local exact-scope registry
  -> current authorized browser connections
```

The production dispatcher claims bounded outbox batches with leases, stable event IDs, retry metadata, and restart recovery. Each backend instance consumes published rows in global sequence and delivers only through its local registry. An immediate local wake/flush reduces latency; correctness does not depend on the HTTP mutation and WebSocket landing on the same instance or on target-group stickiness.

The frontend reuses one physical WebSocket per API/company boundary and refcounts logical scopes across duplicate mounted consumers. It owns the sole ticket, heartbeat, reconnect, accepted-scope, and recovery state machine. Features may own payload interpretation and canonical recovery, but may not create another socket, broker, registry, heartbeat manager, or reconnect loop.

## Approved Exact Scopes

| Scope | Mounted consumer | Live payload | Canonical recovery |
| --- | --- | --- | --- |
| `notifications:user:{user_id}` | App-lifetime notification bridge | Created/deleted/cleared notification hints | Coalesced notification summary; Updates feed only for real mounted feed changes |
| `chat:node:{node_id}` | Mounted Node chat | Committed chat create/delete identifiers | Coalesced exact Node projection/chat read |
| `board:{board_id}` | Mounted Logic Gate Kanban | Compact `kanban.changed` hint | Coalesced exact board/work read |
| `mailbox:personal:account:{user_id}:{account}` | Exact selected personal mailbox | Compact provider message/folder hint | Exact mailbox folder/list/detail reads |
| `mailbox:shared:{shared_inbox_id}` | Exact selected mail-bearing shared inbox | Compact provider message/folder hint | Exact shared-mailbox reads |
| `editor:{node|logic_gate|project}:{resource_id}:{document_id}` | Exact mounted collaborative body | Committed bounded HTML-text patch, deletion, or compact snapshot-required signal | Exact full-HTML snapshot/ETag plus durable pending-operation recovery |

Broad company/workspace/user-directory/editor wildcard streams remain forbidden. Company Explorer, graphs/maps, GVIC/My Work, Project Management, permissions, generic projections, broad communications, and title caches do not receive generalized backend replication. Same-browser committed-title convergence remains the targeted local command-result/cache mechanism documented in the owner contracts.

## Collaborative Documents

Every independently editable Node, Logic Gate, or Project rich-text body is a separate document. Its identity includes company, resource type, resource ID, and document ID. Node text boxes, Logic Gate root/body and independent text boxes, and Project text boxes never share revision streams or pending queues merely because they appear in one surface.

Mango has one editor document representation: sanitized rich HTML. The database stores that HTML, APIs and snapshots carry it, and editor DOMs deserialize and serialize it directly. Normal collaboration operations are small UTF-8-indexed HTML text patches (`start_utf8`, `delete_utf8`, `insert`), never a second rich-text document language. The server orders accepted patches by document revision, transforms stale disjoint ranges over intervening patches, and returns those concurrent patches in the acknowledgement so the origin can rebase unacknowledged local work. Stable operation IDs provide retry/deduplication after a lost acknowledgement. The product explicitly accepts the rare collision risk when collaborators edit the same exact HTML location inside the delivery window; a full-HTML recovery resolves detected gaps without a user merge screen.

Local DOM rendering is immediate. Compatible rapid changes micro-batch for 160 ms. Large inserts split into ordered bounded HTML patches below the request guard. The backend commits one transaction per accepted micro-batch, not per keystroke. Own acknowledgements never replace the live DOM, and remote committed patches apply once and are marked as remote so they cannot echo into another save. `Saved` means backend acknowledgement, never local rendering or socket delivery.

The collaboration document row stores current canonical HTML, revision, and ETag atomically with each operation and outbox event. Explicit saved-version restore is a canonical full-HTML replacement; its outbox event contains no body and tells subscribers to fetch the full snapshot. A client whose operation predates that replacement recovers current HTML and reconciles its still-durable operation instead of anchoring it to obsolete markup.

Projection tables remain compatible read models and are materialized atomically from the same canonical HTML. They are not a separate editor format. Title and attachment metadata use a body-free metadata command that reads the canonical collaboration body server-side and cannot overwrite it.

## Durable Pending Operations And Recovery

Before an unacknowledged mutation can be lost, the browser stores its HTML patch under authenticated user, company, exact resource/document, per-tab browser client, and stable operation ID. IndexedDB is the authoritative queue; quota and storage failures are surfaced and block the unsafe send rather than falling back to capacity-limited `localStorage`. A stable per-tab identity lives in `window.name`, surviving refresh/reconnect without causing separate tabs to share a queue. Legacy full-body and structured-document keys/databases are deleted once and never read.

Open/reconnect recovery establishes or restores the exact subscription, buffers committed events, fetches/validates the full snapshot, accepts revision R, discards duplicates at or below R, orders events above R, transforms and reapplies/resubmits durable pending operations with their original IDs, waits for acknowledgement/deduplication, and only then reports the document healthy. Events or deletions arriving during an active recovery request another canonical recovery pass so the load-to-subscribe race cannot be lost.

A tombstone terminates the mounted document and removes its exact subscription. Recoverable unacknowledged local operations are not silently deleted. Ordinary unrelated Mango mutations are not made offline-capable by this editor queue.

## Application Heartbeat And Mutation Gate

Protocol Ping/Pong remains for transport liveness. Product health uses application heartbeat challenge/response/confirmation on Mango's authenticated backend path at roughly 25 seconds with jitter grace.

The top-left Key Views brand row, immediately before the trash control, shows accessible color and text:

- Green / Connected pulses only after confirmed heartbeat, authorization, all exact subscription acceptances, mounted-document snapshot/buffer recovery, and pending acknowledgements.
- Orange / Reconnecting reconnects immediately; collaborative typing remains local and durable, while risky mutations are gated.
- Blinking red / Attempting to reconnect mounts one global body-level blocking portal above every feature overlay while background retry continues.
- Solid red / Disconnected - refresh your browser requests manual refresh; pending editor operations survive it.

The shared API request boundary enforces the mutation gate. Only the exact collaborative operation POST remains allowed while orange because the operation was durably queued; metadata, deletes, and unrelated side effects remain gated.

## Authorization And Delivery Bounds

Subscription admission validates authenticated user, company, exact resource existence, and current required permission. Editor admission/publication requires current Edit access. Publication reauthorizes only distinct users with local connections on that exact scope; revocation therefore stops later delivery. Administrator overrides never bypass wrong-company or missing-resource checks.

One editor event's browser work is proportional to active connections on that exact document. Adding unrelated companies, employees, open connections, stored documents, or other scopes does not increase its recipient count. One connection may hold at most 128 exact scopes; duplicate subscriptions are idempotent. Each connection has a bounded FIFO writer and deadline, so a stalled recipient is isolated and removed without delaying healthy subscribers.

## Attachment And Payload Safety

Collaborative rich text preserves durable attachment-backed image references, formatting, lists, mentions, tables, and pasted sanitized structure. Realtime and collaboration validation reject attachment bytes, base64/data URLs, presigned URLs, AWS/provider credentials, secrets, and oversized payloads. Authorized attachment content continues through the existing HTTP/S3 boundary.

Mailbox hints likewise contain only exact scope, trigger, and compact provider identifiers, never message bodies, provider credentials, or attachment bytes.

## Retained Feature Recovery

Notifications, Node chat, mounted Kanban, and exact active mailbox retain their feature-owned canonical reconciliation and coalescing rules. They use the same durable spine and shared socket but do not become editor-style operation streams. Email-collaboration shared drafts retain their separate optimistic HTTP revision contract; this project does not turn every email draft into an editor collaboration document.

## Deleted Architecture

The current system does not contain or permit:

- broad workspace/projection/communications replication or wildcard editor streams;
- the legacy `mango-editor-projection-draft-v2` full-body checkpoint or `mango-editor-projection-tab-v1` tab identity;
- restored-draft/whole-document conflict modals and server/local version-choice actions;
- migrated `Text box` fallback writes through legacy projection POST/DELETE routes;
- feature-owned editor sockets, registries, brokers, heartbeats, or reconnect loops;
- per-keystroke database transactions, normal full-body fan-out, or attachment bytes in realtime; or
- sticky-session dependence for cross-instance delivery.

## Operations And Rollout

Apply `backend/db/migrations/20260715_unified_realtime_collaboration.sql` before deploying the matching backend/frontend. The migration creates the realtime outbox, collaboration document/operation storage, claim/published indexes, and multi-text-box Logic Gate boundary, and updates the canonical schema. Do not apply it to production from an agent session; the human rollout follows `AGENTS.md` and `docs/security/database-agent-access-contract.md`.

Deploy all backend instances on the matching schema, then the coordinated frontend, and require pre-cutover tabs to refresh. Monitor outbox lag/claim/publish failures, commit-to-fan-out latency, no-subscriber outcomes, connection/subscription counts, deadline failures, collaboration gaps/snapshot recovery, reconnect states, and pending recovery without logging editor content or secrets.
