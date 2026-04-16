Direct answers
Should each Node have its own UUID and also a company ID?
Yes.
Use:

node_id (UUIDv7) = globally unique object ID

tenant_id (company/workspace/org ID, also UUID) = ownership/isolation boundary

One master node table vs separate table per company?
For most enterprise SaaS: one shared nodes table with tenant_id on every row is the best default.
Then enforce isolation with:

app-layer tenant scoping,

DB constraints/indexes,

ideally Postgres Row Level Security (RLS).

=========================================================================================================

1) Tenant-scoped indexed access
Every major table should include tenant_id and use composite indexes beginning with tenant:

(tenant_id, node_id)

(tenant_id, from_id, edge_type)

(tenant_id, to_id, edge_type)

This prevents cross-tenant scans and keeps lookup set small.

Your plan explicitly requires tenant scoping keys on every business table/query path.

2) Split normalized write model from read model
For UI screens, don’t reconstruct giant graphs live every time.
Use precomputed/read-optimized projections for common views (“node details”, “gate queue”, “recent events”).

Your plan already points toward this approach via separate read service and async index updates.

3) Relationship rows, not giant embedded blobs
At scale, linking “1B things” is done with edge rows + indexed joins, not by putting everything inside one giant node record.

4) Partition very large event/edge tables
Partition by tenant hash and/or time where needed.
This keeps indexes and hot partitions smaller.

5) Measure + tune continuously
Your docs already have the right operational posture: load test, tune slow queries, add missing indexes, add cache only for measured hot spots.

=========================================================================================================

What “good at the limit” looks like
Bound every query (pagination, limits, time windows).

Tenant-scoped composite indexes so scans stay narrow.

Two-step reads for graph:

step A: fetch relevant edge IDs (small, indexed),

step B: batch fetch target nodes.

Partition large edge/event tables (by tenant hash and/or time) to keep indexes smaller.

Precompute read models for common UI screens (don’t compute huge graph joins live every request).

Continuously measure and tune (EXPLAIN plans, p95/p99 latency, slow query logs, load tests).

Your docs already prescribe this measure/tune approach and Aurora/Postgres direction, which is the right base strategy.

=========================================================================================================

