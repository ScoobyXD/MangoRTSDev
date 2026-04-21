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
- Pulled node module runtime out of `WidgetContent.tsx` into `frontend/src/module/node/*`.
- Completed split of node runtime into dedicated files:
  - `module/node/canvas/NodesContent.tsx`
  - `module/node/doc/NodeDocContent.tsx`
  - `module/node/shared.ts`
- Removed migration compatibility files after successful wiring:
  - deleted `frontend/src/App.tsx` compatibility export
  - deleted `frontend/src/widgets/index.ts` compatibility shim
  - deleted `frontend/src/module/node/NodeModules.tsx` transitional monolith

## Behavior expectations

- This change is structural: prop contracts and user interactions are preserved.
- Existing persistence compatibility from PRA remains in `applayout`.

## Remaining follow-up (non-blocking)

- Optional quality refactor: split `applayout` into additional hooks/components for readability and testability.
