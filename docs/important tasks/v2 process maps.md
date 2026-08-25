# V2 Process Maps

Date: August 24, 2026

Status: V1 is implemented. Required WSL backend, frontend build/focused, and disposable PostgreSQL schema/migration checks pass; the final guarded repository run and local commit are pending.

## Purpose

This file is the implementation ledger for Process Map. It records the shipped contract, canonical implementation files, migration, verification, and rollout state.

This file is not a separate source of business logic. If this ledger conflicts with a numbered law, the numbered law wins and this ledger must be corrected.

## Mandatory References

Every Process Map implementation task must read these files first:

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/tests/process-map.md`](../tests/process-map.md)
- [`docs/tests/relationships.md`](../tests/relationships.md)
- [`docs/tests/permissions.md`](../tests/permissions.md)
- [`docs/tests/recycle-bin.md`](../tests/recycle-bin.md)
- [`docs/tests/REST API & WebSocket.md`](../tests/REST%20API%20&%20WebSocket.md)

The detailed Process Map behavior belongs in `process-map.md`. The exact-identity, semantic-edge, deletion, recycle, and no-registry rules belong in `relationships.md`. Permission behavior belongs in `permissions.md`.

Any implementation that changes those behaviors must update the applicable numbered laws in the same change. Do not copy all of those laws into this ledger.

## Executive Decision

Process Map is one shared, manually authored map per company.

It uses three tables with three separate meanings:

1. `process_map_placements` stores which Folders and Processes are on the map, their independent map parent, and their snapped positions.
2. `resource_operational_relationships` stores the canonical directed operational flow between exact Folders and Processes.
3. `process_map_traces` stores only the saved visual route for one operational relationship.

The frontend loads exactly one root or Folder layer at a time. It does not assemble the map by downloading Company Explorer plus every company relationship.

Process Map is a full-page primary view with stable URLs. It is not a dashboard frame and does not reuse the removed Node Map or Logic Gate Map.

The frontend uses `@xyflow/react` with Mango-owned custom cards and traces. The database and API remain Mango contracts and do not store React Flow objects.

## Vocabulary and Authority

| Meaning | Authority |
|---|---|
| Folder identity, name, and normal facts | `company_explorer_folders` |
| Process identity, name, and normal facts | Existing Logic Gate source records |
| Whether a resource is mapped, its map parent, and its position | `process_map_placements` |
| Directed operational flow | `resource_operational_relationships` |
| Visual route of a visible relationship | `process_map_traces` |
| Access | Existing Mango permission system |
| Company Explorer hierarchy | Existing Company Explorer tables |

`Process` is the product name. The exact stored type remains `logic_gate` until the underlying Logic Gate resource is renamed throughout Mango. Process Map must not create a parallel `process` identity.

Placement and trace rows are canonical map facts because they contain manual work that cannot be recalculated. Names, permissions, source payloads, and Company Explorer hierarchy remain canonical in their existing source tables and are joined at read time.

## V1 Scope

V1 includes:

- Company Explorer Folder cards;
- Process cards backed by exact Logic Gate identities;
- independent manual map parentage;
- manual snapped placement;
- one lazy root or Folder layer per request;
- one fixed input and one fixed output per card;
- directed Folder-to-Folder, Folder-to-Process, Process-to-Folder, and Process-to-Process flow;
- saved trace route points;
- pairwise fan-out and fan-in with shared visual route points;
- stable Folder-layer URLs and browser history;
- normal permissions plus the explicit restricted `?` placeholder rule;
- deletion, recycle, restore, ETag, and realtime integration.

V1 does not include:

- Nodes or Projects on Process Map;
- a Process child layer;
- multiple maps per company;
- automatic layout or automatic placement;
- a minimap;
- adjustable card sizes;
- semantic colors;
- a bend, segment, junction, net, or map-layer table;
- stored viewport, zoom, selection, or personal layout state;
- a resource registry or translated resource identity;
- compatibility with the removed maps or the old Logic Gate relationship API.

## SQL Schema Decisions

There is no `process_maps` table and no `process_map_layers` table. Root is represented by a null map parent. A Folder layer is represented by that Folder's exact canonical ID.

Coordinates use signed integer units of the smallest visible grid square. They are never pixels or floating-point values.

### `process_map_placements`

Exact columns:

```text
company_id             uuid        not null
resource_type          text        not null
resource_id            uuid        not null
map_parent_folder_id   uuid        null
grid_x                 integer     not null
grid_y                 integer     not null
revision               bigint      not null default 1
created_timestamp      timestamptz not null default now()
updated_timestamp      timestamptz not null default now()
```

Required keys and checks:

- Primary key: `(company_id, resource_type, resource_id)`.
- `company_id` references the exact company and cleans up with company deletion.
- `resource_type` is exactly `company_explorer_folder` or `logic_gate`.
- `revision > 0`.
- A null `map_parent_folder_id` is valid only for a Folder placement.
- A non-null `map_parent_folder_id` references an exact same-company `company_explorer_folders` row.
- A Folder cannot name itself as its map parent.
- Folder parent changes must reject every descendant cycle, including concurrent attempts.
- Source validation must prove that the exact typed Folder or Logic Gate exists in the same company.
- Coordinates are not unique. PostgreSQL cannot correctly enforce whole-shape collision rules with a simple coordinate uniqueness constraint; the V1 overlap behavior remains a product decision below.

Required indexes:

```text
primary key (company_id, resource_type, resource_id)
index       (company_id, map_parent_folder_id, resource_type, resource_id)
```

The primary key gives one placement per exact typed resource. The parent index supplies one bounded layer read. No coordinate index is required until viewport-window reads are proven necessary.

Do not add a placement ID, copied name, dimensions, color, permission data, Company Explorer parent, viewport, zoom, or generic payload.

The database revision is output and audit information. The client does not send an expected revision and the write does not use `If-Match`. Each successful placement save increments the revision, and the last committed save wins.

### `resource_operational_relationships`

Exact columns:

```text
company_id                              uuid        not null
resource_operational_relationship_id    uuid        not null
source_resource_type                    text        not null
source_resource_id                      uuid        not null
target_resource_type                    text        not null
target_resource_id                      uuid        not null
created_timestamp                       timestamptz not null default now()
```

Required keys and checks:

- Primary key: `(company_id, resource_operational_relationship_id)`.
- Unique semantic edge: `(company_id, source_resource_type, source_resource_id, target_resource_type, target_resource_id)`.
- Both resource types are exactly `company_explorer_folder` or `logic_gate`.
- Both exact typed endpoints must exist in the same company.
- An endpoint cannot connect to itself using the same type and ID.
- Reverse direction is a different relationship.
- Source and target are immutable after insertion.
- Changing either endpoint or direction deletes the old relationship and creates a new relationship.
- Relationship deletion never deletes either endpoint or either placement.

Required indexes:

```text
primary key (company_id, resource_operational_relationship_id)
unique      (company_id, source_resource_type, source_resource_id,
             target_resource_type, target_resource_id)
index       (company_id, target_resource_type, target_resource_id,
             resource_operational_relationship_id)
```

The unique semantic edge already supports outgoing lookup. The target index supplies incoming lookup.

Repeated creation of the same exact directed pair is idempotent: it returns or reuses the existing row instead of inserting a duplicate. This does not make the reverse direction the same relationship.

Do not add map parentage, positions, route data, copied names, permissions, an updated timestamp, or a mutable direction column.

### `process_map_traces`

Exact columns:

```text
company_id                              uuid        not null
resource_operational_relationship_id    uuid        not null
route_points                            jsonb       not null default '[]'::jsonb
revision                                bigint      not null default 1
created_timestamp                       timestamptz not null default now()
updated_timestamp                       timestamptz not null default now()
```

Required keys and checks:

- Primary key: `(company_id, resource_operational_relationship_id)`.
- The same composite key references `resource_operational_relationships` with `ON DELETE CASCADE`.
- `revision > 0`.
- `updated_timestamp >= created_timestamp`.
- `route_points` is an ordered JSON array.
- Every route point is exactly an object containing integer `x` and `y` grid coordinates.
- `[]` means a direct route between the derived fixed anchors.
- One relationship has at most one trace.
- A relationship may exist without a trace.

Canonical JSON shape:

```json
[
  { "x": 12, "y": 4 },
  { "x": 12, "y": 9 }
]
```

Route points contain only intermediate global grid coordinates. Source and target coordinates are derived from current placements and the two fixed presentation anchors.

Do not add a trace ID, source or target identity, layer ID, endpoint coordinate, anchor column, SVG path, pixel coordinate, GIN index, bend table, segment table, junction table, or net table.

Rerouting replaces the JSON value as one atomic save, preserves the relationship and creation timestamp, increments revision once, and advances the database update timestamp. The last committed route wins.

### Why Three Tables Are Still the Simple Design

The three tables avoid copied state and represent three facts that can exist independently:

- A resource may be placed without any operational relationship.
- An operational relationship may exist without a visible trace.
- A trace cannot exist without its operational relationship.

The route points are always read and replaced together, so a JSONB value is simpler than a child row per bend. A separate bend table would add joins and write ordering without helping any current query.

The layer read remains bounded. It starts with the indexed placement rows for one map parent, joins current resource and permission facts in batches, and returns only traces whose two exact endpoints are visible placements on that layer. It does not recalculate the whole company map.

## Old `logic_gate_relationships` Cutover

`resource_operational_relationships` replaces the old Process-to-Process business meaning. Both tables must never remain live authorities.

The forward-only migration:

1. Preflight every target database for invalid rows and duplicate directed semantic edges.
2. Convert `Output -> Input` into exact `source -> target` direction.
3. Preserve each old relationship UUID as `resource_operational_relationship_id`.
4. Store `logic_gate` as both endpoint types.
5. Preserve `created_timestamp`.
6. Cut over every repository read/write, consolidated view, workspace batch, API, event, ETag scope, deletion path, recycle path, memory implementation, frontend consumer, and test.
7. Drop the old table and its now-unused enum after the new authority is live everywhere in the same forward change.

Development was checked through the designated database-enforced read-only connection on August 24, 2026. That development database had 517 Logic Gates and zero `logic_gate_relationships` rows. That lowers development data risk but does not prove that every other database is empty, so the shipped migration retains the complete preflight and conversion.

There is no dual write, fallback read, compatibility endpoint, compatibility type, or second relationship authority.

## Backend Architecture

### Boundaries

One small `ProcessMapRepository` capability is embedded once in the existing `store.Repository`. There is no generic graph service or resource registry.

Repository methods:

```text
GetProcessMapLayer
ListResourceOperationalRelationshipsForResource
PutProcessMapPlacement
DeleteProcessMapPlacement
CreateResourceOperationalRelationship
PutProcessMapTrace
DeleteResourceOperationalRelationship
```

Every mutation input carries the authenticated actor or permission-user ID. PostgreSQL resolves effective access after the transaction begins and after the required lock is held; the memory implementation must enforce the same rule. A handler-only permission precheck is not sufficient.

Canonical feature boundaries:

```text
backend/internal/domain/process_map.go
backend/internal/store/process_map.go
backend/internal/store/postgres_process_map.go
backend/internal/store/memory_process_map.go
backend/internal/http/process_map_handlers.go
```

Existing shared files should be touched only where required for route registration, repository composition, schema, read versions, events, deletion, recycle, and tests.

### Transaction Rules

Every write must load and authorize the real rows inside the transaction. The handler must not authorize caller-supplied endpoint hints and then perform a separate racy write.

Use a short per-company transaction lock only when creating or changing Folder map parentage, because that is where a concurrent cycle can be formed. Ordinary position moves and trace reroutes use row locks, while relationship creation uses the semantic unique constraint. Do not serialize every Process Map write for the whole company.

Placement upsert transaction:

1. Lock the company map-parent transaction boundary only when map parentage can change.
2. Validate the exact typed same-company source.
3. Validate and authorize the destination Folder when the parent changes.
4. Reject root Processes, self-parenting, and Folder cycles.
5. Upsert the position and map parent.
6. Increment revision for every successful placement save.
7. If the map parent changed, delete now-invalid incident trace geometry while preserving operational relationships.
8. Append the domain event and realtime outbox work in the same transaction.

A position-only move on the same layer preserves its trace rows. Trace endpoints follow the moved card because endpoint coordinates are derived; intermediate points stay saved until the user reroutes them.

Placement deletion transaction:

1. Load and authorize the exact placed resource.
2. Delete incident trace geometry for its former layer.
3. Delete only the exact placement.
4. Preserve operational relationships, the source resource, Company Explorer state, and the interior contents of an unmapped Folder's own layer.

Relationship and optional trace transaction:

1. Load, validate, and require Edit access to both exact endpoints.
2. Reject cross-company and exact typed self-relationships.
3. Insert or reuse the one semantic directed relationship.
4. If trace data is present, require both endpoints to have placements on the same layer.
5. Validate every route point.
6. Create or replace the one trace.
7. Append only the events for facts that changed.
8. Commit all changes or none.

Submitting the same relationship and identical route again returns the existing state without another relationship row or a pointless route revision. Submitting a different route for the same relationship is a trace reroute and uses last-committed-save-wins behavior.

Relationship deletion transaction:

1. Load the stored relationship and authorize its actual endpoints.
2. Delete the relationship.
3. Let the trace foreign key cascade delete its geometry.
4. Preserve both endpoint resources and placements.
5. Append the deletion event in the same transaction.

Handlers wake realtime only after a successful repository commit. Generic domain-event append coalesces the permission-safe Process Map outbox row inside the same transaction or memory rollback boundary, including source, permission, and group visibility changes.

### Validation

Write handlers must reject unknown JSON fields. The API accepts only the exact stored resource types `company_explorer_folder` and `logic_gate`.

The database uses narrow Process Map validation for polymorphic source existence, same-company endpoints, immutable endpoints, valid route JSON, and map-parent cycles. These validators are not a resource registry and do not translate identities.

## HTTP API

The API is deliberately small. One read returns one complete authorized layer. One bounded read exposes canonical relationship-only rows to the active non-map consumers that survive the old cutover. Five mutation methods cover placement, relationship creation, trace routing, and deletion.

### Read One Layer

```http
GET /v1/process-map/layer?company_id={company_id}
GET /v1/process-map/layer?company_id={company_id}&folder_id={folder_id}
```

Omitting `folder_id` reads root. Supplying `folder_id` reads that exact Folder layer after direct access is checked.

Response shape:

```json
{
  "layer": {
    "kind": "root"
  },
  "placements": [
    {
      "restricted": false,
      "resource_type": "company_explorer_folder",
      "resource_id": "...",
      "name": "Operations",
      "grid_x": 4,
      "grid_y": 8,
      "revision": 3,
      "created_timestamp": "...",
      "updated_timestamp": "..."
    },
    {
      "restricted": true,
      "grid_x": 14,
      "grid_y": 8
    }
  ],
  "traces": [
    {
      "resource_operational_relationship_id": "...",
      "source": {
        "resource_type": "company_explorer_folder",
        "resource_id": "..."
      },
      "target": {
        "resource_type": "logic_gate",
        "resource_id": "..."
      },
      "route_points": [
        { "x": 9, "y": 10 },
        { "x": 12, "y": 10 }
      ],
      "revision": 2,
      "created_timestamp": "...",
      "updated_timestamp": "..."
    }
  ]
}
```

A Folder-layer response uses:

```json
{
  "kind": "folder",
  "folder_id": "...",
  "name": "Operations"
}
```

The restricted placement object intentionally contains only `restricted`, `grid_x`, and `grid_y`. The frontend supplies the uniform `?` presentation. It must not receive a hidden resource ID, type, name, dimensions, revision, timestamps, anchors, or relationships.

The response returns only saved traces. It does not return relationship-only rows with no trace. Every returned trace has two visible placements on the requested layer.

### Read Canonical Relationships for One Resource

```http
GET /v1/process-map/operational-relationships?company_id={company_id}&resource_type={resource_type}&resource_id={resource_id}&direction={incoming|outgoing|both}
```

The exact resource filter is required. `direction` defaults to `both`. V1 does not expose a company-wide relationship graph read.

This response returns authorized canonical operational relationships whether or not they have a saved trace. It exists for active exact-resource consumers that remain after the old `logic_gate_relationships` cutover; the Process Map layer renderer does not call it. Relationships are omitted unless the viewer can access both endpoints.

Response shape:

```json
{
  "resource_operational_relationships": [
    {
      "resource_operational_relationship_id": "...",
      "source": {
        "resource_type": "company_explorer_folder",
        "resource_id": "..."
      },
      "target": {
        "resource_type": "logic_gate",
        "resource_id": "..."
      },
      "created_timestamp": "..."
    }
  ]
}
```

This bounded relationship response contains no placement or trace geometry.

### Create or Move a Placement

```http
PUT /v1/process-map/placements/{resource_type}/{resource_id}?company_id={company_id}
```

Body:

```json
{
  "map_parent_folder_id": null,
  "grid_x": 4,
  "grid_y": 8
}
```

`map_parent_folder_id` is a Folder ID or null for root. The response is `201 Created` for a new placement or `200 OK` for an updated placement.

No client revision, dimensions, name, permission, anchor, or source payload is accepted.

### Remove a Placement

```http
DELETE /v1/process-map/placements/{resource_type}/{resource_id}?company_id={company_id}
```

Success returns `204 No Content`. This removes only map placement state and now-invalid trace geometry. It does not delete the source resource, Company Explorer state, operational relationships, or a Folder's saved interior layer.

### Create or Reuse a Relationship, With an Optional Trace

```http
POST /v1/process-map/operational-relationships
```

Relationship-only body:

```json
{
  "company_id": "...",
  "source": {
    "resource_type": "company_explorer_folder",
    "resource_id": "..."
  },
  "target": {
    "resource_type": "logic_gate",
    "resource_id": "..."
  }
}
```

Atomic draw-completion body:

```json
{
  "company_id": "...",
  "source": {
    "resource_type": "company_explorer_folder",
    "resource_id": "..."
  },
  "target": {
    "resource_type": "logic_gate",
    "resource_id": "..."
  },
  "trace": {
    "route_points": [
      { "x": 9, "y": 10 },
      { "x": 12, "y": 10 }
    ]
  }
}
```

An omitted `trace` means relationship only. A present trace with `route_points: []` means a saved direct line.

Success returns `200 OK` with the relationship, optional trace, and booleans stating which facts were created or changed. The same directed pair always resolves to one relationship.

### Create or Reroute One Trace

```http
PUT /v1/process-map/operational-relationships/{relationship_id}/trace?company_id={company_id}
```

Body:

```json
{
  "route_points": [
    { "x": 9, "y": 10 },
    { "x": 9, "y": 14 },
    { "x": 12, "y": 14 }
  ]
}
```

This endpoint accepts no source, target, anchor, layer, or endpoint coordinates. The backend loads those facts from the relationship and placements.

### Delete a Selected Trace and Its Relationship

```http
DELETE /v1/process-map/operational-relationships/{relationship_id}?company_id={company_id}
```

Success returns `204 No Content`.

The UI calls this “Delete trace.” The command deletes the canonical operational relationship and its dependent trace. It never deletes either card or placement.

There is no trace-only DELETE endpoint in V1.

### API Errors

Use the existing Mango JSON error shape and normal hidden-resource behavior.

Important stable error codes should include:

```text
invalid_process_map_resource_type
invalid_process_map_position
invalid_process_map_parent
process_map_cycle_not_allowed
process_map_root_process_not_allowed
process_map_self_relationship_not_allowed
process_map_cross_company_relationship_not_allowed
process_map_trace_endpoints_not_on_same_layer
invalid_process_map_route_points
process_map_placement_not_found
resource_operational_relationship_not_found
```

Malformed input returns `400`. A cycle or otherwise valid but forbidden state change returns `409`. Inaccessible exact resources follow Mango's normal hidden `404` behavior. Stale revisions never return a conflict because placement and trace writes are last committed save wins.

## Lazy Reads, Caching, and Realtime

The layer query must:

1. Resolve the exact root or Folder layer.
2. Reject direct access to an inaccessible Folder before reading its contents.
3. Select only placements for that exact map parent through the parent index.
4. Resolve current Folder and Logic Gate data in typed batches.
5. Resolve permissions in batches and create sanitized placeholders on the server.
6. Select only trace rows whose two relationship endpoints are visible placements in that same result layer.
7. Return no descendants and no company-wide graph.

Do not issue one database query per placement or relationship.

Start with one company-wide `workspace_read_versions` scope named `process-map`. Every Process Map mutation advances it in the same transaction. Folder or Logic Gate rename, deletion, and permission changes must also invalidate Process Map reads. Wire the scope and all relevant event mappings in both PostgreSQL schema logic and the memory read-version implementation.

The strong ETag must include the layer identity and a viewer or permission-policy fingerprint because two users can receive different visible and restricted projections for the same layer. Do not reuse the current generic ETag hash without adding that fingerprint. Direct Folder access must be authorized before an `If-None-Match` request can return `304`. Responses must not allow one user's authorized projection to be reused for another user.

Realtime messages should be invalidation hints, not copies of hidden resources or relationship payloads. The browser refetches the current layer after a relevant committed hint. The durable state change, domain event, read-version update, and realtime outbox entry must share the required transaction boundary.

## Permission Rules in the API

- Root reads require normal company access.
- A Folder-layer read requires normal access to that exact Folder.
- Placement creation, movement, and removal require Edit access to the placed resource.
- Creating or changing a placement's map parent also requires Edit access to the destination Folder.
- Relationship creation, trace creation, rerouting, and deletion require Edit access to both actual endpoints.
- A hidden card is returned only as the restricted coordinate-only placeholder.
- A hidden placeholder is never selectable, movable, openable, or connectable.
- Every trace touching a hidden endpoint is omitted.

`permissions.md` documents the agreed narrow Process Map placeholder exception alongside the general hidden-resource rule.

## Deletion, Recycle, and Restore

Add one narrow typed Process Map cleanup helper and call it from every permanent Folder and Logic Gate deletion path. Cleanup must always compare the complete `(company_id, resource_type, resource_id)` identity.

Permanent source deletion removes:

- the source's own placement;
- direct placements whose map parent is a deleted Folder;
- operational relationships with the source as either endpoint;
- dependent traces;
- no unrelated resources or relationships.

Relationship deletion cascades only to its trace. Placement deletion removes now-invalid traces explicitly and preserves operational relationships.

Recycle capture happens before live cleanup. Restore order is:

```text
Folder and Logic Gate source rows
-> operational relationships
-> Process Map placements
-> Process Map traces
```

Extend the existing recycle whitelist, capture predicates, restore order, and memory implementation. Do not create a second recycle system.

Every single-delete, batch-delete, direct Folder-delete, company-delete, retention, conversion, permanent-delete, and restore path must be audited. Passing only the main UI delete path is not enough.

## Frontend Architecture

### Page and URLs

Process Map is a full-page primary app view.

Stable browser routes:

```text
/process-map
/process-map/folders/{folder_id}
```

There is no Process child-layer route in V1.

Add one Process Map deep-link route union and route builders to the existing navigation system. Folder double-click calls the existing app navigation callback so the browser receives a real history entry. Pan, zoom, selection, and coordinates do not belong in the URL.

The page should be lazy-loaded like the existing primary pages. A saved primary tab may have an empty dashboard frame list; Process Map itself is not a frame module.

The shell integration must pass the parsed root or Folder layer into the Process Map page and update that prop on every history change. Selecting the primary page only once is not enough: Browser Back between two Folder URLs must change the displayed layer without remounting the entire app.

### Frontend Files

Small initial boundary:

```text
frontend/src/pages/process-map/ProcessMapPage.tsx
frontend/src/modules/process-map/processMapApi.ts
frontend/src/modules/process-map/ProcessMapSurface.tsx
frontend/src/modules/process-map/processMapGeometry.ts
frontend/src/modules/process-map/processMap.css
```

Keep the initial API types beside `processMapApi.ts` and the page state inside `ProcessMapPage.tsx`. Do not add a Mango-owned generic graph abstraction, generic graph store, or extra service layer before it is needed.

Required existing shell integration:

```text
frontend/src/app/deepLinkRoutes.ts
frontend/src/app/frameLayoutTypes.ts
frontend/src/app/useFramePersistence.ts
frontend/src/pages/lazyPages.ts
frontend/src/app/preloadDashboardModules.ts
frontend/src/auth/AuthGate.tsx
frontend/src/app/applayout.tsx
frontend/src/app/AppSidebarChrome.tsx
```

### Graph Library

V1 uses `@xyflow/react` 12.11.3 after checking its current official React Flow API and TypeScript contracts. No second graph, routing, or automatic-layout library is installed.

React Flow provides the parts Mango should not rebuild:

- pan and zoom;
- controlled draggable nodes;
- grid snapping;
- selection;
- handle primitives that Mango's custom cards restrict to exactly one source and one target;
- custom React card components;
- custom SVG edge components;
- connection-drawing events.

Mango still owns:

- all API and database types;
- permission sanitization;
- point-up Folder hexagons;
- Process rectangles;
- restricted placeholders;
- the fixed one-input/one-output rule;
- conversion between integer grid units and screen pixels;
- persisted route points;
- trace drawing and waypoint editing behavior;
- the white elevated two-level grid design.

Do not persist React Flow's full node, edge, or viewport JSON. Do not add ELK or another automatic-layout engine. Do not reuse the dashboard `FrameCanvas`, the global Node relationship graph, or the global Logic Gate relationship graph.

Official capability references:

- [React Flow custom nodes and grid snapping](https://reactflow.dev/examples/nodes/custom-node)
- [React Flow handles](https://reactflow.dev/learn/customization/handles)
- [React Flow custom edges](https://reactflow.dev/learn/customization/custom-edges)

### Presentation Constants

These are frontend constants and are never columns:

```text
Folder       point-up hexagon, 5 x 5 smallest grid squares
Process      rectangle,        4 x 3 smallest grid squares
Restricted   uniform rectangle, 4 x 3 smallest grid squares, containing only ?
Input        one fixed left-center anchor per accessible card
Output       one fixed right-center anchor per accessible card
Large grid   2 x 2 smallest grid squares
```

The exact screen pixel size of one smallest square is a CSS/design token. Changing that token changes rendering scale, not saved coordinates.

### Frontend Data Flow

On URL change:

1. Abort the previous layer request.
2. Request the exact new layer through an identical-read single-flight helper so development Strict Mode and concurrent consumers share one in-flight request.
3. Ignore any stale completion from the previous request.
4. Convert visible placements to typed controlled cards.
5. Convert restricted rows to a uniform noninteractive `?` card.
6. Convert returned traces to custom edges.
7. Do not preload descendants.

Minimal page state:

```text
load status and error
current layer response
selected placement or trace
local viewport
placement drag draft
trace route draft
```

Save a placement only when dragging stops, not on every pointer move. The UI may move optimistically, then use the server response as truth. On failure, restore or refetch the current layer.

Single click selects. Double-clicking an accessible Folder navigates inward. Double-clicking a Process does not open a deeper Process Map layer. Pan and zoom remain local and unsaved.

The trace renderer builds one path from the derived source output, through the ordered intermediate points, to the derived target input. Several pairwise traces may use identical leading or trailing points to look like one branched or merged route. A crossing is not a junction unless the saved traces share the same explicit point.

Items render above traces. Restricted placeholders have no handles or event handlers.

## Testing Plan

### Schema and PostgreSQL

- Exact columns, constraints, and indexes match canonical schema.
- Root permits Folders and rejects Processes.
- Missing, cross-company, and invalid typed references are rejected.
- Concurrent Folder parent writes cannot create a cycle.
- Duplicate directed relationships converge to one row.
- Reverse direction creates a separate row.
- Self and cross-company relationships are rejected.
- Endpoint updates are rejected.
- Invalid JSON route shapes and non-integer coordinates are rejected.
- Relationship deletion cascades only to its trace.
- Placement removal cleans trace geometry and preserves operational flow; reparent tests follow the policy approved before implementation.
- Revision and timestamp rules hold under last-save-wins writes.
- Recycle and restore preserve exact IDs and map state.
- Memory and PostgreSQL repositories have the same behavior.

### HTTP and Permissions

- Root and Folder reads return one layer only.
- Folder direct links enforce exact Folder access.
- Layer reads use bounded batch queries and do not call global graph reads.
- Visible cards receive current names.
- Hidden cards return only the three allowed placeholder fields.
- Hidden endpoints suppress every incident trace.
- Placement and relationship writes enforce the exact Edit rules.
- Draw completion commits relationship, trace, event, and outbox together or commits none.
- Repeating one directed relationship create does not duplicate it.
- Delete trace removes relationship plus trace and preserves both endpoints.
- ETags differ correctly across layers, users, map revisions, source names, and permission policies.

### Frontend

- `/process-map` and Folder URLs parse and build exactly.
- Browser Back returns to the previous layer.
- Route changes cancel or ignore stale reads.
- No descendant layer is prefetched.
- Grid conversion and snapping are pure and deterministic.
- Folder and Process footprints are fixed.
- Single click selects and Folder double-click navigates.
- Pan and zoom never navigate or save placement changes.
- Restricted cards render only `?`, expose no metadata, and have no interactions or handles.
- Placement saves occur on drag stop.
- Trace points render in order from the fixed output to the fixed input.
- Fan-out, fan-in, explicit shared points, and ordinary crossings render correctly.
- A failed save returns the UI to server truth.
- New pure and component tests are added to `tests/frontend/config/tsconfig.node-tests.json` and the explicit lists in `tests/frontend/scripts/run-node-relationship-tests.mjs`.

### Required Targeted Verification

This task's verification gate is proportionate WSL backend tests, the frontend build and focused frontend tests, plus disposable PostgreSQL schema, migration, and repository validation.

Verified results:

- WSL `/usr/local/go/bin/go test ./internal/store ./internal/http -count=1`: passed; Store 5.039 seconds and HTTP 15.142 seconds.
- From `frontend`, `npm.cmd run build`: passed with 537 modules; only the existing chunk-size warning remained.
- From `frontend`, `npm.cmd run test:node-relationships`: passed the complete established frontend feature-test list, including the rendered Process Map surface.
- From `frontend`, `node node_modules/typescript/bin/tsc -p ..\tests\frontend\config\tsconfig.node-tests.json`: passed.
- From the repository root, the focused `node --test --test-isolation=none --test-force-exit` Process Map, deep-link, preload, and realtime list: passed 48/48.
- `node tests\frontend\scripts\run-node-relationship-tests.contract.test.mjs`: passed 1/1.
- The expanded focused frontend list passed 56/56, and the separately rendered interaction test passed 1/1.
- Disposable PostgreSQL validation passed for a clean canonical schema apply; the `cda21f5a` schema plus one seeded old edge followed by `20260824_process_map.sql`; exact ID, direction, and timestamp preservation; old-authority removal; bounded route validation; source cleanup; and cycle rejection. The final migration rerun preserved relationship ID `44444444-4444-4444-4444-444444444444`, its source-to-target direction, and `2026-02-03 04:05:06 UTC` timestamp while removing the old table and enum.
- The guarded env-backed PostgreSQL command `/usr/local/go/bin/go test ./internal/store -run '^(TestPostgresProcessMapRepositoryLifecycle|TestPostgresCompanyMembershipProcessMapInvalidationLifecycle|TestPostgresPendingInvitationDowngradeInvalidatesGlobalDevAdmin|TestPostgresPermissionValidationFenceSerializesRevocations|TestPostgresCompanyExplorerMutationsAuthorizeExactSourceAndDestination)$' -count=1 -v` passed all five real-database scenarios in 13.687 seconds.

## Delivery Plan and Progress

### Phase 0: Contract and Planning

- [x] Agree on Process Map hierarchy versus operational flow.
- [x] Agree on manual placement and one-layer lazy loading.
- [x] Agree on Folder and Process card types and dimensions.
- [x] Agree on restricted placeholders.
- [x] Agree on three table names and responsibilities.
- [x] Agree on four allowed directed relationship type pairs.
- [x] Agree on one fixed input and one fixed output.
- [x] Agree on JSONB route points and no bend table.
- [x] Record Process Map laws.
- [x] Record relationship laws.
- [x] Verify the old development relationship table through read-only access.
- [x] Record the initial SQL, backend API, and frontend architecture in this ledger.
- [x] Resolve the remaining UI and input-limit decisions below.
- [x] Add the Process Map permission exception to `permissions.md`.
- [x] Revise REST/WebSocket Law RW61 so it keeps the removed maps retired while permitting only the new Process Map API, read-version scope, and safe realtime event.

### Phase 1: Database and Old-Authority Cutover

- [x] Add migration preflight for old Process-to-Process relationships.
- [x] Create the three new tables, constraints, indexes, and narrow validators.
- [x] Migrate any old relationship rows with exact IDs and timestamps.
- [x] Cut all old relationship readers and writers to the new authority.
- [x] Remove the old table, enum, API, types, events, caches, and tests.
- [x] Add PostgreSQL and memory repository behavior.
- [x] Add typed deletion and recycle/restore integration.
- [x] Finish schema, concurrency, deletion, and restore tests.

This phase must leave one working operational relationship authority. It must not leave a half-cut dual system.

### Phase 2: Small Working Placement Map

- [x] Add root and exact Folder-layer backend reads.
- [x] Add server-side permission sanitization and ETags.
- [x] Add placement create, move, reparent, and remove commands.
- [x] Add the full-page Process Map route and lazy page.
- [x] Render the white two-level grid.
- [x] Render fixed Folder, Process, and restricted cards.
- [x] Add snapped dragging and server persistence.
- [x] Add Folder double-click URLs and browser history.
- [x] Prove that only one layer loads.

At the end of this phase, Process Map must be a usable placement product even before trace editing is added.

### Phase 3: Operational Traces

- [x] Add atomic relationship-plus-trace creation.
- [x] Add custom fixed input and output handles.
- [x] Add saved route rendering and rerouting.
- [x] Add fan-out and fan-in through shared route points.
- [x] Add selected-trace deletion through relationship deletion.
- [x] Add permission suppression and atomic-failure tests.

### Phase 4: Lifecycle and Production Hardening

- [x] Complete every delete, conversion, recycle, restore, retention, and company cleanup audit.
- [x] Complete realtime invalidation and viewer-safe ETags.
- [x] Add production-shaped lazy-query and payload-bound tests.
- [x] Run the required WSL backend, frontend build/focused, and disposable PostgreSQL schema/migration checks.
- [x] Run the final guarded disposable PostgreSQL repository integration test.
- [x] Update this ledger with implementation files, migration name, test results, and rollout status.

## Resolved V1 Decisions

1. Input is fixed at the left center and output is fixed at the right center; the point-up Folder hexagon uses its leftmost and rightmost points.
2. Every restricted placeholder is the same fixed four-by-three rectangle as a Process.
3. Manual add uses the existing exact-resource Company Explorer drag payload. V1 has no candidate-search API.
4. One route has at most 256 intermediate points, and every point contains exactly signed integer `x` and `y` values.
5. The editor uses orthogonal circuit-style routing where practical while keeping route points as one simple bounded value.
6. The smallest grid-square pixel size and white elevated-surface styling are frontend presentation constants and are not persisted.
7. Placement overlap is allowed in V1; no automatic collision repair or layout runs.
8. Reparenting a placement removes now-invalid incident trace geometry and preserves operational relationships.
9. Redrawing the same semantic edge with different points replaces its trace. An identical retry returns existing state without a duplicate or revision change.

## Definition of Done

Process Map V1 is done only when:

- the three tables are the only live Process Map authorities;
- the old Logic Gate relationship authority is gone;
- root and Folder URLs load exactly one authorized layer;
- manual placement and snapped movement persist;
- drawing a trace atomically creates or reuses its operational relationship and saves its route;
- fan-out and fan-in work through pairwise traces with shared points;
- restricted placeholders leak only existence and position;
- delete, recycle, restore, realtime, and ETag behavior is complete;
- PostgreSQL and memory implementations agree;
- the required targeted backend, frontend, and disposable PostgreSQL verification passes;
- the numbered business-law documents match the shipped behavior.

## Shipped Implementation Files

Canonical database change:

```text
backend/db/schema.sql
backend/db/migrations/20260824_process_map.sql
```

Canonical backend feature files:

```text
backend/internal/domain/process_map.go
backend/internal/store/process_map.go
backend/internal/store/postgres_process_map.go
backend/internal/store/memory_process_map.go
backend/internal/http/process_map_handlers.go
```

Backend integration files:

```text
backend/internal/store/repository.go
backend/internal/http/server.go
backend/internal/store/workspace_read_versions.go
backend/internal/store/realtime_producer_events.go
backend/internal/store/postgres_domain_events.go
backend/internal/store/memory_domain_events.go
backend/internal/store/postgres_recycle_bin.go
backend/internal/store/memory_recycle_bin.go
backend/internal/http/realtime_ws.go
```

Canonical frontend files:

```text
frontend/src/pages/process-map/ProcessMapPage.tsx
frontend/src/modules/process-map/ProcessMapSurface.tsx
frontend/src/modules/process-map/processMapApi.ts
frontend/src/modules/process-map/processMapGeometry.ts
frontend/src/modules/process-map/processMapInteraction.ts
frontend/src/modules/process-map/processMap.css
```

Shell, Company Explorer drag, and realtime integration uses the existing app files in `frontend/src/app`, `frontend/src/auth`, `frontend/src/modules/company-explorer`, `frontend/src/modules/realtime`, and `frontend/src/pages/lazyPages.ts`. `frontend/package.json` and `frontend/package-lock.json` pin `@xyflow/react` 12.11.3.

Focused feature tests:

```text
backend/internal/http/process_map_handlers_test.go
backend/internal/store/memory_process_map_test.go
backend/internal/store/postgres_process_map_integration_test.go
backend/internal/store/process_map_repository_contract_test.go
backend/internal/store/process_map_realtime_test.go
tests/frontend/modules/process-map/processMapGeometry.test.ts
tests/frontend/modules/process-map/processMapApi.test.ts
tests/frontend/modules/process-map/processMapInteraction.test.ts
tests/frontend/modules/process-map/processMapContract.test.ts
tests/frontend/modules/process-map/processMapSurface.test.tsx
```

The old `backend/internal/http/logic_gate_relationship_handlers.go` and `frontend/src/modules/logic-gates/logicGateRelationshipGraph.ts` paths are removed.

## Rollout State

- Existing PostgreSQL databases require `backend/db/migrations/20260824_process_map.sql` through the reviewed migration workflow.
- No live database was modified by this implementation task.
- The final guarded disposable repository run passed. No merge, push, or production rollout has occurred.

Last updated: August 24, 2026
