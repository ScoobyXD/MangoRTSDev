# Module Linking Audit

Last updated: 2026-08-05

## Current contract

The app has one undirected context-link graph stored under `frame-module-links-v1` and one frame registry under `frame-module-registry-v1`.

Linkable kinds are:

- Editor
- Company Explorer
- Kanban

`frameLinking.ts` owns app-layer pairwise link creation, removal, labels, sanitization, and graph traversal. `linkingGraph.ts` exposes the matching generic helpers to modules.

## Live selection

`selectionCoordinator.ts` is the same-tab semantic selection bus. A publication contains company, entity kind and ID, optional label/tree/folder context, source frame/module, exact target frames, intent, timestamp, and source-local sequence.

- Explorer publishes exact entity and folder intent to linked targets.
- Editor consumes Node or Logic Gate context and may publish its own semantic selection where supported.
- Kanban consumes or publishes Node/Logic Gate work context where supported.
- Same-source updates require a newer sequence unless the timestamp proves a remount reset.
- Older cross-source updates cannot replace newer user intent.
- The source frame does not receive its own stored echo.

There are no geometry, canvas-selection, or compatibility storage channels in the current linking model.

## Verification

- `tests/frontend/app/frameLinking.test.ts`
- `tests/frontend/modules/linkingGraph.test.ts`
- `tests/frontend/modules/selectionCoordinator.test.ts`
- `tests/frontend/modules/company-explorer/selectionSync.test.ts`