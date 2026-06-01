# POST/PUT Latency Improvement V2

## Purpose

Make slow POST/PUT operations measurable, explainable, and then removable.

The immediate priority is not guessing which subsystem is slow. The priority is to produce accounting-grade request timing where every meaningful operation is itemized and the sum of the itemized timings explains the total request duration.

## Target Operations

These benchmark cases are the acceptance suite for this project.

| ID | User Operation | Endpoint Pattern | Current Known Time |
| --- | --- | --- | ---: |
| B1 | Create raw node in Others section | `POST /v1/workspace/entity-batches` | `1.7221402s` |
| B2 | Create Logic Gate from Others priority/status matrix path | `POST /v1/workspace/entity-batches` | `1.4256028s` |
| B3 | Create node in empty Others matrix cell, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `4.683535s` |
| B4 | Create Logic Gate in empty R matrix cell | `POST /v1/workspace/entity-batches` | `1.6836499s` |
| B5 | Create node in R matrix, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `4.3368561s` |
| B6 | Move node from one Logic Gate to another in matrix | `POST /v2/racio-matrix/nodes/{nodeID}/move` | `2.438184s` |
| B7 | Create node in Logic Gate Kanban column | `POST /v2/logic-gates/{id}/nodes` | `3.5826761s`, needs detailed timing |
| B8 | Create node on existing Logic Gate in RACIO matrix | `POST /v1/workspace/entity-batches`, then `POST /v2/logic-gates/{id}/nodes` | `3.2316668s` write time, needs detailed timing |

## Root Diagnosis To Prove Or Disprove

Current evidence suggests each mutation is mixing too many responsibilities into one synchronous request:

1. Source-of-truth writes
2. Legacy Kanban writes
3. Explorer/map/folder writes
4. RACIO projection sync
5. Projection rereads
6. Domain event append
7. Domain event publish
8. Notification projection
9. Frontend GET reload storm
10. Response/visible completion

Phase 1 must measure these categories precisely enough that we can say:

```text
request total = measured source writes
              + measured legacy Kanban writes
              + measured explorer/map/folder writes
              + measured RACIO projection work
              + measured rereads
              + measured event append
              + measured event publish
              + measured notification projection
              + measured serialization/response overhead
              + unaccounted overhead
```

`unaccounted overhead` should be small. If it is not small, instrumentation is incomplete.

## Required Timing Buckets

Every instrumented POST/PUT should emit one grouped timing line with these top-level buckets.

### Request And Response

- `request.decode`
- `request.validate`
- `request.auth`
- `request.access_check`
- `response.serialize`
- `response.write`
- `request.total`
- `request.accounted_total`
- `request.unaccounted`

### Source-Of-Truth Writes

Operations that write authoritative business state.

- `source.node_insert`
- `source.node_update`
- `source.logic_gate_insert`
- `source.logic_gate_update`
- `source.assignment_insert`
- `source.assignment_update`
- `source.raci_assignment_insert`
- `source.raci_assignment_update`
- `source.access_policy_copy`
- `source.transaction_commit`

### Legacy Kanban Writes

Operations that exist because Kanban still has legacy board/column/card tables.

- `legacy_kanban.board_read`
- `legacy_kanban.board_insert_or_ensure`
- `legacy_kanban.column_read`
- `legacy_kanban.column_insert_or_ensure`
- `legacy_kanban.card_read`
- `legacy_kanban.card_insert`
- `legacy_kanban.card_update`
- `legacy_kanban.card_delete`
- `legacy_kanban.card_trigger_assignment_sync`

### Explorer, Map, And Folder Writes

Operations that update workspace/explorer placement or folder views.

- `explorer.folder_setup`
- `explorer.folder_item_read`
- `explorer.folder_item_insert`
- `explorer.folder_item_update`
- `explorer.folder_position_read`
- `map.position_insert`
- `map.position_update`

### RACIO Projection Sync

Operations that update derived RACIO read models.

- `racio_projection.delete_stale`
- `racio_projection.insert`
- `racio_projection.upsert`
- `racio_projection.update`
- `racio_projection.sync_total`

### Rereads

Operations that reread state after writing in order to build responses or events.

- `reread.node`
- `reread.logic_gate`
- `reread.assignment`
- `reread.kanban_card`
- `reread.racio_projection`
- `reread.workspace_payload`

### Domain Events

Operations for durable event writes and post-commit publish.

- `events.build_payload`
- `events.normalize_payload`
- `events.sequence_lock`
- `events.insert`
- `events.read_version_trigger`
- `events.append_total`
- `events.publish.serialize`
- `events.publish.fanout`
- `events.publish.client_send`
- `events.publish.listener`
- `events.publish_total`

### Notifications

- `notifications.map_event`
- `notifications.load_recipients`
- `notifications.load_node`
- `notifications.insert`
- `notifications.publish`
- `notifications.total`

### Frontend Reload Storm

Frontend timing should be logged separately and correlated to the mutation.

- `frontend.mutation_request`
- `frontend.mutation_response`
- `frontend.workspace_snapshot_get`
- `frontend.company_explorer_folders_get`
- `frontend.company_explorer_folder_items_get`
- `frontend.logic_gates_get`
- `frontend.nodes_get`
- `frontend.reload_storm_total`
- `frontend.visible_completion`

## Phase 1: Accounting-Grade Instrumentation

Status: Implemented; live B1-B8 benchmark rerun pending.

Goal: Produce a complete operation list and timing ledger for B1 through B8.

Rules:

- Do not optimize behavior in this phase.
- Do not delete code in this phase.
- Do not move work async in this phase.
- Add timing only.
- Every slow POST/PUT should have one grouped timing line.
- Timings must be nested but also summarized into the required top-level buckets.
- The sum of top-level buckets should approximately equal total request time.
- Include `request.accounted_total` and `request.unaccounted`.
- If a bucket runs multiple times, log count and total, for example `events.insert=190ms(6x)`.
- Prefer request-scoped timing helpers over scattered ad hoc log calls.

Tasks:

- [x] Add or extend a request-scoped timing ledger helper.
- [x] Add top-level bucket accounting to the HTTP handlers.
- [x] Add nested timing in repository methods for source-of-truth writes.
- [x] Add nested timing for legacy Kanban board/column/card reads and writes.
- [x] Add nested timing for explorer/map/folder operations.
- [x] Add nested timing for RACIO projection delete/insert/upsert/update work.
- [x] Add nested timing for projection and entity rereads.
- [x] Break down domain event append, including lock, insert, and trigger time where possible.
- [x] Break down domain event publish internals.
- [x] Break down notification projection internals.
- [ ] Add frontend correlated timing for mutation plus reload GET storm.
- [ ] Run B1 through B8 and paste the measured timing output into this document.

Success criteria:

- For every benchmark case, the timing line explains the total request duration.
- `request.unaccounted` is below 5% of total or explicitly explained.
- We have an exact list of writes and expensive reads performed by every benchmark case.
- We can rank the top five removable costs by measured time, not intuition.

## Phase 1 Implementation Notes

Scope guard: Phase 1 only. This pass adds timing instrumentation and does not optimize behavior, delete code, move work async, or change endpoint semantics.

### Backend Timing Output

Each targeted slow POST/PUT emits one grouped backend log line:

```text
request_timing method=POST path=/v2/racio-matrix/nodes route=/v2/racio-matrix/nodes status=201 request_id=- request.total=<duration> request.accounted_total=<duration> request.unaccounted=<duration> timings=request.decode=<duration> request.validate=<duration>(Nx) request.auth=<duration> request.access_check=<duration>(Nx) source.transaction=<duration> ... response.serialize=<duration> response.write=<duration>
```

`request.accounted_total` is the sum of top-level blocking spans only. Nested spans such as `source.node`, `kanban.card_update`, `events.insert`, and `racio_projection.upsert` are itemized for diagnosis but are not counted again.

Repeated operations are aggregated as `<duration>(Nx)`, for example `events.insert=190ms(6x)`.

### Instrumented Backend Buckets

- Request ledger: `request.total`, `request.accounted_total`, `request.unaccounted`, `request.decode`, `request.validate`, `request.auth`, `request.access_check`, `response.serialize`, `response.write`.
- Source-of-truth writes: `source.node`, `source.logic_gate`, `source.assignment`, `source.raci_assignment`, `source.access_policy_copy`, `source.transaction_commit`.
- Legacy Kanban writes: `kanban.board_ensure`, `kanban.board_read`, `kanban.board_column_ensure`, `kanban.column_read`, `kanban.card_read`, `kanban.card_insert`, `kanban.card_update`, `kanban.card_delete`, `kanban.card_trigger_assignment_sync`.
- Explorer/map/folder writes: `explorer.folder_setup`, `explorer.folder_item_read`, `explorer.folder_item_write`, `explorer.folder_position_read`, `map.position_write`.
- RACIO projection sync: `racio_projection.delete_stale`, `racio_projection.upsert`, `racio_projection.total`. Insert/update are currently represented by the PostgreSQL upsert bucket.
- Rereads: `reread.node`, `reread.assignment`, `reread.racio_projection`; Kanban card rereads are currently logged under `kanban.card_read`, and workspace payload rereads are represented by the frontend follow-up GET timing lines.
- Domain events: `events.payload_build`, `events.sequence_lock`, `events.insert`, `events.append.total`, `events.append.batch_total`, `events.append.item_total`. Read-version trigger time is inside `events.insert` because it is database-trigger work.
- Domain event publish: `events.publish.total`, `events.publish.serialize`, `events.publish.fanout`, `events.publish.client_send`, `events.publish.listener_work`.
- Notifications: `notifications.total`, `notifications.event_mapping`, `notifications.recipient_load`, `notifications.node_load`, `notifications.insert`, `notifications.publish.serialize`, `notifications.publish`.
- Frontend reload storm: the existing frontend `request_timing` console logs cover benchmark mutations plus follow-up GETs for workspace snapshot, folders, folder items, logic gates, nodes, Kanban, and v2 Logic Gate/node views.

### Manual Execution Notes

1. Start the backend and frontend against a seeded workspace with an authenticated user.
2. Open browser devtools and preserve console logs.
3. Execute B1-B8 through the UI.
4. For each scenario, save the backend `request_timing` line(s), frontend mutation `request_timing`, and follow-up GET `request_timing` lines.
5. Confirm `request.unaccounted` is below 5% of `request.total`; if not, record the dominant missing span or error-path reason next to the benchmark row.

No live benchmark was run in this implementation pass because this worker does not have an authenticated browser session and seeded application state.

### Verification

- 2026-06-01: `go test ./internal/http` passed.
- 2026-06-01: `go test ./internal/store` passed.
- 2026-06-01: `go test ./internal/notifications` passed.
- 2026-06-01: `go test ./...` from `backend` passed.
- Frontend build/tests were not run by the worker because Phase 1 did not change frontend source.

## Phase 2: Remove Non-Command Work From The HTTP Critical Path

Status: Not started.

Goal: Return after source-of-truth writes and durable event append, without waiting for fan-out, notifications, or broad reload behavior.

Tasks:

- [ ] Move domain event publish out of the blocking HTTP response path.
- [ ] Move notification projection out of the blocking HTTP response path.
- [ ] Ensure durable event append still happens before response.
- [ ] Ensure async workers can catch up from durable events.
- [ ] Prevent successful mutations from forcing broad GET reload storms unless recovery is needed.
- [ ] Rerun B1 through B8 and update the benchmark table.

Expected win:

- Remove the measured `domain_event_publish=664ms-2.299s` from request duration.
- Remove measured `notification_projection=199ms-335ms` from request duration where present.

## Phase 3: Delete Redundant Writes And Legacy Compatibility Work

Status: Not started.

Goal: Shrink repository transactions by deleting operations that are not required for the authoritative command.

Tasks:

- [ ] Remove or bypass hot-path legacy Kanban board/column/card writes.
- [ ] Delete or bypass `kanban_cards -> node_logic_gate_assignments` sync behavior for new command paths.
- [ ] Replace hot-path Kanban writes with a minimal projection/read model.
- [ ] Review whether explorer/map/folder writes must be synchronous for each benchmark case.
- [ ] Remove projection rereads that are not required for the response.
- [ ] Remove duplicate node/assignment writes inside combined create/assign paths.
- [ ] Rerun B1 through B8 and update the benchmark table.

Expected win:

- Reduce repository transaction time, especially B3, B5, B6, B7, and B8.
- Make simple B1/B2/B4 transactions approach the sub-500ms target.

## Phase 4: Command Model And Projection Deltas

Status: Not started.

Goal: Make each user action one command and make derived views update by minimal deltas.

Tasks:

- [ ] Replace create-node-then-assign flows with one command.
- [ ] Add/finalize command for node creation inside an existing Logic Gate.
- [ ] Add/finalize command for Logic Gate plus node creation in an empty matrix cell.
- [ ] Add/finalize command for node move within a Logic Gate.
- [ ] Add/finalize command for node move between Logic Gates.
- [ ] Add/finalize batch commands for multi-node/multi-gate moves where needed.
- [ ] Convert RACIO projection create to direct insert where possible.
- [ ] Convert RACIO projection move to direct update where possible.
- [ ] Convert RACIO projection delete to direct delete where possible.
- [ ] Collapse multiple domain events into one command-level event per user action where possible.
- [ ] Rerun B1 through B8 and update the benchmark table.

Expected win:

- B8 should stop paying two serial POST costs.
- RACIO create/move paths should stop paying broad recompute/reread costs.
- Event append should stop scaling with legacy derived events.

## Benchmark Table

Update after each phase.

| Case | Baseline | After Phase 1 Accounting | After Phase 2 Async Side Effects | After Phase 3 Deletions | After Phase 4 Commands/Deltas |
| --- | ---: | ---: | ---: | ---: | ---: |
| B1 Raw node in Others | `1.7221402s` |  |  |  |  |
| B2 Logic Gate from Others matrix | `1.4256028s` |  |  |  |  |
| B3 Node in empty Others matrix cell | `4.683535s` |  |  |  |  |
| B4 Logic Gate in empty R matrix cell | `1.6836499s` |  |  |  |  |
| B5 Node in R matrix | `4.3368561s` |  |  |  |  |
| B6 Move node between Logic Gates | `2.438184s` |  |  |  |  |
| B7 Node in Logic Gate Kanban column | `3.5826761s`, needs detailed timing |  |  |  |  |
| B8 Node on existing Logic Gate in RACIO matrix | `3.2316668s` writes, needs detailed timing |  |  |  |  |

## Guardrails

- Phase 1 is measurement only.
- Do not parallelize duplicate work before deleting it.
- Do not make projections authoritative.
- Keep source-of-truth writes small and explicit.
- Every phase must rerun all benchmark cases.
- Every benchmark case must have a remaining-bottleneck note after each rerun.

