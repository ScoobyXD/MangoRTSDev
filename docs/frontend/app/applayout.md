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
- `frame-module-links-v1`
  - graph edge list for frame-to-frame context links
- `frame-module-registry-v1`
  - frame kind registry (`frameID -> kind`) for graph consumers

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
- Frame actions such as Duplicate, Detach Child Frame, Delink modules, colorway, and Delete are now only opened from the compact frame/module header plate. Module body right-clicks are reserved for module-specific menus such as Company Explorer creation actions.

## Frame linking + canvas menu updates (2026-04-26)

- Frame linking now uses a generic graph-style context-link model (`frame-module-links-v1`) instead of a Node-Map-only pairing model.
- Context-menu linking can directly connect Company Explorer and Editor to each other, and now includes additional module kinds such as Logic Gate Map and Kanban.
- Existing module contracts are preserved by deriving legacy editor/explorer -> map link keys from the link graph (compatibility bridge for current module internals).
- Right-clicking empty canvas now includes `Create new frame`, which spawns a frame at the clicked grid location.
- Selected frames now use a common web-app convention: blue focus outline + focus ring shadow for stronger visibility.
- Selection ring, teal frame option, and drag placement splash now use the unified RGB `0,233,255` accent to match the canvas/header accent direction.

## Frame-link graph hardening + full migration (2026-04-26)

- `applayout` now treats `frame-module-links-v1` as the sole linking source-of-truth and emits a dedicated graph-update event only when link edges actually change.
- Legacy compatibility key persistence (`node-doc-widget-links-v1`, `company-explorer-widget-links-v1`) was removed from app-layer write paths to eliminate drag/resize-induced link churn.
- Frame metadata for graph consumers is now persisted separately as `frame-module-registry-v1` (`{ frameID -> { kind } }`) and only rewritten when membership/kind signature changes.
- This isolates high-frequency geometry updates from cross-module linking state propagation.


## Frame delete confirmation hardening (2026-04-30)

- Frame deletion is now confirmation-gated in `applayout` for both entry paths:
  - keyboard `Delete` / `Backspace` when frame selection exists
  - frame right-click menu `Delete`
- Deletion now follows an explicit two-step flow:
  1. collect current target frame IDs (single or multi-select)
  2. open confirmation modal (`Are you sure you want to delete N frame(s)?`)
  3. only remove frames after explicit `Yes`
- This aligns frame deletion safety with existing Node Map delete-confirm behavior, reducing accidental destructive actions on hot interaction paths.
- Confirmation dialog copy includes Undo guidance (`Ctrl/Cmd + Z`) so recovery remains obvious for rapid workflows.

## Keyboard shortcut routing update (2026-05-03)

- Global dashboard shortcuts now route through `frontend/src/hooks/keyboardShortcutRouting.ts`.
- Editable text targets (`input`, `textarea`, `select`, `contentEditable`, role textbox, and nested editable descendants) keep native browser shortcut behavior. This means the Editor document owns normal text undo/redo while it has focus.
- Dashboard undo/redo still uses the existing snapshot stack for frame/tab/layout state when focus is outside editable text. This keeps text editing and frame editing as separate, predictable undo scopes.

## Header-section selection and drag update (2026-05-03)

- Frame/module surfaces now use two explicit terms:
  - **Header section**: the top band from the frame/module top edge down through the thin divider under the frame name, linked hexagon, tabs, or module title controls.
  - **General section**: the module body below that divider, reserved for module-local work.
- `applayout` hit-tests the full header section before module content can stop pointer propagation.
- Root frames can be selected from the header section, and the full header section starts frame movement in edit mode and non-edit mode.
- Child frames can be selected from the header section and dragged within their parent frame from that full header section.
- Right-clicking anywhere in the header section opens the frame action menu with Duplicate, Link modules, Delink modules, color choices, and Delete.
- Dragging no longer starts from the general section; the body remains available for text editing, Kanban card work, map selection, explorer rows, and other module interactions.
- Selected frames render a persistent cyan frame ring using `FRAME_SELECTION_COLOR`, confirming which frame is active for link, delete, copy, and related frame-level actions.
