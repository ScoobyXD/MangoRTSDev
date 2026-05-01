# Logic Gate Map Module

## Purpose
Logic Gate Map is the dedicated visual workspace for creating and connecting `logic_gates`.

It intentionally mirrors Node Map interaction patterns so users do not learn a second canvas model:
- create logic gates on the canvas,
- create linked logic gates with `+` side controls,
- connect existing gates with arrow side controls,
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
- `left` and `top` are `Input` ports.
- `right` and `bottom` are `Output` ports.

Junior engineer note:
- The source gate is always written as `logic_gate_id_a`.
- The target gate is always written as `logic_gate_id_b`.
- `a_position` is decided from the target side.
- `b_position` is decided from the source side.

## Hot Path Behavior
Logic Gate Map follows the latency architecture rules:
- initial graph load comes from one bulk workspace snapshot,
- local create/update/delete operations apply optimistic graph-cache updates,
- SSE deltas converge the cache without polling loops,
- unchanged snapshot responses use ETag/304,
- visible gate rendering uses the same viewport culling strategy as Node Map,
- layout geometry stays local to the browser and does not enter the hot backend path.

## Linking Behavior
Frame linking uses the existing `frame-module-links-v1` graph and `logic-map` frame kind.

Linked behavior:
- Logic Gate Map publishes `mangoos:logic-gate-map-selection-updated`.
- Company Explorer shows real logic gates under the Logic Gates tree and can drive linked Logic Gate Map selection.
- Editor follows linked Logic Gate Map selection and labels the header `Logic Gate:` instead of `Node:`.

## File Ownership
Primary files:
- `frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx`
- `frontend/src/modules/logic-gate-map/LogicGateRelationshipGraph.ts`
- `frontend/src/modules/logic-gate-map/relationshipProjection.ts`
- `frontend/src/modules/logic-gate-map/shared.ts`
- `frontend/src/modules/logic-gate-map/LogicGateRecordStore.ts`
