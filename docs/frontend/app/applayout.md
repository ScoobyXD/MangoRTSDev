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

- `framerightclickmenu.tsx` — floating right-click menu container
- `menus/ModulePickerMenu.tsx` — module-type chooser (including node submodule menu)

## Data model ownership

- Frame model type: `FrameDataModel` (`frontend/src/types.ts`)
- Module registry: `MODULE_LIBRARY`, `MODULE_CONTENT_MAP` (`frontend/src/modules/index.ts`)

## Persistence contracts

The app layout keeps compatibility for persisted payloads:

- `grid-dashboard-views-v1`
  - stores tab frame collections as `tab.frames`
- `grid-dashboard-settings`
  - stores global UI color and header/tab settings
- `node-doc-frame-links-v1`
  - Node Canvas/Doc frame-link map

## Migration outcome

- Runtime entry is now directly `main.tsx` -> `app/applayout.tsx`.
- Migration-era compatibility shims were removed from `src`.

## Optional follow-up (non-blocking)

`applayout` is functionally correct but still large. Future quality refactor can extract:

- undo/redo snapshot logic into a dedicated hook
- drag/resize interaction handlers into dedicated hooks
- menu command action groups into smaller modules
