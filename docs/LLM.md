# Grid Dashboard UI — Context for LLMs

# 🚨🚨🚨 MANDATORY DOCUMENTATION RULE (READ FIRST) 🚨🚨🚨
# EVERY SINGLE CODE CHANGE MUST BE DOCUMENTED IN THE APPROPRIATE MARKDOWN FILE.
# NO EXCEPTIONS. NO "WILL DOCUMENT LATER."
# IF YOU CHANGE BEHAVIOR, UPDATE THE CORRESPONDING docs/* MODULE FILE IN THE SAME CHANGE.
# CHANGES ARE NOT COMPLETE UNTIL DOCUMENTATION IS UPDATED.

# 🚨🚨🚨 MANDATORY NAMING RULE (READ CAREFULLY) 🚨🚨🚨
# NEVER ABBREVIATE NEW NAMES.
# NEVER INVENT CUSTOM ACRONYMS.
# ALWAYS SPELL OUT FULL WORDS IN TABLE NAMES, TYPES, FIELDS, EVENTS, AND API PATHS.
# BEFORE ADDING ANY NEW NAME (DB COLUMN/TABLE, API FIELD, TYPE, EVENT, CONSTANT), ASK THE OWNER FIRST.
# THIS RULE IS MANDATORY FOR ALL FUTURE CHANGES.

## What This Project Is
A new category of work software called an RTS, named after the video game genre. 
It's a combination of communication, work objects, processes, and execution all in one.
A half-decent analogy is an internal Bloombergy terminal on steroids with video game ui.


## Key Behaviors

- **28×28px square cells, GAP = 0** — adjacent widgets touch edges
- **Grid uses `Math.floor`** — `gridCols = floor(viewportW / 28)`, `gridRows = floor(canvasH / 28)`. Grid never exceeds viewport. Widgets clamped within bounds. No overflow, no scrollbar.
- **+ markers at exact grid intersections** — single SVG `<path>`, `overflow: visible`
- **8-directional resize** — all 4 edges + all 4 corners. Left/top edges move origin inversely. Min 3×3. Edit mode only.
- **Edit mode via canvas right-click** — right-click blank canvas → "Edit Mode: On/Off" toggle. No edit button in header. Edit mode shows blue badge in header + color pickers.
- **Widget right-click menu** — Duplicate / Delete. Works in any mode (edit or not).
- **Right-click menu alignment rule** — menu item text is left-aligned by default; nested child controls are intentionally indented to the right to show hierarchy.
- **Boxy Hierarchical (default)** — this is the default style for hierarchical lists across the product.
- **Nested relationship visuals** — for list-like nested UI (including right-click menus), use Boxy Hierarchical: Company Explorer-inspired boxy rows with child rows indented under the parent row.
- **Hierarchy list styling convention** — Boxy Hierarchical lists are fully boxy (top-level and nested rows), without triangle expand/collapse icons or decorative connector lines unless explicitly requested.
- **Hierarchy spacing rule** — in Boxy Hierarchical lists, stacked hierarchy boxes touch with no vertical gaps between adjacent rows (top-level and nested).
- **Module-name click switcher** — single-click the module name tag (not the full header row) to open a module-type picker and swap kind/title in place. Works in edit and non-edit mode.
- **Add widget (+)** — always-visible button in header. Works in any mode.
- **Nothing auto-moves, instant snapping, no transitions**

## Complete Feature Inventory (Source of Truth)

Use this checklist before editing features so existing behavior is not accidentally removed.

### 1) Layout, Grid, and Rendering
- Drag-and-drop grid dashboard. React + TypeScript + Vite. Zero external libraries. Fullscreen canvas, no scrolling.
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
- Delete selected module via keyboard Delete/Backspace (confirmation required before frame removal).

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
- Ctrl/Cmd + Z: undo dashboard frame/layout changes when focus is outside editable text.
- Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z: redo dashboard frame/layout changes when focus is outside editable text.
- Keyboard shortcuts defer while typing in inputs, textareas, selects, contentEditable, and nested editable surfaces. The Editor textarea handles its own bounded local text undo/redo.

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
- Editor text undo is a separate in-memory range stack per mounted editor. It is not stored in information or projection tables.

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
1. **Widget menu** (right-click widget): Duplicate, Delete (with confirmation) — always available
2. **Module type menu** (single-click module name tag): pick any module type from `WIDGET_LIBRARY`
3. **Canvas menu** (right-click empty space): Toggle Edit Mode (shows current ON/OFF state), Canvas Color, Plus Color
4. **Header menu** (right-click top header bar): Header Bar color, Header Text color, Tab Box color, Tab Text color
5. **Tab menu** (right-click a view tab): Rename View, Delete View (delete disabled when only one tab remains)

Widget `onContextMenu` calls `e.stopPropagation()` to prevent canvas menu from opening.

## Keyboard Controls

- **Delete / Backspace**: delete selected module
- **Ctrl/Cmd + C**: copy selected module
- **Ctrl/Cmd + V**: paste copied module with a small offset
- **Ctrl/Cmd + Z**: undo dashboard frame/layout changes unless focus is inside editable text
- **Ctrl/Cmd + Y** or **Ctrl/Cmd + Shift + Z**: redo dashboard frame/layout changes unless focus is inside editable text

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

## UI Rules (Text Editing)

- All text editing interactions in MangoRTS must be visually seamless.
- The current Editor inline title editing interaction is the gold-standard reference behavior for MangoRTS.
- Clicking into editable text should only reveal the insertion caret at the text edge.
- Users must be able to click anywhere in the text zone (prefix text, title text, or trailing row space) and immediately enter edit mode with a caret.
- Entering edit mode must not introduce a bordered box, background fill, typography shrink, or layout jump.
- Edit-mode typography must match read-mode typography exactly (font size, weight, letter spacing, line height, casing).
- If a label prefix is visible in read mode (example: `Node:`), it must remain visually stable in edit mode while only the editable text segment changes.

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
Prefer **frame data model** over widget for the container model in code.

## Frame/Module Surface Terminology

Use these names consistently in product notes, code comments, and future implementation work:

- **Header section**: the top band of a frame/module, from the top edge down through the thin divider line under the frame name, link hexagon, tabs, or module title controls.
- **General section**: the module body below that thin divider line. This is where the module's primary content and in-module interactions live.

Interaction convention:

- The header section is the frame/module movement and frame-selection surface.
- Root frames use the full header section as a drag handle in edit mode and non-edit mode.
- Child frames use the full header section as a drag handle inside their parent frame.
- Right-clicking the header section opens the frame/module actions menu: Duplicate, Link modules, Delink modules, color choices, and Delete.
- The general section should remain reserved for module-local work such as editing text, manipulating Kanban cards, selecting map nodes, and interacting with explorer rows.
- A selected frame must show a visible frame-border/ring indication so users can tell which module will participate in link, delete, copy, or other frame-level actions.

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
