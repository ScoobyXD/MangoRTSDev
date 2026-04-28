# Latency Obsession Architecture

## Goal
Design the MangoOS hot-path architecture for:
- 100000s of UI elements and simultaneous background operations per active workspace
- 100000s of companies
- 1000000s of users and ai agency
- strict latency culture with sub-100ms targets for interactive reads
- ***THIS IS SUPER IMPORTandANT:*** In the future we will have ai agents operate this app without a UI,
    so we need to make sure everything can be done by ai agents headless with just APIs. 
    And of course, it needs to work well with 10000s of ai agents all using the apis all at once.

This document is the source of truth for architecture decisions and execution tracking.

---

## Hot / Warm / Cold Path Definitions

### Hot Path (must be aggressively optimized)
These paths are always latency-sensitive and product-critical:
- **Everything in File Explorer module**
- **Everything in Node Map module**
- **Everything in Details module / node details retrieval**
- **Everything in Editor module that reads or writes active node information**
- **Everything in upcoming Logic Gate Canvas module**

Target:
- p95 interactive read operations under **100ms** inside a region
- p99 bounded and monitored

### Warm Path
Important but not immediate interaction blockers.
Examples:
- secondary side panels
- non-visible prefetches
- background synchronization that does not block interaction

Target:
- p95 100-400ms depending on operation type

### Cold Path
Non-interactive or deferred work.
Examples:
- migrations
- backfills/ETL
- analytics aggregation
- archival jobs

Target:
- optimize for throughput/cost/correctness over immediate latency

---

## Core Architectural Rules

## 1) No N+1 on Hot Paths
N+1 fan-out calls are forbidden on hot paths.

Required pattern:
- use **bulk read APIs** that return all needed graph data in one request (or a bounded small number of requests)
- use joins/materialized views/precomputed read models where needed
- avoid one-request-per-node loading patterns

## 2) Event-driven module synchronization (no polling loops)
Polling loops are forbidden for hot path synchronization.

Required pattern:
- event-driven propagation (UI event bus and/or streaming transport)
- publish updates when key state changes
- subscribers react immediately

## 3) Viewport-first rendering strategy
For large canvases/graphs:
- only render what is visible (windowing/virtualization/culling)
- avoid full re-render of all nodes/edges on minor local updates
- use stable memoization and fine-grained state subscriptions

## 4) Rendering technology policy
For very large graphs:
- DOM is acceptable for lower element counts and editor overlays
- Canvas/WebGL are approved and recommended when density grows

Canvas/WebGL are standard in high-performance enterprise UIs for large data visualization and graph workloads.

## 5) Batch state updates and avoid global rerenders
Meaning:
- coalesce multiple state mutations into one render cycle
- normalize state so only affected components re-render
- avoid root-level state churn that invalidates entire trees
- avoid expensive recomputation in broad dependencies

## 6) Persistence and cache policy
Required:
- CDN for static assets
- edge/regional cache for read-heavy API paths
- Redis/Valkey for hot data and aggregation shortcuts
- ETag/If-None-Match and 304 responses for unchanged payloads

## 7) Data partitioning/indexing strategy
Required:
- partition/shard by `company_id`
- composite indexes with `company_id` leading where appropriate
- tenant-aware data locality to protect cross-tenant performance

### Explicit startup policy on quotas/rate limits
For this startup phase, **do not introduce per-tenant quotas or hard rate limits** in core product paths.
Rationale: artificial throughput caps on active tenants can directly damage growth and adoption.

(Abuse/security controls can still exist outside normal product flow.)

## 8) Concurrency/conflict strategy
For collaborative edits and fast UX:
- optimistic UI is allowed for low-latency interaction
- conflicts must resolve deterministically (e.g. last-write-wins or CRDT-style rules as required by domain)

## 9) Strict latency culture
Required operational behavior:
- every hot endpoint has p50/p95/p99 SLOs
- regressions block merges
- dashboards and alerts are mandatory
- design docs must state expected latency budget before implementation

---

## Canonical Hot-Path Data Shape (Target)

For Node/Explorer/Editor/Logic Gate canvases:
- single bulk payload for active view context
- explicit relationships in payload (no client-side fan-out to infer edges)
- compact shape for first paint
- incremental delta channel for updates

### Hot-path cache hierarchy contract (locked)

To keep hot-path interactions deterministic under high concurrency, MangoOS uses this layered contract:

1. **L1 module state cache (per-frame render state).**
   - Immediate paint data for active component tree.
   - Must avoid full-tree invalidation on targeted updates.

2. **L2 shared workspace cache (normalized client graph/details cache).**
   - Shared by Node Map, Company Explorer, and Editor.
   - One node/details key must resolve to one in-memory canonical value for the page session.

3. **L3 single-flight read-through fetch layer.**
   - Cache miss for a key starts at most one network request.
   - Concurrent readers await the same promise (no duplicate in-flight requests per key).

4. **L4 server projection/read model.**
   - Hot reads are served from typed read models shaped for immediate UI usage.
   - Runtime read handlers must avoid per-request blob reconstruction loops.

5. **L5 canonical write/history store.**
   - Append/update paths keep authoritative history and feed projection updates.
   - Projection freshness is maintained on write and stream reconciliation.

### Semantic vs UI layout policy (Editor + Node Map)

- **Semantic information** (text/value content used by runtime operations) is server-side and projection-backed for hot reads.
- **UI layout geometry** (editor box coordinates, pan/zoom, per-user layout preferences) is local/per-user by default and must not sit on the hot server path.
- Optional shared layout templates are allowed as an explicit non-hot-path feature.

### Current -> target behavior clarification (Editor latency fix)

Current issue:
- Node selection can trigger duplicate `/v1/nodes/:id` details fetches across linked modules.
- Editor previously reconstructed text boxes from `node_information` JSON blobs on each selection.

Target behavior:
- One cache-miss fetch at most per node key (single-flight).
- Editor semantic information reads come from typed projection rows.
- Editor geometry remains local/per-user and is not sent on hot semantic save/read paths.
- Cross-module details reads are served from shared cache entries whenever possible.

---

## Implementation Checklist (LLM/Engineer Tracking)

Mark each item when complete and keep this list current.
Status legend:
- ✅ complete in repo
- 🟡 partial / implemented but not yet at target architecture intent
- ⛔ not started / blocked

Last reviewed: 2026-04-22

### Hot Path Contracts
- ⛔ Defined SLOs for every hot path endpoint (p50/p95/p99)
- ⛔ Latency budgets written per endpoint and per UI flow
- ⛔ Hot/warm/cold classification enforced in PR reviews

Blockers:
- No agreed latency SLO document per endpoint/UI flow yet.
- No CI/PR gate wiring that enforces latency class policy.

### N+1 Elimination
- ✅ Node Map relationship loading moved away from per-node detail fan-out to bulk relationship loading
- ⛔ Remaining N+1 patterns removed from all hot modules
- ⛔ Backend queries verified by EXPLAIN plans for hot endpoints

Blockers:
- No systematic endpoint-by-endpoint query review completed.
- No committed EXPLAIN artifacts/checks for hot routes.

### Workspace Data Plane
- ✅ Single source-of-truth workspace snapshot endpoint added (`/v1/workspace/snapshot`)
- ✅ Initial bulk/snapshot API wired into hot modules (Node Map + Company Explorer)
- ✅ Shared normalized client workspace store introduced across modules

### Event-driven Sync
- ✅ Removed polling loop from Editor link synchronization
- ✅ Removed polling loop from Editor selected-node synchronization
- ✅ Removed polling loop from Explorer -> Canvas context synchronization
- 🟡 WebSocket/SSE transport introduced for cross-client realtime sync (SSE via `/v1/workspace/stream`; only selected event types currently delta-applied client-side)

Blockers:
- Delta coverage is not yet complete for all mutation shapes.
- No versioned event contract yet for long-term compatibility.

### Workspace Snapshot Consistency Model (Current)

These are the currently implemented mechanisms that keep the client workspace cache aligned with database truth:

1. **DB-backed snapshot endpoint remains authoritative.**
   - `/v1/workspace/snapshot` is built from repository reads (`ListNodes`, `ListNodeRelationships`) on each request.
   - This endpoint remains the read authority for full graph state.

2. **Initial hydration + subscription model.**
   - Node Map mounts, hydrates from snapshot/store, then stays synced via workspace subscriptions/stream.

3. **SSE delta application for core graph events.**
   - Client deltas are currently applied for:
     - `node_created`
     - `node_deleted`
     - `relationship_created`
     - `relationship_deleted`
   - Subscribers are notified immediately after successful delta apply.

4. **Fallback full refresh on stream uncertainty.**
   - If stream payload is empty, malformed, or cannot be delta-applied, client falls back to `refreshWorkspaceSnapshot(...)`.

5. **Conditional GET / ETag guard.**
   - Snapshot refresh sends `If-None-Match`.
   - Unchanged payloads can return `304 Not Modified`.
   - Client also skips subscriber fan-out when returned ETag matches cached ETag.

6. **Targeted reconciliation on known mismatch cases.**
   - Example: relationship-delete flow performs explicit snapshot refresh on 404-style mismatch to resynchronize state.

7. **Optimistic local updates are a fast path, not final authority.**
   - `upsertWorkspaceNode` / `removeWorkspaceNode` are local convergence helpers for latency.
   - SSE + snapshot refresh remain the source-of-truth convergence path.

### Remaining Risk (Important)

- SSE delta coverage is still partial (“only selected event types currently delta-applied client-side”).
- Therefore bounded drift risk remains until event coverage and contract versioning are completed.
- Reducing chatty fallback GETs increases dependence on stream contract quality and reconciliation reliability.

### De-risking Recommendations (Next)

1. **Versioned stream envelope + monotonic sequence per company**
   - detect dropped/out-of-order events and trigger safe reconciliation.

2. **Periodic lightweight reconciliation checkpoints**
   - e.g., scheduled snapshot check every N minutes and/or on tab visibility regain.

3. **Snapshot-hash compare telemetry**
   - detect divergence early and quantify drift frequency.

4. **Explicit SLOs for stream-lag and reconciliation-lag**
   - make lag visible and enforceable with dashboards + alerts.

### Rendering Scalability
- ✅ Viewport culling/windowing implemented for Node Map
- ✅ Virtualization implemented for Explorer tree and heavy lists
- 🟡 Canvas/WebGL decision implemented for high-density graph rendering (Canvas 2D edge path renderer added; full WebGL pipeline not implemented)
- ⛔ Fine-grained subscriptions to avoid global rerenders

Blockers:
- Full WebGL migration requires renderer architecture choice (e.g. Pixi/custom regl) and interaction model redesign.
- Current node cards are still React DOM; only relationship layer moved to canvas.

### Caching + Delivery
- ⛔ CDN strategy implemented and validated
- ⛔ Regional/edge read cache implemented for hot APIs
- ⛔ Redis/Valkey hot read model implemented
- ✅ ETag + 304 implemented on hot read endpoints

### Data Model / Database
- ⛔ `company_id`-first indexing audited and fixed
- ⛔ Sharding/partitioning strategy by `company_id` implemented
- 🟡 Read model for graph snapshot/delta designed and implemented (initial snapshot endpoint + SSE events exist; dedicated DB read model/materialized structure not yet built)
- ⛔ Any required joins/materialized views added for hot reads

Blockers:
- No production-scale workload profile (cardinality, fan-out, read/write ratio) captured yet.
- Partitioning/sharding strategy depends on expected tenant growth and operational constraints.
- No read-optimized snapshot table/materialized view migration plan drafted yet.

### Observability + Quality Gates
- ⛔ Endpoint-level latency dashboards (p50/p95/p99)
- ⛔ Error-rate and saturation dashboards for hot path services
- ⛔ Performance regression tests in CI for hot path workflows
- ⛔ Merge gate that fails on defined latency regressions

Blockers:
- Metrics instrumentation and dashboard ownership not finalized.
- CI currently lacks perf-test stage and SLO threshold checks.

---

## Notes for Future Schema/ETL/Stored Procedure Work
If hot-path profiling shows DB bottlenecks, acceptable actions include:
- new read-optimized tables
- precomputed graph snapshot tables
- materialized views
- ETL/backfill jobs
- stored procedures for high-frequency graph reads

Any such change must include:
- explicit SLO impact goal
- rollback plan
- migration safety notes

---

## History

> ⚠️ **DO NOT EDIT THIS HISTORY SECTION UNLESS A USER EXPLICITLY ASKS YOU TO.**
> This section is append-only and should only be updated when a user directly requests a history entry.

### 2026-04-26 — Frontend module-link latency hardening + full graph migration

**Problem before this change (explicit):**
- Module-link synchronization mixed semantic context updates with high-frequency UI geometry churn.
- Node Map emitted cross-module map-state events during pan/zoom/drag state persistence, causing unnecessary linked-module refresh work.
- App layout rewrote compatibility link mappings on broad frame changes, so non-link edits (like drag/resize) could trigger avoidable link propagation.
- Explorer and Editor consumed a compatibility bridge path that increased localStorage/event fan-out and widened effect dependencies.

**Implemented solution (explicit):**
- Promoted `frame-module-links-v1` to the sole module-link source-of-truth for runtime linking.
- Added `frame-module-registry-v1` (frame id -> kind) to support graph traversal by consumers without legacy map-link key writes.
- Introduced dedicated semantic event channels:
  - `EVENT_FRAME_LINK_GRAPH_UPDATED` for graph changes only.
  - `EVENT_NODE_MAP_SELECTION_UPDATED` for selection context changes only.
- Removed app-layer runtime writes of legacy editor/explorer bridge mappings.
- Refactored Editor to resolve linked Node Map via graph traversal (`frame-module-links-v1` + `frame-module-registry-v1`) and react to semantic events.
- Refactored Explorer target fan-out to direct graph neighbors and graph-change events.
- Separated hot interaction persistence from semantic sync:
  - Node Map keeps local map-state persistence debounced.
  - Cross-module notifications now fire only on selected-node semantic changes.

**Latency-architecture alignment outcome:**
- Better compliance with “event-driven sync” while reducing broad fan-out.
- Better compliance with “batch updates / avoid global rerenders” by isolating high-frequency interaction state from cross-module context propagation.
