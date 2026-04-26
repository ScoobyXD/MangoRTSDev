# Nodes Module (Frontend) — Feature Documentation

This document captures the full behavior and implementation details currently present in the **Nodes** family of modules loaded inside dashboard **frames** (UI containers):

- **Node Map** (`nodes-map`, legacy `nodes`)
- **Node Doc** (`node-doc`)

Implementation is now organized under:

- `frontend/src/modules/node-map/NodesContent.tsx`
- `frontend/src/modules/node-map/shared.ts` (shared types/constants/helpers)

---

## 1) Purpose

The Nodes modules provide a visual “canvas-inside-canvas” experience plus linked node documentation inside dashboard widgets where users can:

- create and delete nodes,
- create directional relationships from side handles,
- drag nodes on a fine grid,
- zoom and pan across a larger virtual node world,
- box-select multiple nodes,
- view relationship lines between nodes,
- add node information records,
- and keep node layout/view state persisted locally.
- link a Node Map module to a Node Doc module,
- and edit text-box notes in Node Doc that attach to whichever node is currently selected in the linked Node Map.

### Terminology (authoritative)

- **Node**: the node box/card UI element.
- **Relationship line**: the literal line UI element connecting two nodes on the canvas.
- **Relationship**: the parent/child/peer data relationship represented by a `node_relationships` row.

---

## 2) API contracts used by the module

Base values are read from:

- `VITE_API_BASE_URL` (default `http://localhost:8080`)
- `VITE_COMPANY_ID` (default `11111111-1111-1111-1111-111111111111`)

### Endpoints used

- `GET /v1/nodes?company_id=...`
  - loads the nodes list.
- `GET /v1/nodes/:node_id?company_id=...`
  - loads node details (relationships + information) for one node.
- `POST /v1/nodes`
  - creates a node with `{ company_id, header }`.
- `DELETE /v1/nodes/:node_id?company_id=...`
  - deletes selected node.
- `POST /v1/node-relationships`
  - creates relationship with `{ company_id, node_id_a, node_id_b, a_position, b_position }`.
- `DELETE /v1/node-relationships/:node_relationship_id?company_id=...`
  - deletes a relationship by id.
- `POST /v1/nodes/:node_id/information`
  - adds info item with `{ company_id, type, information }`.

### Error handling

All HTTP calls go through a shared `requestJSON` helper:

- Sets `Content-Type: application/json`.
- On non-2xx responses, surfaces backend `error` when available.
- Handles `204` with empty object return.

---

## 3) Canvas model and rendering

### Coordinate spaces

The module uses a virtual world and a viewport:

- **World size**: `WORLD_W = 3200`, `WORLD_H = 2200`
- **Viewport**: container inside widget (`minHeight: 560`)

Nodes are positioned in **world coordinates**, while pan/zoom transform the world into viewport screen space.

### Grid

- Fine grid step: `MINI_GRID = 12`
- Grid-snap applied to node movement and placement via `snapToGrid(...)`.

### Node card sizing

- `NODE_W = 148`
- `NODE_H = 96`

---

## 4) Interaction model

### 4.1 Panning

- Pointer down on blank canvas starts pan drag.
- Pointer move updates `pan` from drag delta.
- Pointer up ends panning.

### 4.2 Zooming

- Mouse wheel:
  - wheel up => zoom in
  - wheel down => zoom out
- Zoom clamped to `[0.45, 2.7]`.
- Zoom is cursor-centered (keeps world-under-cursor stable while zooming).

### 4.3 Node drag

- Dragging a node moves selected node(s).
- Positions are clamped to world bounds.
- Positions are snapped to grid.

### 4.4 Multi-select

- `Shift + drag` **or** `Ctrl + drag` on canvas creates marquee selection box.
- Nodes intersecting the box become selected.
- `Shift + click` **or** `Ctrl + click` on node cards toggles nodes in/out of the current selection set.
- `Shift + drag` over an existing multi-selection now adds newly boxed nodes/relationship lines into the current selection set (additive marquee) instead of replacing the existing batch.
- Visual indicators:
  - selected border/outline/glow,
  - selected dot marker on card,
  - “Group selected: N” badge for multi-select.
- Clicking blank canvas clears group selection.

---

## 5) Relationship creation rules

The primary selected node card shows **two controls per side**:

- `+` icon keeps the existing behavior: create a new linked node off that side.
- Arrow-line icon handles direct relationship creation between existing nodes.

- Top icon arrow points up.
- Right icon arrow points right.
- Bottom icon arrow points down.
- Left icon arrow points left.

Relationship creation uses a two-click attach flow between existing nodes:

1. Click a side handle on the source node.
2. A trace line is shown from source side to cursor.
   - The draft trace uses the same obstacle-aware orthogonal router as persisted relationship lines, so it follows mini-grid lanes and wraps around node cards while the cursor moves.
3. All node relationship-side icons switch into a **receive icon** state while drafting.
4. Click a side receive icon on the target node.
5. The module writes one relationship row.

Illegal relationship-side pairs are rejected before write:

- Source `left`/`right` (peer) can only attach to target `left`/`right` (peer).
- Source `top` can only attach to target `bottom`.
- Source `bottom` can only attach to target `top`.
- Illegal target sides are visually de-emphasized while drafting and do not write DB rows.

### Position mapping currently used when creating relationship records

Source node is always `node_id_a`, target node is always `node_id_b`.

#### Existing-node attach flow (arrow icon)

Role write semantics are source-side driven (same vertical contract as `+` creation):

- Source side `top` -> write `(a_position=Child, b_position=Parent)`.
- Source side `bottom` -> write `(a_position=Parent, b_position=Child)`.
- Source side `left` / `right` -> write `(a_position=Peer, b_position=Peer)`.

The target click side is still captured for anchor routing (`anchor.to`) but does not flip role semantics.

#### `+` linked-node creation flow (create a new node from one side)

For `+` creation, the target node is spawned on the opposite side, but vertical role writes are intentionally normalized so selected-node relationship coloring is correct for both nodes:

- Source side `top` -> write `(a_position=Child, b_position=Parent)` and anchor `(from=top, to=bottom)`.
- Source side `bottom` -> write `(a_position=Parent, b_position=Child)` and anchor `(from=bottom, to=top)`.
- Source side `left` -> write `(Peer, Peer)` with `(from=left, to=right)`.
- Source side `right` -> write `(Peer, Peer)` with `(from=right, to=left)`.

This replaces the old incorrect vertical swap behavior.

### Relationship deletion

- Relationship rows are removable from the details panel via **Snip**.
- Relationship lines can also be selected directly on canvas by clicking the line path (multi-select with `Shift`/`Ctrl` + click).
- Relationship lines are included in marquee selection (`Shift`/`Ctrl` + drag) so line-only and mixed node+line group selection works with the same drag gesture family used for nodes.
- Relationship lines can be snipped directly on-canvas via line **double-click**.
- Keyboard `Delete` / `Backspace` deletes selected relationships.
- When a mixed selection includes both nodes and relationship lines, one delete confirmation now covers both so nodes are not left behind after line deletion.
- Right-clicking a relationship line opens a relationship context menu with **Delete relationship** (or plural delete when a selected line group is active).
- Deletes call `DELETE /v1/node-relationships/:node_relationship_id`.
- Relationship-line delete operations remove only relationship rows; connected nodes remain intact.

---

## 6) Relationship line rendering

Relationships are rendered on a world-space `<canvas>` for performance, with a lightweight SVG hit layer for direct relationship line selection.

### Anchor behavior

- A relationship remembers creation-side anchors when created in-session.
- If no remembered anchor exists, anchor side is inferred via a shared projection helper:
  - `(a=Child, b=Parent)` -> `top -> bottom`
  - `(a=Parent, b=Child)` -> `bottom -> top`
  - peer links fall back to geometry-based horizontal/vertical inference.
- Anchor and role inference now live in `frontend/src/modules/node-map/relationshipProjection.ts` to avoid duplicated/contradictory logic in render and write paths.

### Routing behavior

- Polyline routes are orthogonal and grid-snapped.
- Lines originate from side anchors that correspond to `+` side conventions.
- Routing now uses obstacle-aware orthogonal pathing on the mini-grid so relationship lines remain continuous and do not visually cut through node cards when nodes are moved.
- Draft relationship traces now use that same routing engine during pointer-move previews, preventing temporary straight-line previews that diverge from final saved path behavior.
- Connector paths are simplified after routing to keep turns clean while preserving continuous end-to-end segments.
- Optional relationship role coloring can be toggled on; when active, lines connected to the active selected node (single-selection focus) are color-coded by the opposite-side role field in the row (`node_id_a` uses `b_position`, `node_id_b` uses `a_position`) so visual direction reflects the connected side relative to the selected node.
- Visual rendering sits under node cards, and a transparent hit layer enables selection without degrading line draw performance.

---

## 6.1 Relationship projection helper (phase 1/2 hardening)

`relationshipProjection.ts` is now the single semantic source for:

- side -> role mapping,
- linked-node payload generation for `+`,
- existing-node attach payload generation,
- selected-node role resolution,
- anchor inference,
- projected visual relationship line metadata (`sourceNodeID`, `targetNodeID`, `sourceAnchor`, `targetAnchor`, `selectedRole`, `strokeColor`, `alpha`).

The projection object is **derived in memory** during render. It is not persisted to PostgreSQL and is not added to the workspace snapshot API payload.

---

## 7) Data loading strategy

- `loadNodes()` loads all nodes.
- `loadDetails(selectedNodeID)` loads details panel data for one selected node.
- `loadGraphRelationships(nodes)` reuses workspace snapshot relationship payloads filtered to currently loaded nodes.
- Workspace snapshot streaming/delta handling in `workspaceStore.ts` uses a single `WorkspaceStreamEnvelope` contract type for event application.
- Relationship-create writes between existing nodes are executed through one internal helper path (`commitRelationshipBetweenNodes`) to avoid duplicate declaration/runtime drift in the canvas module.

---

## 7.1 Tests for relationship semantics

### Files under test

- `frontend/src/modules/node-map/relationshipProjection.ts`

### Test file

- `frontend/src/modules/node-map/relationshipProjection.test.ts`

### Available tests in that file

1. maps side to relationship role for direct links
2. maps plus-link top/bottom to correct parent-child semantics
3. keeps peer semantics for plus-link left/right
4. uses source-side semantics for existing-node relationship writes
5. enforces illegal side-pair rules for existing-node relationship drafts
6. resolves selected role from the opposite-side position field
7. infers deterministic anchor for parent-child and child-parent rows
8. projects visual relationship line metadata without persistent storage

### How to run

From `frontend/`:

```bash
npm run test:node-relationships
```

What the command does:

1. Compiles only the node-relationship projection test targets with `tsc -p tsconfig.node-tests.json`.
2. Runs Node’s built-in test runner against the emitted JS test file in `.test-dist/`.

---

## 8) Local persistence (layout + viewport)

The module persists canvas state in `localStorage` keyed per company and frame scope:

- Key format: `node-map-state-v1:<companyID>:<frameId-or-global>`
- Stored fields:
  - `zoom`
  - `pan`
  - `selectedNodeID`
  - `nodePositions`

### Restore behavior

On mount:

- Attempt to restore saved state.
- Sanitize/clamp values.
- If no saved viewport exists, center the world once as fallback.

### Save behavior

Whenever restored state is active, writes latest `{ zoom, pan, selectedNodeID, nodePositions }` back to localStorage.

This keeps layout and viewport stable when switching views and reopening the module.

---

## 9) Node Doc module (linked documentation surface)

`NodeDocContent` is a blank document-like canvas that creates movable text boxes and stores their contents as `Text box` records in `node_information`.

### 9.1 Linking model

- Node Doc/Editor linkage is resolved from the frame-link graph:
  - graph key: `frame-module-links-v1`
  - frame registry key: `frame-module-registry-v1`
  - resolution rule: traverse linked frames and select nearest frame whose kind resolves to Node Map (`nodes-map`/`nodes`).
- Linking is triggered from module context menu action:
  - `Link modules: <dynamic titles joined by " + ">`
- Linked modules show a **hexagon indicator** next to the module name chip in the frame header (both Node Map and Node Doc).
- Link action supports pairwise graph edges across linkable module kinds (map/editor/explorer/logic-map).

### 9.2 Module multi-select behavior (for linking)

- Widget/module selection is additive with `Shift + click` or `Ctrl + click`.
- Right-click on an already-selected module preserves the multi-selection.
- Selection capture runs in pointer capture phase to avoid nested module interactions dropping selection.

### 9.3 Selected-node sync

Once linked, Node Doc/Editor reads selected-node context from linked map state key:

- `node-map-state-v1:<companyID>:<linkedCanvasWidgetId>`

and reads `selectedNodeID`. That selected node becomes the active storage target for Node Doc.

Selection notifications are event-driven (`EVENT_NODE_MAP_SELECTION_UPDATED`) and only emit on semantic selected-node changes (not on pan/zoom/drag geometry churn).

### 9.4 Node Doc persistence behavior

- Load:
  - `GET /v1/nodes/:node_id?company_id=...`
  - parse `information` rows where `type === "Text box"`
  - keep latest record per `local_id` by timestamp order
- Save:
  - `POST /v1/nodes/:node_id/information`
  - payload stores JSON `{ local_id, x, y, text }` as `information`
- UI states:
  - if not linked: prompt user to link modules
  - if linked but no selected node: prompt user to select a node in linked Node Map
  - if linked and node selected: show linked node header + information summary at top of Node Doc

---

## 10) Controls and panels in module UI

### Node Map main surface

- Canvas consumes almost all remaining widget height (bottom utility rows removed).
- World grid, relationship lines, node cards, side arrow actions, selection box, and group badge.
- In-canvas instruction text.
- Right-click context menu with `Create new node` at cursor location.
- Right-click context menu also includes `Enable relationship colors` with an explicit iOS-style on/off slider (knob left = off, knob right = on).
- A top-right status badge surfaces relationship-line delete progress and failure reasons so delete operations are observable even when the details panel is closed.
- Right-click menu rows use left-aligned text and box-style row containers.
- This menu uses the default **Boxy Hierarchical** list style.
- Relationship role color options (`Parent`, `Peer`, `Child`) are shown directly under `Enable relationship colors` as nested controls with stronger right indentation.
- Nested role rows use Boxy Hierarchical styling: child rows are indented and boxed under the parent relationship row.
- No triangle expand/collapse indicators or decorative connector lines are used in this right-click hierarchy presentation.
- Box rows are stacked flush with no vertical gaps between adjacent rows.
- Role color pickers (`Parent`, `Peer`, `Child`) use RGB hex color inputs.
- Canvas context menu placement is clamped within the viewport so all actions stay visible near canvas edges.
- Right-click on a node opens node actions (`Edit node`, `Delete node`).
- Delete key support for selected node(s), guarded by themed confirmation modal.

### Node Map right overlay details panel

- Double-clicking a node opens a translucent “glass” panel anchored to the right side.
- Panel can be dragged and resized.
- Panel contains:
  - add information controls,
  - delete node action,
  - relationships list,
  - information list,
  - loading/error feedback.

---

### Node Doc surface

- Top-left module label (`Node Doc`).
- Blank document area with no extra dashboard chrome inside the module body.
- Typing creates a text box when none is active.
- Double-clicking in blank space creates a new empty text box.
- Text boxes are movable and resizable from all edges/corners.
- Text boxes persist position, size, and content to the selected linked node.

---

## 11) Teal theme update

App-level `teal` colorway currently uses:

- `color: #00d5ff` (RGB `0, 213, 255`)
- `accent: #006f85`
- `text/tagBg: #042028`

This is the requested teal update used by teal-themed modules.

---

## 12) Known scope notes

- Node layout persistence is frontend-local (browser localStorage), not backend-persisted.
- Relationship anchor memory for side-origin is strongest for in-session-created links; fallback inference handles existing links.
- Graph relationship loading currently calls per-node details and deduplicates results in frontend.

---

## 13) File ownership (current implementation)

Primary implementation is in:

- `frontend/src/modules/node-map/NodesContent.tsx` (Node Map behavior)
- `frontend/src/modules/editor/EditorContent.tsx` (Node Doc behavior)
- `frontend/src/modules/node-map/shared.ts` (shared node types/constants/helpers)
- `frontend/src/app/applayout.tsx` (frame/menu integration and link action wiring)
