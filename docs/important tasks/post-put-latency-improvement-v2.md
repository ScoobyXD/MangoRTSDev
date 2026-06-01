# POST/PUT Latency Improvement V2

## Phase 1: Accounting-Grade Timing Instrumentation

Status: Implemented; live B1-B8 benchmark rerun pending.

Scope guard: Phase 1 only. This pass adds timing instrumentation and does not optimize behavior, delete code, move work async, or change endpoint semantics.

## Backend Timing Output

Each targeted slow POST/PUT emits one grouped backend log line:

```text
request_timing method=POST path=/v2/racio-matrix/nodes route=/v2/racio-matrix/nodes status=201 request_id=- request.total=<duration> request.accounted_total=<duration> request.unaccounted=<duration> timings=request.decode=<duration> request.validate=<duration>(Nx) request.auth=<duration> request.access_check=<duration>(Nx) source.transaction=<duration> ... response.serialize=<duration> response.write=<duration>
```

`request.accounted_total` is the sum of top-level blocking spans only. Nested spans such as `source.node`, `kanban.card_update`, `events.insert`, and `racio_projection.upsert` are itemized for diagnosis but are not counted again.

Repeated operations are aggregated as `<duration>(Nx)`, for example `events.insert=190ms(6x)`.

## Instrumented Buckets

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

## Benchmarks

| ID | Scenario | Endpoint(s) | Phase 1 timing output |
| --- | --- | --- | --- |
| B1 | Create raw node in Others section | `POST /v1/workspace/entity-batches` | Pending live rerun; capture backend `request_timing` and frontend console `request_timing` lines. |
| B2 | Create Logic Gate | `POST /v1/workspace/entity-batches` | Pending live rerun. |
| B3 | Create node in empty matrix cell | `POST /v2/racio-matrix/nodes` | Pending live rerun. |
| B4 | Create Logic Gate from matrix | `POST /v1/workspace/entity-batches` | Pending live rerun. |
| B5 | Create node in empty matrix cell with Logic Gate plus node | `POST /v2/racio-matrix/nodes` | Pending live rerun. |
| B6 | Move node between Logic Gates | `POST /v2/racio-matrix/nodes/{nodeID}/move` | Pending live rerun. |
| B7 | Create node in Logic Gate Kanban column | `POST /v2/logic-gates/{id}/nodes` | Pending live rerun. |
| B8 | Create node on existing Logic Gate in RACIO matrix | `POST /v1/workspace/entity-batches`, then `POST /v2/logic-gates/{id}/nodes` | Pending live rerun; capture both POST timing lines and follow-up GETs. |

## Manual Execution Notes

1. Start the backend and frontend against a seeded workspace with an authenticated user.
2. Open browser devtools and preserve console logs.
3. Execute B1-B8 through the UI.
4. For each scenario, save the backend `request_timing` line(s), frontend mutation `request_timing`, and follow-up GET `request_timing` lines.
5. Confirm `request.unaccounted` is below 5% of `request.total`; if not, record the dominant missing span or error-path reason next to the benchmark row.

No live benchmark was run in this implementation pass because this worker does not have an authenticated browser session and seeded application state.

## Verification

- 2026-06-01: `go test ./internal/http` passed.
- 2026-06-01: `go test ./internal/store` passed.
- 2026-06-01: `go test ./internal/notifications` passed.
- 2026-06-01: `go test ./...` from `backend` passed.
- Frontend build/tests were not run because Phase 1 did not change frontend source.
