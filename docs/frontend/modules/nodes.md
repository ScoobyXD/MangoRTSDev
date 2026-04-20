# Nodes Module (Frontend) — Feature Documentation

This document captures the full behavior and implementation details currently present in the **Nodes** widget/module.

---

## 1) Purpose

The Nodes module provides a visual “canvas-inside-canvas” experience inside a dashboard widget where users can:

- create and delete nodes,
- create directional relationships from side handles,
- drag nodes on a fine grid,
- zoom and pan across a larger virtual node world,
- box-select multiple nodes,
- view relationship lines between nodes,
- add node information records,
- and keep node layout/view state persisted locally.

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

- `Ctrl + drag` on canvas creates marquee selection box.
- Nodes intersecting the box become selected.
- Visual indicators:
  - selected border/outline/glow,
  - selected dot marker on card,
  - “Group selected: N” badge for multi-select.
- Clicking blank canvas clears group selection.

---

## 5) Relationship creation rules

Each selected node card shows `+` handles on all sides:

- Left `+` -> peer relationship
- Right `+` -> peer relationship
- Top `+` -> new node is parent of source node
- Bottom `+` -> new node is child of source node

### Position mapping currently used when creating relationship records

Source node is always `node_id_a`, new node is `node_id_b`.

- Left/Right:
  - `a_position = Peer`
  - `b_position = Peer`
- Top:
  - `a_position = Child`
  - `b_position = Parent`
- Bottom:
  - `a_position = Parent`
  - `b_position = Child`

This mapping is aligned to the intended parent/child semantics for top/bottom creation.

---

## 6) Relationship line rendering

Relationships are visualized with SVG polylines in world space.

### Anchor behavior

- A relationship remembers creation-side anchors when created in-session.
- If no remembered anchor exists, anchor side is inferred from relationship positions and geometry.

### Routing behavior

- Polyline routes are orthogonal and grid-snapped.
- Lines originate from side anchors that correspond to `+` side conventions.
- Rendering is non-interactive (`pointerEvents: none`) and sits under node cards.

---

## 7) Data loading strategy

- `loadNodes()` loads all nodes.
- `loadDetails(selectedNodeID)` loads details panel data for one selected node.
- `loadGraphRelationships(nodes)` fetches details for each node and deduplicates relationships by `node_relationship_id` to render full graph links.

---

## 8) Local persistence (layout + viewport)

The module persists canvas state in `localStorage` keyed per company and widget:

- Key format: `node-canvas-state-v3:<companyID>:<widgetID>`
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

## 9) Controls and panels in module UI

### Main canvas

- Canvas consumes almost all remaining widget height (bottom utility rows removed).
- World grid, relationship lines, node cards, side `+` actions, selection box, and group badge.
- Right-click context menu with `Create new node` at cursor location.
- Right-click on a node opens node actions (`Edit node`, `Delete node`).
- Delete key support for selected node(s), guarded by themed confirmation modal.

### Right overlay details panel

- Double-clicking a node opens a translucent “glass” panel anchored to the right side.
- Panel can be dragged and resized.
- Panel contains:
  - add information controls,
  - delete node action,
  - relationships list,
  - information list,
  - loading/error feedback.

---

## 10) Teal theme update

App-level `teal` colorway currently uses:

- `color: #00d5ff` (RGB `0, 213, 255`)
- `accent: #006f85`
- `text/tagBg: #042028`

This is the requested teal update used by teal-themed modules.

---

## 11) Known scope notes

- Node layout persistence is frontend-local (browser localStorage), not backend-persisted.
- Relationship anchor memory for side-origin is strongest for in-session-created links; fallback inference handles existing links.
- Graph relationship loading currently calls per-node details and deduplicates results in frontend.

---

## 12) File ownership (current implementation)

Primary implementation is in:

- `frontend/src/WidgetContent.tsx` (Nodes module behavior)
- `frontend/src/App.tsx` (teal colorway config)
