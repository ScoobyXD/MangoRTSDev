# Latency Obsession Architecture

## Goal
Design the MangoOS hot-path architecture for:
- 1000s of UI elements per active workspace
- 100000s of companies
- 1000000s of users
- strict latency culture with sub-100ms targets for interactive reads

This document is the source of truth for architecture decisions and execution tracking.

---

## Hot / Warm / Cold Path Definitions

### Hot Path (must be aggressively optimized)
These paths are always latency-sensitive and product-critical:
- **Everything in File Explorer module**
- **Everything in Node Canvas module**
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

---

## Implementation Checklist (LLM/Engineer Tracking)

Mark each item when complete and keep this list current.

### Hot Path Contracts
- [ ] Defined SLOs for every hot path endpoint (p50/p95/p99)
- [ ] Latency budgets written per endpoint and per UI flow
- [ ] Hot/warm/cold classification enforced in PR reviews

### N+1 Elimination
- [x] Node Canvas relationship loading moved away from per-node detail fan-out to bulk relationship loading
- [ ] Remaining N+1 patterns removed from all hot modules
- [ ] Backend queries verified by EXPLAIN plans for hot endpoints

### Workspace Data Plane
- [x] Single source-of-truth workspace snapshot endpoint added (`/v1/workspace/snapshot`)
- [x] Initial bulk/snapshot API wired into hot modules (Node Canvas + Company Explorer)
- [x] Shared normalized client workspace store introduced across modules

### Event-driven Sync
- [x] Removed polling loop from Editor link synchronization
- [x] Removed polling loop from Editor selected-node synchronization
- [x] Removed polling loop from Explorer -> Canvas context synchronization
- [x] WebSocket/SSE transport introduced for cross-client realtime sync (SSE implemented via `/v1/workspace/stream`)

### Rendering Scalability
- [x] Viewport culling/windowing implemented for Node Canvas
- [ ] Virtualization implemented for Explorer tree and heavy lists
- [ ] Canvas/WebGL decision implemented for high-density graph rendering
- [ ] Fine-grained subscriptions to avoid global rerenders

### Caching + Delivery
- [ ] CDN strategy implemented and validated
- [ ] Regional/edge read cache implemented for hot APIs
- [ ] Redis/Valkey hot read model implemented
- [ ] ETag + 304 implemented on hot read endpoints

### Data Model / Database
- [ ] `company_id`-first indexing audited and fixed
- [ ] Sharding/partitioning strategy by `company_id` implemented
- [x] Read model for graph snapshot/delta designed and implemented (initial snapshot endpoint + SSE delta events)
- [ ] Any required joins/materialized views added for hot reads

### Observability + Quality Gates
- [ ] Endpoint-level latency dashboards (p50/p95/p99)
- [ ] Error-rate and saturation dashboards for hot path services
- [ ] Performance regression tests in CI for hot path workflows
- [ ] Merge gate that fails on defined latency regressions

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
