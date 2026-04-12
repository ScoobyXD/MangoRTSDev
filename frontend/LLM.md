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
- **Add widget (+)** — always-visible button in header. Works in any mode.
- **Nothing auto-moves, instant snapping, no transitions**

## Resize Math (left/top edges)

```
shift = clamp(mouseDelta, -origPosition, origSize - MIN_SIZE)
newPosition = origPosition + shift
newSize = origSize - shift
```

## Context Menus

Two separate menus, both use `FloatingMenu` component with outside-click and Escape handling:
1. **Widget menu** (right-click widget): Duplicate, Delete — always available
2. **Canvas menu** (right-click empty space): Edit Mode toggle, Reset Layout (edit mode only)

Widget `onContextMenu` calls `e.stopPropagation()` to prevent canvas menu from opening.

## Persistence

- Widgets: `grid-dashboard-v7`
- Settings: `grid-dashboard-settings` (bgColor, crossColor)

## Stack

React 18 · TypeScript strict · Vite · Zero deps beyond React
