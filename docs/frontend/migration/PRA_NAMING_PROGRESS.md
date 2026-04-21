# PR A (PRA) Naming Migration Progress

Date: 2026-04-21

## Scope completed in this change

- `frontend/src/App.tsx` moved core runtime identifiers from widget-first names to frame-first names for:
  - selection state (`selectedFrameId`, `selectedFrameIds`)
  - frame context menu state (`frameRightClickMenu`)
  - frame lifecycle actions (`addFrame`, `duplicateFrame`, `deleteSelectedFrame`, `copySelectedFrame`, `pasteFrame`)
  - component naming (`FrameCard`, `FrameRightClickMenu`)
  - active tab frame collection naming (`frames`)
- Internal persistence compatibility was preserved for existing localStorage payloads:
  - load path reads both `tab.frames` and legacy `tab.widgets`
  - save path still writes a `widgets` field alongside frame-shaped tab data
- Storage key compatibility was kept intact:
  - `node-doc-widget-links-v1` remains unchanged intentionally.

## Completion status

PRA is complete and its naming decisions are now the baseline:

- frame-first runtime identifiers are in place.
- persisted storage compatibility from the transition was preserved.
- PRB has already consumed this naming baseline and completed structural extraction.
