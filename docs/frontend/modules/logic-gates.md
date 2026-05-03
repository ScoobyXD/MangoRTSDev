# Logic Gate Map Module

Status update (2026-05-03): new workspaces should use the unified `Map` module instead of adding a separate Logic Gate Map module. The implementation below remains as the logic-gate rendering/persistence path behind that unified map and as a compatibility path for saved `logic-map` frames.

## Purpose
Logic Gate Map is the dedicated visual workspace for creating and connecting `logic_gates`.

It intentionally mirrors Node Map interaction patterns so users do not learn a second canvas model:
- create logic gates on the canvas,
- create linked logic gates with `+` side controls on the left and right sides,
- connect existing gates with relationship side controls,
- drag, resize, pan, zoom, multi-select, and delete gates or relationship lines,
- link selection context into Company Explorer and Editor.

## Backend/API Contract
Logic Gate Map is API-first so future headless agents can perform the same workflows as the UI.

Endpoints used:
- `GET /v1/workspace/snapshot?company_id=...`
  - returns `logic_gates` and `logic_gate_relationships` in the bulk hot-path snapshot.
- `GET /v1/logic-gates?company_id=...`
- `POST /v1/logic-gates`
  - payload: `{ company_id, header }`
- `GET /v1/logic-gates/:logic_gate_id?company_id=...`
- `PUT /v1/logic-gates/:logic_gate_id`
  - payload: `{ company_id, header }`
- `DELETE /v1/logic-gates/:logic_gate_id?company_id=...`
- `POST /v1/logic-gates/:logic_gate_id/information`
  - payload: `{ company_id, type, information, information_id? }`
  - `information` must contain non-whitespace text; blank editor blurs are rejected by the API and DB guard.
- `GET /v1/logic-gate-relationships?company_id=...`
- `POST /v1/logic-gate-relationships`
  - payload: `{ company_id, logic_gate_id_a, logic_gate_id_b, a_position, b_position }`
- `DELETE /v1/logic-gate-relationships/:logic_gate_relationship_id?company_id=...`
- `GET/POST /v1/company-explorer/folders`
  - `folder_kind` must be `logic_gate` for Logic Gate Map organization.
- `PUT /v1/company-explorer/folders/:folder_id`
  - moves a logic-gate folder under another compatible folder or back to the Logic Gates root.
- `GET/POST/DELETE /v1/company-explorer/folder-items`
  - `item_type` must be `logic_gate` when moving gates into explorer folders.
- `GET /v1/map-layout?company_id=...&map_type=logic_gate`
  - reads canonical shared logic-gate canvas positions.
- `PUT /v1/map-layout`
  - bulk upserts changed logic-gate positions with `{ company_id, map_type: "logic_gate", positions: [{ entity_id, x, y }] }`.

`DELETE /v1/logic-gates/:logic_gate_id` also removes Kanban card placements for
that gate and clears operation pointers while preserving operation history. This
keeps the same command safe for UI users and headless agents.

## Relationship Semantics
Logic gate relationships are not parent/child/peer.

The only valid positions are:
- `Input`
- `Output`

The only valid row pairs are:
- `Input -> Output`
- `Output -> Input`

Self-relationships are rejected.

Side convention:
- `left` is the only `Input` port.
- `top`, `right`, and `bottom` are `Output` ports.
- New linked gates and relationship drafts can only start from `left` or `right`.
- During an active relationship draft, an input source can attach to `top`, `right`, or `bottom` output sides.
- During an active relationship draft, an output source can attach only to the target `left` input side.

Junior engineer note:
- The source gate is always written as `logic_gate_id_a`.
- The target gate is always written as `logic_gate_id_b`.
- `a_position` is decided from the target side.
- `b_position` is decided from the source side.

## Hot Path Behavior
Logic Gate Map follows the latency architecture rules:
- initial graph load comes from one bulk workspace snapshot,
- the workspace snapshot includes `logic_gate_map_positions` for one hot read,
- local create/update/delete operations apply optimistic graph-cache updates,
- SSE deltas converge the cache without polling loops,
- unchanged snapshot responses use ETag/304,
- visible gate rendering uses the same viewport culling strategy as Node Map,
- the visual background uses the shared repeated SVG plus-grid, which adapts tile size by zoom without creating per-cell DOM,
- the major plus layer is aligned to the minor grid axes so scale cues stay readable during pan and zoom,
- layout geometry is a backend projection in `logic_gate_map_positions`; browser storage keeps only small viewport/selection cache data.
- Company Explorer folder selection filters the cached snapshot in memory. A selected folder includes descendant folders, and relationship lines render only when both gates are inside that active scope.
- Selecting an individual gate from inside a Company Explorer folder keeps that folder scope active while selecting the gate.
- New logic gates created while a folder scope is active are assigned to that folder through the folder-items API.

Junior engineer note:
- A position update is not a new logic-gate relationship and does not change gate semantics.
- It is a shared UI projection row keyed by `(company_id, logic_gate_id)` so agents and browsers can coordinate on the same layout through APIs.

## Linking Behavior
Frame linking uses the existing `frame-module-links-v1` graph. New frames use the unified `map` kind; legacy saved layouts may still use `logic-map`.

Linked behavior:
- Logic Gate Map publishes `mangoos:logic-gate-map-selection-updated`.
- Company Explorer shows real logic gates under the Logic Gates tree and can drive linked Logic Gate Map selection.
- Editor follows linked Logic Gate Map selection and labels the header `Logic Gate:` instead of `Node:`.
- When the unified Map receives logic-gate Explorer context, it renders this logic-gate path and writes `logic-gate-map-state-v1:<companyID>:<mapWidgetID>` using the same frame ID.
- Linked Company Explorer treats `selectedLogicGateID`/`selectedNodeID` in the selection event as fresher than debounced `logic-gate-map-state-v1:*` storage. Storage is used only when a gap-recovery event lacks an entity payload, which keeps Explorer selection stable after Explorer-driven map updates.
- Logic Gate Map tags Explorer-caused selection events with `sourceExplorerID`; the originating Explorer ignores those self-echoes, while real map clicks and other explorers still propagate. Empty Explorer context clears logic-gate folder scope and selection instead of preserving a previous child gate.

## File Ownership
Primary files:
- `frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx`
- `frontend/src/modules/logic-gate-map/LogicGateRelationshipGraph.ts`
- `frontend/src/modules/logic-gate-map/relationshipProjection.ts`
- `frontend/src/modules/logic-gate-map/shared.ts`
- `frontend/src/modules/logic-gate-map/LogicGateRecordStore.ts`
