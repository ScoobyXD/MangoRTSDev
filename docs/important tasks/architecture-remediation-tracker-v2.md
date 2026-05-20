# Architecture Remediation Tracker V2

This tracker is the execution plan for the remaining architecture remediation work after the first tracker moved the system from red to yellow.

V1 created the durable event foundation, replayable workspace SSE, inbox projections, scoped read contracts, work-item assignment source rows, command helpers, auth membership cache, bulk map writes, and basic HTTP/SSE metrics.

V2 should not restart that work. It should finish the remaining high-risk gaps:

- Event Plane: remove best-effort post-mutation event appends from production handlers.
- Hot Path Discipline: propagate request context through hot repository paths and add useful DB/event observability.
- Guardrails: make regressions obvious when new code bypasses the event spine or introduces new `context.Background()` usage in hot Postgres methods.

## Current Assessment

| Theme | Current Score | Target Score | Current Read |
| --- | ---: | ---: | --- |
| Event Plane | 68/100 | 85+/100 | Durable events, SSE replay, frontend cursors, gap recovery, and Postgres fanout exist. The main gap is that many handlers still call `publishWorkspaceEvent`, which appends after data mutation and only logs append failure. |
| Hot Path Discipline | 72/100 | 85+/100 | Named GET repair/seeding hot paths are fixed, auth membership is cached, map writes are bulked, and basic metrics exist. The main gaps are widespread repository `context.Background()` and shallow DB/event observability. |

## Operating Rules

- Do not combine these into one large branch.
- Serialize branches that touch shared files such as `repository.go`, migrations, `workspace_handlers.go`, shared event helpers, and metrics interfaces.
- Each event branch must prove:
  - event append happens in the same transaction as the data write;
  - event append failure rolls back the data write;
  - HTTP publishes only committed events returned by the store layer;
  - response shape and existing workspace event payloads remain compatible unless the branch explicitly documents a migration.
- Each context branch must keep old no-context methods as temporary wrappers unless all call sites are converted in the same branch.
- Each metrics branch must use bounded labels. Do not label by raw SQL, IDs, user input, titles, emails, or unbounded paths.
- If a branch adds or changes SQL schema, include migration, backfill, rollback notes, and a copy-paste migration command in the final response.

## Remaining Legacy Event Publisher Inventory

These are the main production areas that still need review for best-effort `publishWorkspaceEvent` usage:

- `backend/internal/http/map_layout_handlers.go`
- `backend/internal/http/company_explorer_handlers.go`
- `backend/internal/http/map_entity_batch_handlers.go`
- `backend/internal/http/logic_gate_handlers.go`
- `backend/internal/http/logic_gate_relationship_handlers.go`
- `backend/internal/http/node_handlers.go` for node information/projection subresources
- `backend/internal/http/communications_triage_handlers.go` for revert paths
- `backend/internal/http/editor_collaboration_handlers.go`

`publishWorkspaceEvent` may remain temporarily for tests or explicitly non-critical collaboration pings, but normal state-changing product mutations should move to committed domain events.

## Branch Order

### 1. `events/atomic-map-layout-events`

Why first:
- Small scope.
- Existing map position writes are already set-based.
- Event payloads are simple: `node_map_positions_updated` and `logic_gate_map_positions_updated`.

Scope:
- Add store methods:
  - `UpsertNodeMapPositionsWithWorkspaceEvent`
  - `UpsertLogicGateMapPositionsWithWorkspaceEvent`
- In Postgres, wrap the bulk upsert and domain event append in one transaction.
- In memory repo, snapshot state and roll back if event append fails.
- Change `handleMapLayout` to call the new methods and then `publishCommittedWorkspaceEvents`.
- Keep response shape unchanged.

Completion criteria:
- No `publishWorkspaceEvent` calls remain in `map_layout_handlers.go`.
- Tests cover node map and Logic Gate map success.
- Tests cover event append failure causing no persisted position changes.
- Tests cover failed mutation publishing no SSE payload.

Rollback:
- Code can return `handleMapLayout` to the prior upsert plus post-mutation publish path.
- Already appended `node_map_positions_updated` and `logic_gate_map_positions_updated` events remain compatible.

### 2. `platform/context-hot-read-slice`

Why second:
- Improves cancellation and timeout behavior before larger event branches add more store methods.
- Keeps scope controlled by starting with hot reads.

Scope:
- Add context-aware repository methods for the hottest read paths used by snapshots and streams:
  - nodes and node relationships;
  - Logic Gates and Logic Gate relationships;
  - Company Explorer folders and folder items;
  - map positions and map windows;
  - domain event replay/version reads;
  - workspace read-version reads.
- Keep old methods as wrappers that call the context versions with `context.Background()`.
- Update HTTP handlers to pass `r.Context()` on converted paths.
- Update workspace stream replay to use the request context for durable catch-up queries where practical.

Completion criteria:
- Hot workspace snapshot paths no longer force Postgres reads through `context.Background()`.
- SSE replay and ETag validators use request/server context-aware calls where practical.
- Existing tests pass without changing response shapes.

Rollback:
- Handlers can call existing no-context methods again.
- New context-aware methods can remain unused.

### 3. `events/atomic-map-entity-batch-events`

Why third:
- Batch map creation can emit several workspace events from one user command.
- Converting it before Company Explorer reduces future drift around folder-item and map-position events.

Scope:
- Extend `CreateMapEntityBatch` or add `CreateMapEntityBatchWithWorkspaceEvents`.
- Append all resulting workspace events inside the batch transaction:
  - entity created events;
  - folder item assigned events;
  - map position updated events;
  - relationship created events.
- Change `map_entity_batch_handlers.go` to publish committed returned events only.

Completion criteria:
- No `publishWorkspaceEvent` calls remain in `map_entity_batch_handlers.go`.
- Event append failure rolls back all created nodes, Logic Gates, folder items, positions, and relationships.
- Tests cover mixed event emission order for node and Logic Gate batches.

Rollback:
- Code can return to handler-level publish.
- Existing durable events remain compatible with workspace replay consumers.

### 4. `platform/db-operation-metrics-foundation`

Why fourth:
- Adds visibility before the larger Company Explorer and Logic Gate conversions.

Scope:
- Extend metrics with DB operation observations:
  - operation name;
  - outcome;
  - duration;
  - row count when cheaply available.
- Add event append metrics:
  - append count;
  - append latency;
  - append failures;
  - idempotency hit count if available.
- Add bounded operation names, for example:
  - `nodes.list`
  - `company_explorer.folder_items.list`
  - `domain_events.append`
  - `domain_events.replay`
  - `workspace_read_versions.current`
- Do not expose raw SQL in metric labels.

Completion criteria:
- Metrics tests prove route metrics still work.
- New metrics tests prove DB/event operation counts and failures record with bounded labels.
- A small number of hot DB operations are instrumented first. Do not try to instrument every repository method in this branch.

Rollback:
- Code can remove instrumentation while leaving behavior unchanged.

### 5. `events/atomic-company-explorer-events`

Why fifth:
- Company Explorer is one of the largest remaining best-effort publisher clusters.
- Do it after smaller event patterns are established.

Scope:
- Convert folder create/update/delete.
- Convert folder item assign/remove.
- Convert folder share upsert/delete if those events remain product-relevant.
- Convert cascade delete flows so all data changes and all emitted workspace events are committed or rolled back together.
- Consider moving communications shared-inbox RACI full-replace to a dedicated branch if it makes this branch too large.

Completion criteria:
- No normal Company Explorer mutation in `company_explorer_handlers.go` appends events after commit.
- Multi-event deletes return committed event slices from the store layer.
- Event append failure rolls back folder, item, share, and cascade delete mutations.
- Existing frontend stream consumers continue to handle event shapes.

Rollback:
- Code can return to handler-level publish for Company Explorer.
- Already appended events remain durable compatibility events.

### 6. `events/atomic-node-subresource-events`

Why sixth:
- Base node create/update/delete and node relationships already use committed event paths.
- Remaining node subresources are narrower and should be completed separately.

Scope:
- Convert node information/projection writes and deletes in `node_handlers.go`.
- Convert any remaining node-related handler event calls that are not already covered by node graph transactional helpers.
- Decide whether editor document writes belong here or in the editor versioning work.

Completion criteria:
- Node subresource mutations that affect workspace freshness append events transactionally.
- Tests prove failed event append rolls back the information/projection mutation.
- No broad workspace invalidation behavior is introduced.

Rollback:
- Code can return node subresources to prior publish behavior.

### 7. `events/atomic-logic-gate-events`

Why seventh:
- Logic Gate mutation paths include entity, relationship, projection, information, and RACI compatibility behavior.
- This is likely the highest-risk remaining event branch after Company Explorer.

Scope:
- Convert Logic Gate create/update/delete.
- Convert Logic Gate relationships.
- Convert Logic Gate information/projection writes and deletes.
- Convert or retire legacy full-replace RACI path:
  - preferred: route UI/client usage through add/remove RACI commands;
  - acceptable transitional step: make full-replace RACI transactional with committed returned events.

Completion criteria:
- Normal Logic Gate mutation handlers publish only committed events.
- Add/remove RACI commands remain the preferred API.
- Full-replace RACI is either removed from hot usage or made atomic.
- Tests cover event append rollback for entity, relationship, and RACI mutation paths.

Rollback:
- Code can return specific Logic Gate handlers to prior behavior if necessary.
- Event payloads remain compatible.

### 8. `events/atomic-communications-revert-events`

Why eighth:
- Email conversion is already transactional, but revert still has post-mutation workspace event publishing.
- This is a good cleanup branch after the main work-item path is stable.

Scope:
- Convert `RevertCommunicationsTriageNode` to return committed domain events.
- Append card deletion and node deletion workspace events in the revert transaction.
- Publish committed events in `communications_triage_handlers.go`.

Completion criteria:
- Revert cannot delete data while losing its workspace events.
- Communications stream behavior remains unchanged.
- Tests cover rollback on event append failure.

Rollback:
- Code can return revert to prior post-mutation event publish.

### 9. `platform/context-command-mutations`

Why ninth:
- Once the event command surface is mostly converted, propagate context through mutation commands.

Scope:
- Add context-aware command methods for transactional mutations:
  - Kanban with workspace events;
  - work-item assignment commands;
  - map layout with workspace events;
  - map entity batch with workspace events;
  - Company Explorer atomic commands;
  - Logic Gate atomic commands.
- Use one context through:
  - validation reads;
  - transaction begin;
  - data writes;
  - domain event append.
- Keep old wrappers temporarily.

Completion criteria:
- Converted HTTP mutation handlers pass `r.Context()` into store commands.
- Transactional event append uses the same context as the data mutation.
- Existing tests pass.

Rollback:
- Handlers can call no-context wrappers again.

### 10. `platform/context-guardrails`

Why tenth:
- Add guardrails only after the current repository shape has enough context-aware paths to avoid noisy failures.

Scope:
- Add a focused static test or script that scans `backend/internal/store/postgres_*.go`.
- Fail on new `context.Background()` unless it is in an approved wrapper, background service, or explicitly documented cold path.
- Add a second scan for production handler calls to `publishWorkspaceEvent(`, with an allowlist for tests and explicitly approved non-critical streams.

Completion criteria:
- CI fails when new hot Postgres code introduces unapproved `context.Background()`.
- CI fails when new production mutation handlers use legacy post-mutation event append.
- Allowlist is short and documented in the test.

Rollback:
- Remove or relax the guardrail test if it blocks urgent production work.

### 11. `platform/event-and-db-slo-snapshot`

Why eleventh:
- After metrics exist and hot paths are instrumented, define useful runtime snapshots.

Scope:
- Add a developer-visible metrics snapshot or debug endpoint if one does not already exist for the new metrics.
- Include:
  - slowest DB operation totals by operation name;
  - event append failures;
  - workspace replay batch/event counts;
  - replay lag indicators where available;
  - HTTP conditional GET hit counts.
- Keep it dev/admin scoped if exposed over HTTP.

Completion criteria:
- A developer can answer whether an endpoint is slow because of DB reads, event replay, or payload generation.
- Metrics labels remain bounded.
- No secrets or user content appear in metrics.

Rollback:
- Remove the snapshot/export surface while keeping in-process metrics.

## Definition Of Done For V2

Event Plane is considered green when:

- Normal product mutations append durable workspace events in the same transaction as the data write.
- Handler-level `publishWorkspaceEvent` is not used for ordinary state changes.
- SSE fanout is only a delivery optimization over committed durable events.
- Event append failure fails the command before commit.
- Tests cover rollback for each converted mutation family.

Hot Path Discipline is considered green when:

- Hot request repository calls accept and use caller context.
- New Postgres hot-path methods do not introduce unapproved `context.Background()`.
- DB operation and event append metrics exist with bounded labels.
- Workspace replay/catch-up metrics can show event volume and lag behavior.
- GET handlers do not perform repair, seeding, or DDL.

## Recommended Codex Prompt Template

Use one branch at a time. Example:

```text
Implement branch `events/atomic-map-layout-events` from docs/important tasks/architecture-remediation-tracker-v2.md.

Do not touch unrelated branches.
Keep response shapes compatible.
Add tests proving event append failure rolls back the data mutation and failed mutations publish no SSE event.
Do not modify the historical v1 tracker except to mark this v2 branch complete if finished.
```

## Notes For Future Updates

- Mark a branch complete only after implementation and tests.
- If a branch gets split, add the child branches here rather than expanding the active branch endlessly.
- If a schema migration is added, include migration, backfill, rollback, and copy-paste migration commands.
- Keep V1 as historical context. V2 is the remaining execution queue.
