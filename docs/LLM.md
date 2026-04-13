# Grid Dashboard UI — Context for LLMs

## What This Project Is

Drag-and-drop grid dashboard. React + TypeScript + Vite. Zero external libraries. Fullscreen canvas, no scrolling.

## Key Behaviors

- **28×28px square cells, GAP = 0** — adjacent widgets touch edges
- **Grid uses `Math.floor`** — `gridCols = floor(viewportW / 28)`, `gridRows = floor(canvasH / 28)`. Grid never exceeds viewport. Widgets clamped within bounds. No overflow, no scrollbar.
- **+ markers at exact grid intersections** — single SVG `<path>`, `overflow: visible`
- **8-directional resize** — all 4 edges + all 4 corners. Left/top edges move origin inversely. Min 3×3. Edit mode only.
- **Edit mode via canvas right-click** — right-click blank canvas → "Edit Mode: On/Off" toggle. No edit button in header. Edit mode shows blue badge in header + color pickers.
- **Widget right-click menu** — Duplicate / Delete. Works in any mode (edit or not).
- **Module-name click switcher** — single-click the module name tag (not the full header row) to open a module-type picker and swap kind/title in place. Works in edit and non-edit mode.
- **Add widget (+)** — always-visible button in header. Works in any mode.
- **Nothing auto-moves, instant snapping, no transitions**

## Complete Feature Inventory (Source of Truth)

Use this checklist before editing features so existing behavior is not accidentally removed.

### 1) Layout, Grid, and Rendering
- Fullscreen app layout (`100vw × 100vh`) with no page scroll.
- Top header bar + canvas body area.
- Canvas grid based on cell math (`CELL_SIZE = 28`), with `gridCols/gridRows` derived from viewport and header height.
- Grid cross markers rendered as a single SVG path (`GridCrosses`) with configurable cross color.
- Widgets/modules positioned and sized in grid units and rendered absolutely.
- Widgets are clamped to grid bounds.

### 2) Modules (Widgets)
- Built-in module library from `WIDGET_LIBRARY` and content render map from `CONTENT_MAP`.
- Module cards support:
  - title tag
  - content area
  - theme colors (`teal/orange/white/black`)
  - selection border when selected.
- Add new module via `+` in header.
- Duplicate module via module context menu.
- Delete module via module context menu.
- Delete selected module via keyboard Delete/Backspace.

### 3) Edit Mode + Manipulation
- Edit mode toggle available in header and canvas context menu.
- In edit mode:
  - drag/move module by pointer
  - 8-direction resize (4 sides + 4 corners)
  - min module size is 3×3 cells.
- Collision safety: overlapping drag/resize is reverted to original geometry.
- Placement splash effect appears while actively dragging in edit mode.

### 4) Selection + Module Type Switching
- Selecting modules:
  - mouse/touch down on a module selects it
  - clicking blank canvas clears selection.
- Module type switcher:
  - single-click module name tag (label chip) opens module-type menu
  - pick from `WIDGET_LIBRARY` to replace module `kind` and `title` in-place
  - works in edit and non-edit modes.

### 5) Views/Tabs
- Multiple view tabs supported.
- Switch active tab by click.
- Reorder tabs by drag-hover behavior.
- Rename tab by double-click tab label or tab menu.
- Delete tab from tab menu (disabled when only one tab remains).
- Add tab with `+` tab button.
- Each tab stores its own module layout list.

### 6) Context Menus
- Widget menu (right-click module): Duplicate, colorway choices, Delete.
- Module type menu (module-name click): choose module type.
- Canvas menu (right-click blank canvas):
  - Toggle Edit Mode with current status text
  - Canvas background color picker
  - Plus/cross color picker.
- Header menu (right-click top header bar):
  - Header bar color
  - Header text color
  - Tab box color
  - Tab text color.
- Tab menu (right-click tab): Rename View, Delete View.
- Menus close on outside click (`FloatingMenu` behavior).

### 7) Keyboard Shortcuts
- Delete / Backspace: delete selected module.
- Ctrl/Cmd + C: copy selected module.
- Ctrl/Cmd + V: paste copied module with small offset.
- Ctrl/Cmd + Z: undo.
- Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z: redo.
- Keyboard shortcuts are ignored while typing in inputs/textareas/contentEditable.

### 8) Undo/Redo History
- Snapshot-based undo/redo tracks:
  - tabs/view state
  - module lists/layouts
  - canvas color
  - cross color
  - header color
  - header text color
  - tab box color
  - tab text color.
- Undo stack capped to a fixed length.

### 9) Persistence
- Views/tabs/modules are persisted to local storage (`grid-dashboard-views-v1`).
- UI/theme settings are persisted to local storage (`grid-dashboard-settings`).
- Settings include canvas/cross + header/tab colors.

### 10) Interaction Safeguards
- Right-click handlers use propagation guards where needed (e.g., widget/tab menus) to avoid opening wrong parent menu.
- Selected module auto-clears when removed or no longer present in active tab.
- Pointer handlers prevent unintended behavior while resizing/dragging.

## Resize Math (left/top edges)

```
shift = clamp(mouseDelta, -origPosition, origSize - MIN_SIZE)
newPosition = origPosition + shift
newSize = origSize - shift
```

## Context Menus

Menus use `FloatingMenu` with outside-click handling:
1. **Widget menu** (right-click widget): Duplicate, Delete — always available
2. **Module type menu** (single-click module name tag): pick any module type from `WIDGET_LIBRARY`
3. **Canvas menu** (right-click empty space): Toggle Edit Mode (shows current ON/OFF state), Canvas Color, Plus Color
4. **Header menu** (right-click top header bar): Header Bar color, Header Text color, Tab Box color, Tab Text color
5. **Tab menu** (right-click a view tab): Rename View, Delete View (delete disabled when only one tab remains)

Widget `onContextMenu` calls `e.stopPropagation()` to prevent canvas menu from opening.

## Keyboard Controls

- **Delete / Backspace**: delete selected module
- **Ctrl/Cmd + C**: copy selected module
- **Ctrl/Cmd + V**: paste copied module with a small offset
- **Ctrl/Cmd + Z**: undo
- **Ctrl/Cmd + Y** or **Ctrl/Cmd + Shift + Z**: redo

## Persistence

- Widgets: `grid-dashboard-v7`
- Settings: `grid-dashboard-settings` (bgColor, crossColor)

## Stack

React 18 · TypeScript strict · Vite · Zero deps beyond React

## Visual Direction (Important)

- Do **not** use muted / desaturated “sad” color palettes.
- Primary brand direction is **vibrant teal-blue + bright neon orange**.
- Header/top bar should emphasize neon orange.
- Use teal-blue as the main complementary accent across grid/widget UI elements.
- Approved widget colorways (until changed): **teal / neon orange / white / black** only.

## New Product Primitive: Case Hub

This app now includes a **Case Hub** widget built around a central work object called a **Case**.

### Naming options
- **Case** (recommended)
- Work Item
- Thread
- Ops Card

### What a Case is
A Case is the source of truth for one piece of work. Everything related to that work should be attachable or linkable in one place.

### Case Hub widget goals
- Create a Case quickly.
- Assign a visible responsible person.
- Add notes and links (email/doc/URL context).
- Create child cases linked to a parent case.
- Let leadership monitor progress remotely from one object.

## Terminology Update

Prefer **module** over widget in product language and UI labels.

## Implementation Decision (April 8, 2026)

### MVP stack
- Frontend: React + TypeScript
- Backend (primary): Go
- Backend (selective later use): Rust only for proven hot paths
- Database: AWS RDS PostgreSQL (Aurora)
- Queue/event layer: SQS early; Kafka only when volume requires it

### Rationale
- Keep one backend language early for velocity and lower ops complexity.
- Introduce Rust only for isolated performance-critical workloads once bottlenecks are measured.
- Maintain clean service boundaries (HTTP/gRPC + queue).

### Case source-of-truth requirements
- A Case must be easy to update: fast add, link, and delete operations.
- A Case should aggregate cross-org context: messages, emails, notifications, logistics updates, and child cases.
- Ownership must be explicit and visible.

### AWS cost governance
- Tag all resources with team and owner.
- Enforce budgets.
- Remove untagged or ownerless resources.
