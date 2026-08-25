# Logic Gates Frontend Module

Last updated: 2026-08-24

## Purpose

Logic Gates remain first-class workspace records with an Editor, Process Map operational flow, RACI presentation, Kanban/Arena workflows, manual saved versions, permissions, attachments, exact email ownership, recycle, and restore behavior.

## Module ownership

- `frontend/src/modules/logic-gates/types.ts` owns shared Logic Gate record, details, permission, and Editor projection types.
- `frontend/src/modules/logic-gates/logicGateRecordStore.ts` owns coalesced details, projection, and RACI reads.
- `frontend/src/modules/process-map/` owns the bounded layer client, fixed geometry, interaction rules, and custom Process Map rendering.
- `frontend/src/modules/logic-gates/raciPresentation.ts` owns RACI label and presentation rules.
- Committed-title snapshot reconciliation lives in `frontend/src/modules/realtime/committedTitleSnapshotReconciliation.ts`.

## API and persistence contracts

- Logic Gate list, detail, update, permission, RACI, deletion, recycle, and restore commands keep their existing APIs.
- `/v1/workspace/entity-batches` creates Logic Gates, folder items, creator RACI assignments, and client-to-entity mappings. Items contain identity, title, and optional Explorer position only.
- Operational relationships use exact typed identities through the bounded `/v1/process-map/operational-relationships` API. The frontend has no full-company Logic Gate relationship graph or compatibility cache.
- Workspace snapshots expose Logic Gates only through retained `full`, `company_explorer`, and `kanban` scopes; Process Map loads one root or exact Folder layer separately.
- Committed title updates keep Editor, Kanban/Arena, Home, Explorer, Project, and dock/pin labels consistent while preserving active drafts.

## Editor, history, and restore

- The current document lives in `logic_gate_textboxes` and uses the authenticated JSON Editor contract.
- Manual Save appends one batch to `logic_gate_textboxes_history` with saving-user identity.
- History listing and Restore keep the current document identity.
- Permissions, attachments, exact email relationships, normal revisions/collaboration, deletion, recycle, and restore retain their existing behavior.

## Verification

Focused coverage lives in the Logic Gate HTTP/store/history/recycle/permission suites, the Editor suites, `tests/frontend/app/committedTitleCacheReconciliation.test.ts`, the Process Map frontend suites, and the Kanban/Arena frontend suites.
