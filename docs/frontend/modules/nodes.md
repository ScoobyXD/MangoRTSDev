# Nodes Module (Frontend) — Feature Documentation

This document captures the full behavior and implementation details currently present in the **Nodes** family of modules loaded inside dashboard **frames** (UI containers):

- **Node Canvas** (`nodes-canvas`, legacy `nodes`)
- **Node Doc** (`node-doc`)

Implementation is now organized under:

- `frontend/src/modules/node/canvas/NodesContent.tsx`
- `frontend/src/modules/node/shared.ts` (shared types/constants/helpers)

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
- link a Node Canvas module to a Node Doc module,
- and edit text-box notes in Node Doc that attach to whichever node is currently selected in the linked Node Canvas.

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
3. All node relationship-side icons switch into a **receive icon** state while drafting.
4. Click a side receive icon on the target node.
5. The module writes one relationship row.

### Position mapping currently used when creating relationship records

Source node is always `node_id_a`, target node is always `node_id_b`.

- Side `left` / `right` maps to position `Peer`.
- Side `top` maps to position `Parent`.
- Side `bottom` maps to position `Child`.

`a_position` is derived from the source side and `b_position` from the target side, so relationship semantics preserve exactly which sides were clicked.

For `+` linked-node creation, the new node is attached on the **opposite side** of the source handle, and positions are derived from the same side-to-position mapping (no parent/child inversion patching).

### Relationship deletion

- Relationship rows are removable from the details panel via **Snip**.
- Relationship lines can also be selected directly on canvas by clicking the line path (multi-select with `Shift`/`Ctrl` + click).
- Keyboard `Delete` / `Backspace` deletes selected relationships.
- Deletes call `DELETE /v1/node-relationships/:node_relationship_id`.

---

## 6) Relationship line rendering

Relationships are rendered on a world-space `<canvas>` for performance, with a lightweight SVG hit layer for direct relationship line selection.

### Anchor behavior

- A relationship remembers creation-side anchors when created in-session.
- If no remembered anchor exists, anchor side is inferred from relationship positions and current geometry.
- On restored sessions, parent/child anchors are geometry-validated so lines do not route from the wrong side after refresh.

### Routing behavior

- Polyline routes are orthogonal and grid-snapped.
- Lines originate from side anchors that correspond to `+` side conventions.
- Routing now uses obstacle-aware orthogonal pathing on the mini-grid so relationship lines remain continuous and do not visually cut through node cards when nodes are moved.
- Connector paths are simplified after routing to keep turns clean while preserving continuous end-to-end segments.
- Optional relationship role coloring can be toggled on; when active, lines connected to the active selected node (single-selection focus) are color-coded by that node’s role in the relationship (`Parent`, `Peer`, `Child`) while non-selected links are dimmed.
- Visual rendering sits under node cards, and a transparent hit layer enables selection without degrading line draw performance.

---

## 7) Data loading strategy

- `loadNodes()` loads all nodes.
- `loadDetails(selectedNodeID)` loads details panel data for one selected node.
- `loadGraphRelationships(nodes)` reuses workspace snapshot relationship payloads filtered to currently loaded nodes.
- Workspace snapshot streaming/delta handling in `workspaceStore.ts` uses a single `WorkspaceStreamEnvelope` contract type for event application.
- Relationship-create writes between existing nodes are executed through one internal helper path (`commitRelationshipBetweenNodes`) to avoid duplicate declaration/runtime drift in the canvas module.

---

## 8) Local persistence (layout + viewport)

The module persists canvas state in `localStorage` keyed per company and frame scope:

- Key format: `node-canvas-state-v3:<companyID>:<frameId-or-global>`
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

- Node Doc is linked to Node Canvas at frame level using:
  - localStorage key: `node-doc-widget-links-v1`
  - value: map of `nodeDocFrameId -> nodeCanvasFrameId`
- Linking is triggered from module context menu action:
  - `Link nodes: <dynamic titles joined by " + ">`
- Linked modules show a **hexagon indicator** next to the module name chip in the frame header (both Node Canvas and Node Doc).
- Link action is enabled when selection contains exactly:
  - one Node Canvas module (`nodes-canvas` or legacy `nodes`)
  - one Node Doc module (`node-doc`)

### 9.2 Module multi-select behavior (for linking)

- Widget/module selection is additive with `Shift + click` or `Ctrl + click`.
- Right-click on an already-selected module preserves the multi-selection.
- Selection capture runs in pointer capture phase to avoid nested module interactions dropping selection.

### 9.3 Selected-node sync

Once linked, Node Doc polls the linked canvas state key:

- `node-canvas-state-v3:<companyID>:<linkedCanvasWidgetId>`

and reads `selectedNodeID`. That selected node becomes the active storage target for Node Doc.

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
  - if linked but no selected node: prompt user to select a node in linked Node Canvas
  - if linked and node selected: show linked node header + information summary at top of Node Doc

---

## 10) Controls and panels in module UI

### Node Canvas main surface

- Canvas consumes almost all remaining widget height (bottom utility rows removed).
- World grid, relationship lines, node cards, side arrow actions, selection box, and group badge.
- In-canvas instruction text.
- Right-click context menu with `Create new node` at cursor location.
- Right-click context menu also includes `Enable relationship colors` with an explicit iOS-style on/off slider (knob left = off, knob right = on).
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

### Node Canvas right overlay details panel

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

- `frontend/src/module/node/canvas/NodesContent.tsx` (Node Canvas behavior)
- `frontend/src/module/node/doc/NodeDocContent.tsx` (Node Doc behavior)
- `frontend/src/module/node/shared.ts` (shared node types/constants/helpers)
- `frontend/src/app/applayout.tsx` (frame/menu integration and link action wiring)
