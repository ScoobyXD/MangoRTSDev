# PR B (PRB) Structural Extraction Progress

Date: 2026-04-21

## Scope completed in this change

- Converted `frontend/src/App.tsx` into a thin compatibility export to `app/applayout`, so top-level app orchestration now lives in the app layer.
- Moved active dashboard runtime implementation into `frontend/src/app/applayout.tsx`.
- Wired previously placeholder app-layer components into runtime usage:
  - `app/frame.tsx` is now used by `FrameCard` for frame container rendering.
  - `app/framecanvas.tsx` is now used for the main canvas interaction surface.
  - `app/framerightclickmenu.tsx` now owns right-click menu placement + outside-click behavior.
  - `app/menus/ModulePickerMenu.tsx` now owns module picker rendering (including Nodes submenu).
- Pulled node module runtime out of `WidgetContent.tsx` into `frontend/src/modules/node-map/*`.
- Completed split of node runtime into dedicated files:
  - `modules/node-map/NodesContent.tsx`
  - `modules/editor/EditorContent.tsx`
  - `modules/node-map/shared.ts`
- Removed migration compatibility files after successful wiring:
  - deleted `frontend/src/App.tsx` compatibility export
  - deleted `frontend/src/widgets/index.ts` compatibility shim
  - deleted `frontend/src/modules/node-map/NodeModules.tsx` transitional monolith

## Behavior expectations

- This change is structural: prop contracts and user interactions are preserved.
- Existing persistence compatibility from PRA remains in `applayout`.

## Remaining follow-up (non-blocking)

- Optional quality refactor: split `applayout` into additional hooks/components for readability and testability.

## PRB completion verdict

PRB migration goals are complete:

- app-layer extraction is active in runtime
- node runtime is in module-layer files
- transitional compatibility shims introduced for migration are removed
- build passes after cleanup
