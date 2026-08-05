# Frontend Documentation Index

This folder contains architecture, product behavior, and migration documentation for the React frontend.

## Where to look

### App layer
- `docs/frontend/src/app/applayout.md`
  - top-level composition
  - frame canvas + menu orchestration
  - state ownership and follow-up refactor notes
- `docs/frontend/src/app/nested-frames.md`
  - Nested Frame terminology (`Parent Frame`, `Child Frame`)
  - drag-to-frame overlay + preview behavior
  - linking/de-linking semantics
  - default view + template interactions

### Modules
- `docs/frontend/src/modules/nodes.md`
  - Node records, relationships, Editor, authored changes, unread/seen behavior, and manual history
  - API contracts
  - final storage and cache contracts
  - file ownership for node runtime
- `docs/frontend/src/modules/logic-gates.md`
  - Logic Gate records, Input/Output relationships, Editor, GVIC, and manual history
  - Input/Output relationship semantics
  - API and final-storage contracts
  - Editor, Arena/Kanban, and Company Explorer behavior
- `docs/frontend/src/modules/company-explorer.md`
  - Company Explorer standalone behavior
  - 3-pane responsibilities (tree/details/context)
  - default view menu requirements
  - linked Node workspace behavior
- `docs/frontend/src/modules/kanban.md`
  - Kanban board behavior
  - Explorer drag payload contract
  - headless Kanban API contract
  - linkable frame behavior
- `docs/frontend/src/modules/editor.md`
  - Editor document behavior
  - outline mode behavior
  - mandatory Indent Guides visual rules
- `docs/frontend/src/modules/settings.md`
  - Settings company scope behavior
  - dev-admin company search and invite targeting
  - mandatory Settings custom dropdown convention

### Migration history
- `docs/frontend/migration/FRAME_MODULE_MIGRATION_HANDOFF.md`
  - migration context + current state snapshot
- `docs/frontend/migration/PRA_NAMING_PROGRESS.md`
  - naming migration record (`widget` -> `frame/module`)
- `docs/frontend/migration/PRB_STRUCTURAL_PROGRESS.md`
  - structural extraction record + shim cleanup

## Current status (2026-04-21)

- Naming migration (PRA): complete.
- Structural extraction (PRB): complete for migration goals.
- Company Explorer and Nested Frame product specs: drafted.
- Remaining implementation work is in module runtime and app-layer interactions.
- Hierarchical list default visual style: **Boxy Hierarchical** (boxed rows, indented nested rows, no triangle indicators, flush stacked row spacing).
