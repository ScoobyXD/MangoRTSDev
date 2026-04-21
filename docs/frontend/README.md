# Frontend Documentation Index

This folder contains architecture and migration documentation for the React frontend.

## Where to look

### App layer
- `docs/frontend/app/applayout.md`
  - top-level composition
  - frame canvas + menu orchestration
  - state ownership and follow-up refactor notes

### Modules
- `docs/frontend/modules/nodes.md`
  - Node Canvas + Node Doc behavior
  - API contracts
  - persistence model
  - file ownership for node runtime

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
- Remaining work is optional quality refactor for readability/testability.
