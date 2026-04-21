# Frame/Module Migration Handoff (Frontend)

See `docs/frontend/README.md` for the full docs map.

## Status (2026-04-21)

- PRA naming migration: complete.
- PRB structural extraction: complete for migration goals.
- Runtime uses frame/module naming in source code.

## Current runtime entry and ownership

- Entry: `frontend/src/main.tsx` -> `frontend/src/app/applayout.tsx`
- Registry: `frontend/src/modules/index.ts`
- Node modules:
  - `frontend/src/modules/node/canvas/NodesContent.tsx`
  - `frontend/src/modules/node/doc/NodeDocContent.tsx`
  - `frontend/src/modules/node/shared.ts`

## Contracts that must remain stable

- Node Doc links key: `node-doc-frame-links-v1`
- Node Canvas state key format: `node-canvas-state-v3:<companyID>:<frameId-or-global>`

## Completed cleanup

- Removed migration shims and transitional files from `frontend/src`.
- Consolidated to one `modules` folder (removed old `module` path).
- Removed obsolete app wrappers (`frame.tsx`, `framecanvas.tsx`) and inlined usage.
- Removed legacy general-purpose content file by moving non-node module content into `modules/content/basic.tsx`.

## Non-blocking follow-up

- Optional: split `applayout.tsx` into smaller hooks/components for readability and testing.
