# Historical: Database Plan Pragmatic Review

This document is retained as historical analysis. For current MangoRTS dev database setup, use `docs/mangorts-database.md`.

# Database Plan Pragmatic Review (Latency-Obsession Aligned)

## Why this review exists
This review evaluates two external database proposals against MangoOS's own latency architecture priorities:

- sub-100ms hot-path reads
- `company_id`-first partitioning/indexing
- no hot-path N+1
- event-driven sync + incremental deltas
- hard observability gates before and after rollouts

Primary reference: `docs/latency-obsession-architecture.md`.

---

## Current state reality check (from repo)

What is already true in the current codebase:

1. The API has a workspace snapshot endpoint and stream endpoint already in place (`/v1/workspace/snapshot`, `/v1/workspace/stream`).
2. Snapshot reads are currently composed from normalized OLTP queries (`ListNodes`, `ListNodeRelationships`) rather than dedicated DB-side read models.
3. ETag/304 behavior exists in HTTP helpers.
4. Base schema has `company_id`-scoped primary keys and FKs, but only limited secondary indexes on hot tables.

Implication: your system already started the right direction on API shape and realtime transport, but DB internals are not yet optimized for very large-scale hot reads.

---

## Proposal A (newer): strengths and weaknesses

### What Proposal A gets right

1. **Starts with workload profiling + SLO baseline.**
   - This is exactly aligned with strict latency culture and “regressions block merges.”
   - Avoids index/partition cargo-culting.

2. **Treats index audit as quick wins first.**
   - Pragmatic, low-risk, and reversible.
   - Keeps `company_id` leading, matching your tenancy and locality policy.

3. **Introduces read-optimized snapshot projection with incremental refresh.**
   - Strong fit for hot path first-paint and bounded query count.
   - Explicit rollback/rebuild path is operationally mature.

4. **Defers partitioning until profiling proves need.**
   - Good complexity control.
   - Prevents expensive migrations too early.

5. **Calls out concurrency/correctness policy + watermarks.**
   - Important for out-of-order events and eventually consistent projections.

6. **Adds operational gates (CI plan regressions, SLO alerts).**
   - This is exactly what a latency-obsessed team should institutionalize.

### What Proposal A is weak on

1. **Too abstract on exact schema/query contract.**
   - Doesn’t spell precise table shapes/columns for projections.
   - Leaves implementation ambiguity for engineering teams.

2. **No explicit “what to index first” list.**
   - Could slow immediate wins while profiling setup is being built.

3. **No explicit read-contract split for editor “latest” vs “history.”**
   - Misses an opportunity to cap payload size and stabilize p95.

---

## Proposal B (earlier): strengths and weaknesses

### What Proposal B gets right

1. **Clear principle: write-normalized, read-denormalized.**
   - Very appropriate for your hot-path goals.

2. **Concrete read-model table suggestions.**
   - `workspace_graph_snapshot`, `workspace_edge_snapshot`, `node_info_latest` are understandable and implementation-ready.

3. **Specific index additions on current schema.**
   - Great immediate actionability for relationship fanout and details path.

4. **Mentions CDC/projector approach for incremental projection updates.**
   - Good for keeping request path lean.

5. **Includes versioning/ETag friendliness.**
   - Fits your current API behavior and architecture checklist.

6. **Explicit query contracts (snapshot vs editor vs explorer).**
   - This is useful to prevent accidental endpoint bloat.

### What Proposal B is weak on

1. **Insufficient “measure first” discipline in ordering.**
   - It has good ideas but reads like implementation-forward before mandatory production-like profiling.

2. **Partitioning recommendation may be too early.**
   - Hash partitioning can improve scale, but it increases DDL, migration, and operational burden.
   - Without verified pressure points, this could be premature complexity.

3. **Potential overlap/redundancy across proposed tables.**
   - `workspace_graph_snapshot` + `node_info_latest` can drift unless update semantics are rigorously defined.

4. **Stored procedure guidance is plausible but not tightly scoped.**
   - Risk of over-centralizing business logic in SQL before plan stability is proven.

---

## Head-to-head judgment (pragmatic)

### If your priority is **lowest implementation risk with highest confidence**:
**Proposal A sequencing is better.**
- It enforces measurement and operational gates before irreversible architecture moves.

### If your priority is **fastest path to concrete implementation tasks**:
**Proposal B artifacts are better.**
- It gives table/index ideas engineers can execute quickly.

### Best practical approach for MangoOS (recommended)
Not a blend-for-the-sake-of-blend; a **disciplined sequence**:

1. **Adopt Proposal A’s order of operations** (profile -> quick wins -> projection -> partition only if proven).
2. **Use Proposal B’s concrete schema/index suggestions as candidates**, but only after the baseline confirms each one addresses measured hotspots.

This is the most pragmatic path because it keeps the strategic rigor of A while leveraging B’s concreteness where it is justified.

---

## Specific pros/cons list against your architecture

### Good (strongly aligned)

- Bulk read model direction for hot snapshot/graph paths.
- `company_id`-leading index and partition focus.
- Incremental/event-driven projection updates.
- Version/watermark concepts for consistency and caching.
- CI + dashboard-based latency regression gates.

### Bad / risky (needs caution)

- Partition-first migration before evidence.
- Multiple overlapping projections without strict ownership and determinism.
- Lack of clear lag semantics (what clients should trust when projection trails OLTP).
- Introducing stored procedures broadly before query contract stabilization.

---

## Decision-ready recommendation

### Approve now

1. Build mandatory profiling pack for hot endpoints:
   - `workspace/snapshot`
   - node details
   - explorer list
   - relationship fanout
2. Run index audit with EXPLAIN ANALYZE + BUFFERS and ship only proven winners.
3. Define one minimal projection for first-paint workspace reads with deterministic update ordering + watermark.
4. Add latency/SLO regression checks and alerts before major data-plane refactors.

### Defer until data proves it

1. Hash partition rollout.
2. Additional projection tables beyond minimal first snapshot projection.
3. Stored procedures for anything except clearly repeatable hot read assembly.

### Reject for now

1. Any schema complexity that cannot state expected p95 gain and rollback plan upfront.

---

## Bottom line

- **Proposal A is better as the controlling execution strategy.**
- **Proposal B is better as an implementation idea bank.**
- The highest-probability success path is: **A’s discipline first, B’s concrete changes only when profiling proves each one.**
