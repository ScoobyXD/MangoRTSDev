# Company Explorer Module

Last updated: 2026-08-05

## Purpose

Company Explorer is the standalone hierarchical workspace browser for folders, Logic Gates, Projects, the protected narrow Node placement cases, shared communications folders, search, and resource actions.

## Current behavior

- The tree is backed by Company Explorer folder and folder-item APIs, permissions, sparse ordering, and lazy child reads.
- Selecting a Node, Logic Gate, Project, Kanban board, folder, or communications row updates Explorer state and publishes one generic live selection to directly linked surviving frames.
- Explorer does not read or write browser geometry or entity-position state.
- Root and folder navigation works independently. It does not invent the first entity as a fallback selection.
- Search and Find select exact known entities and expand their ancestor folder paths from indexed folder/item rows.
- Rename, delete, drag/drop, and context-menu actions keep their existing permission and transactional rules.

## Module ownership

- `CompanyExplorerContent.tsx` owns the mounted tree and command wiring.
- `CompanyExplorerContentModel.ts` owns context-menu and initial-expanded-row presentation.
- `companyExplorerStore.ts` owns bounded cache/coalescing behavior.
- `companyExplorerTreeRows.ts` and `treePresentation.ts` own deterministic tree rows, ordering, search, Find, keyboard navigation, and published semantic selection.
- `selectionSync.ts` owns semantic selection equality and empty-selection construction.
- `useCompanyExplorerSelectionBridge.ts` publishes and consumes generic live selection for linked Editor and Kanban frames.
- `companyExplorerFolders.ts` owns folder/item types, permission-rule detection, subtree traversal, and scoped item lookup.

## Linking and selection

`frame-module-links-v1` is the one generic context-link graph. Explorer publishes selected entity IDs, tree IDs, folder context, intent, source frame, target frames, timestamp, and source-local sequence through `selectionCoordinator.ts`. Self-originated echoes are not stored for the source frame, newer intent wins, and no localStorage compatibility bridge is used.

## Verification

Focused coverage lives in `tests/frontend/modules/company-explorer`, `tests/frontend/modules/folders/companyExplorerFolders.test.ts`, `tests/frontend/modules/selectionCoordinator.test.ts`, and the Company Explorer backend HTTP/store suites.