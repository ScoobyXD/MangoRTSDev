# App Layout (Frontend)

File: `frontend/src/app/applayout.tsx`

## Purpose

`applayout` is the top-level runtime composition for the dashboard UI. It owns:

- frame grid rendering and placement behavior
- tab/view orchestration
- selection state and edit mode
- context menu opening/closing and command wiring
- persistence hooks for views/settings
- integration points between frames and module content

## Component composition

`applayout` composes these app-layer components:

- `frame.tsx` — frame container primitive
- `framecanvas.tsx` — board/canvas container primitive
- `framerightclickmenu.tsx` — floating right-click menu container
- `menus/ModulePickerMenu.tsx` — module-type chooser (including node submodule menu)
- `frameLinking.ts` — pure helper layer for link/delink planning and context-menu label semantics

## Data model ownership

- Frame model type: `FrameDataModel` (`frontend/src/types.ts`)
- Module registry: `MODULE_LIBRARY`, `MODULE_CONTENT_MAP` (`frontend/src/modules/index.ts`)

## Persistence contracts

The app layout keeps compatibility for persisted payloads:

- `grid-dashboard-views-v1`
  - reads both legacy `tab.widgets` and current `tab.frames`
- `grid-dashboard-settings`
  - stores global UI color and header/tab settings
- `node-doc-widget-links-v1`
  - retained key name for Node Map/Doc linking compatibility

## Migration outcome

- `frontend/src/App.tsx` compatibility export was removed.
- Runtime entry is now directly `main.tsx` -> `app/applayout.tsx`.
- widget/module compatibility shims were removed from `src/widgets`.

## Optional follow-up (non-blocking)

`applayout` is functionally correct but still large. Future quality refactor can extract:

- undo/redo snapshot logic into a dedicated hook
- drag/resize interaction handlers into dedicated hooks
- menu command action groups into smaller modules

## Frame header + linking behavior notes (2026-04-25)

- Frame headers are now compact top-left overlay tags (module name chip + linked hex indicator) instead of full-width header bars, removing dead header space and keeping content area dominant.
- Compact header plate is now edge-flush (`top:0`, `left:0`) with explicit right/bottom borders so the plate reads as a clean rectangle integrated into the frame corner without corner gaps.
- Selection no longer causes subtle content shifts because frame borders keep constant width in selected/non-selected states.
- Frame right-click menu `Link modules` label now shows `No other module selected` when only one module is active in selection/context.
- Link planning now supports Editor + Company Explorer linking when both already share exactly one existing Node Map link target (fallback map inference).
- Right-click menu now includes `Delink modules`, which removes link mappings touching selected/context modules (including reverse links when a Node Map is selected).

## Frame linking + canvas menu updates (2026-04-26)

- Frame linking now uses a generic graph-style context-link model (`frame-module-links-v1`) instead of a Node-Map-only pairing model.
- Context-menu linking can directly connect Company Explorer and Editor to each other, and is intentionally structured for future module kinds such as logic-map.
- Existing module contracts are preserved by deriving legacy editor/explorer -> map link keys from the link graph (compatibility bridge for current module internals).
- Right-clicking empty canvas now includes `Create new frame`, which spawns a frame at the clicked grid location.
- Selected frames now use a common web-app convention: blue focus outline + focus ring shadow for stronger visibility.
- Selection ring, teal frame option, and drag placement splash now use the unified RGB `0,233,255` accent to match the canvas/header accent direction.
