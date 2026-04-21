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
- Pulled node module runtime out of `WidgetContent.tsx` into `frontend/src/module/node/*` so node entries can evolve without depending on a giant general-purpose content file.

## Behavior expectations

- This change is structural: prop contracts and user interactions are preserved.
- Existing persistence compatibility from PRA remains in `applayout`.

## Remaining PRB follow-up

- Continue extracting additional cohesive logic blocks from `applayout` to keep the file slim (state orchestration/hooks, frame interaction logic, and menu command handlers).
