# Nested Frame UX Specification

Status: Draft v1 (2026-04-21)

---

## 1) Naming and object model

Terminology is fixed as:

- **Nested Frame**: the feature set that allows frame-in-frame composition.
- **Parent Frame**: a frame that contains child frames.
- **Child Frame**: a frame nested inside a parent frame.

Depth limit:

- Maximum nesting depth is **2 levels** only (Parent -> Child).
- Child frames cannot contain additional child frames.

---

## 2) Core interaction: drag frame into frame

When dragging one frame over another, the target frame shows a Windows-style layout overlay with preview.

### 2.1 Overlay behavior

- Hovering a frame while dragging activates a drop overlay.
- Overlay presents drop zones (for split/nest outcomes as configured by product).
- Moving cursor over a drop zone renders a live placement preview.
- Releasing pointer commits placement.

### 2.2 Preview principle

- Preview must be immediate and obvious.
- Commit occurs only on pointer release.
- Cancel/escape returns to pre-drag state.

---

## 3) Child Frame behavior inside Parent Frame

Once nested, child frames support local layout manipulation inside the parent container:

- move within available child-grid cells,
- resize within parent constraints,
- preserve module identity and state,
- participate in parent-level linked context.

This is intended to feel similar to moving/resizing informational panels within module-local canvases.

---

## 4) Linking contract (mandatory)

Link rule is strict:

- If frame is a Child Frame inside a Parent Frame, it is **always linked**.
- Nested implies linked, with no manual opt-out while nested.

Visual rule:

- linked hexagon badge must be shown on linked module headers.

Unlink rule:

- dragging a Child Frame out of Parent Frame de-links it automatically.
- dragging the same frame back into Parent Frame re-links it automatically.

---

## 5) View presets and nested layouts

The following tab actions are required:

- Rename View
- Delete View
- Default Node View
- Default Company Explorer View
- Save Current as Template

Preset behavior:

- `Default Node View` opens hardcoded baseline Node workspace.
- `Default Company Explorer View` opens hardcoded baseline Explorer workspace.
- Both can be edited by users after opening.
- `Save Current as Template` captures current nested arrangement and module placement for reuse.

---

## 6) Persistence model (frontend view state only)

Nested frame definitions are part of frontend view/layout state persistence.

Important clarification:

- this does **not** imply a new backend database schema,
- it is view composition metadata needed to recreate frame/module arrangement and links.

---

## 7) Operational consistency requirement

For linked nested workspaces (e.g., Explorer + Canvas + Doc), interactions must always target correct backend entities:

- selection changes update query scope correctly,
- mutations (create/update/delete) hit intended IDs,
- cross-pane context remains synchronized.

The goal is deterministic behavior across linked panes without changing core backend entity contracts.
