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
