# Parallel Agent Architecture

This document describes the codebase shape that supports 4-20 parallel Codex workers without turning integration into manual conflict repair.

The full execution plan lives in `docs/parallel-agent-refactor-handoff.md`. This file focuses on ownership boundaries and merge-collision reduction.

## Objective Function

MangoRTS is being designed for:

```text
- millions of companies
- millions of users and AI agents per company
- millions of UI elements and simultaneous background operations
- strict latency culture with sub-100ms targets
- strict robustness and reliability
- future headless AI-agent operation through APIs. This will be the main way entities will interact with MangoRTS in the future
- millions of AI agents using APIs concurrently
- AWS-hosted app and database infrastructure, with code written efficiently to minimize cloud cost
```

Default engineering rule:

```text
Find the simplest solution possible. Only increase complexity when needed.
Write code in an architecture where it would be possible for 20 agents to develop on this app simultaneously. (We have already been making efforts in this)
```

## Parallel Development Rule

Large host files are collision zones. Future work should land in focused hooks, helpers, leaf components, command files, tests, and docs instead of repeatedly editing shared integration files.

The 20-agent development rule is a product requirement, not just a workflow preference. Architecture choices should make it possible for many agents to work in parallel by keeping ownership explicit, avoiding catch-all files, and putting new behavior behind narrow module-local or domain-local boundaries.

The current hot files are:

```text
backend/internal/http/server.go
backend/internal/store/memory.go
backend/internal/store/postgres.go
frontend/src/app/applayout.tsx
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/kanban/KanbanContent.tsx
frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx
frontend/src/modules/node-map/NodeMapContent.tsx
```

Touching one of these files is allowed only when the change genuinely belongs in host orchestration. Every final report that touches a hot file must include:

```text
Hot file touched: <path>
Reason: <specific reason>
Why this did not belong in a leaf hook/helper/component: <specific reason>
```

Remaining Phase 2 work is intentionally collapsed into two more phases:

```text
Phase 2D: backend hot-file split
  - backend/internal/http/server.go
  - backend/internal/store/memory.go
  - backend/internal/store/postgres.go

Phase 2E: remaining frontend hot-file split
  - frontend/src/app/applayout.tsx
  - frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx
  - frontend/src/modules/node-map/NodeMapContent.tsx
  - frontend/src/modules/kanban/KanbanContent.tsx
```

Do not split these into additional named phases unless the user explicitly asks. Inside each phase, still work in the conservative order documented below.

## Target Frontend Shape

Host components should stay thin:

```text
host component
  reads high-level state
  wires focused hooks
  renders focused leaf components
  avoids owning broad domain logic directly
```

Domain behavior should live near the owning module and behind explicit contracts:

```text
module/
  useFocusedBehavior.ts
  FocusedLeaf.tsx
  moduleTypes.ts
  moduleCommands.ts when behavior should be reusable by UI and APIs
```

Avoid hidden cross-module authority. A module can publish a small bridge or command surface, but it should not reach into another module's internals.

## Backend Ownership

Backend files should be split by same-package domain ownership before deeper API/headless work. This is a collision-reduction move, not an architecture rewrite.

Rules:

- Keep packages stable first: `backend/internal/http` and `backend/internal/store`.
- Do not change route contracts, repository semantics, SQL behavior, transaction boundaries, or in-memory locking just to split files.
- Prefer same-package file moves over new packages until a real dependency boundary is clear.
- Keep common helpers small and avoid dumping unrelated helpers into a new catch-all file.

HTTP server target shape:

```text
backend/internal/http/server.go
backend/internal/http/http_helpers.go
backend/internal/http/map_layout_handlers.go
backend/internal/http/company_explorer_handlers.go
backend/internal/http/node_handlers.go
backend/internal/http/node_relationship_handlers.go
backend/internal/http/logic_gate_handlers.go
backend/internal/http/logic_gate_relationship_handlers.go
backend/internal/http/workspace_handlers.go
backend/internal/http/operation_handlers.go
backend/internal/http/kanban_handlers.go
```

`server.go` should own server construction and route registration. Domain handler files should own request parsing and response behavior for their endpoint families.

Store target shape:

```text
backend/internal/store/repository.go
backend/internal/store/memory.go
backend/internal/store/memory_nodes.go
backend/internal/store/memory_logic_gates.go
backend/internal/store/memory_kanban.go
backend/internal/store/memory_company_explorer.go
backend/internal/store/memory_operations.go
backend/internal/store/postgres.go
backend/internal/store/postgres_nodes.go
backend/internal/store/postgres_logic_gates.go
backend/internal/store/postgres_kanban.go
backend/internal/store/postgres_company_explorer.go
backend/internal/store/postgres_operations.go
```

`memory.go` and `postgres.go` should own repo construction and truly shared helpers. Domain files should let future workers change one persistence family without touching all persistence behavior.

Current Phase 2D split:

```text
backend/internal/http/server.go
backend/internal/http/http_helpers.go
backend/internal/http/map_layout_handlers.go
backend/internal/http/company_explorer_handlers.go
backend/internal/http/node_handlers.go
backend/internal/http/node_relationship_handlers.go
backend/internal/http/logic_gate_handlers.go
backend/internal/http/logic_gate_relationship_handlers.go
backend/internal/http/workspace_handlers.go
backend/internal/http/operation_handlers.go
backend/internal/http/kanban_handlers.go
backend/internal/store/repository.go
backend/internal/store/memory.go
backend/internal/store/memory_nodes.go
backend/internal/store/memory_logic_gates.go
backend/internal/store/memory_kanban.go
backend/internal/store/memory_company_explorer.go
backend/internal/store/memory_operations.go
backend/internal/store/postgres.go
backend/internal/store/postgres_nodes.go
backend/internal/store/postgres_logic_gates.go
backend/internal/store/postgres_kanban.go
backend/internal/store/postgres_company_explorer.go
backend/internal/store/postgres_operations.go
```

`server.go` now owns server construction, route registration, and health. HTTP request parsing and response behavior live in endpoint-family handler files.

`repository.go` now owns `Repository`, shared errors, operation input, Kanban query/input types, and shared validation/normalization helpers used by both memory and Postgres implementations.

`memory.go` and `postgres.go` now own repo structs and constructors. Domain persistence behavior lives in focused same-package files so future backend workers can change one API/storage family without opening every persistence method.

## App Layout Ownership

The app shell is also a collision zone. Keep `frontend/src/app/applayout.tsx` as high-level orchestration and move focused behavior into app-local files.

Target files:

```text
frontend/src/app/applayout.tsx
frontend/src/app/useFrameSelection.ts
frontend/src/app/useFrameLinking.ts
frontend/src/app/useFrameDragResize.ts
frontend/src/app/useFramePersistence.ts
frontend/src/app/FrameChrome.tsx
frontend/src/app/FrameCanvas.tsx
frontend/src/app/frameLayoutTypes.ts
```

Rules:

- Preserve frame selection, frame linking, resize/drag behavior, keyboard routing, and module registration.
- Do not redesign the dashboard workspace model during the split.
- Keep module-specific behavior inside modules, not app layout.

Current Phase 2E split:

```text
frontend/src/app/frameLayoutTypes.ts
frontend/src/app/useFramePersistence.ts
frontend/src/app/useFrameDragResize.ts
frontend/src/app/FrameChrome.tsx
```

`applayout.tsx` remains the dashboard shell state owner for tabs, frames, links, active selection, and module registration. Frame persistence, drag/resize mechanics, placement chrome, grid crosses, shared frame constants, and frame layout types now live in app-local files so visual shell changes do not expand the host.

## Company Explorer Ownership

Target files:

```text
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/company-explorer/useCompanyExplorerSelection.ts
frontend/src/modules/company-explorer/useCompanyExplorerDragDrop.ts
frontend/src/modules/company-explorer/useCompanyExplorerContextMenu.ts
frontend/src/modules/company-explorer/useCompanyExplorerKeyboard.ts
frontend/src/modules/company-explorer/CompanyExplorerTree.tsx
frontend/src/modules/company-explorer/CompanyExplorerTreeRow.tsx
frontend/src/modules/company-explorer/CompanyExplorerIcons.tsx
frontend/src/modules/company-explorer/companyExplorerTypes.ts
```

Rules:

- Keep selection authority explicit.
- Do not add peer-module localStorage authority for same-tab live selection.
- Keep Kanban, Node Map, and Logic Gate context bridges isolated behind named helpers.
- Keep imports stable by adding new behavior to leaf files.

Current Phase 2A split:

```text
frontend/src/modules/company-explorer/companyExplorerTypes.ts
frontend/src/modules/company-explorer/companyExplorerDragDrop.ts
frontend/src/modules/company-explorer/companyExplorerTreeRows.ts
frontend/src/modules/company-explorer/useCompanyExplorerVirtualTree.ts
frontend/src/modules/company-explorer/CompanyExplorerIcons.tsx
```

Current Phase 2B split:

```text
frontend/src/modules/company-explorer/CompanyExplorerTreeRow.tsx
frontend/src/modules/company-explorer/CompanyExplorerContextMenu.tsx
```

Phase 2C target:

```text
frontend/src/modules/company-explorer/useCompanyExplorerTreeModel.ts
frontend/src/modules/company-explorer/useCompanyExplorerSelectionBridge.ts
frontend/src/modules/company-explorer/useCompanyExplorerKeyboard.ts
frontend/src/modules/company-explorer/CompanyExplorerTree.tsx
```

Current Phase 2C split:

```text
frontend/src/modules/company-explorer/useCompanyExplorerTreeModel.ts
frontend/src/modules/company-explorer/useCompanyExplorerSelectionBridge.ts
frontend/src/modules/company-explorer/useCompanyExplorerKeyboard.ts
frontend/src/modules/company-explorer/CompanyExplorerTree.tsx
```

`CompanyExplorerContent.tsx` remains the explicit owner of selection state, CRUD operations, drag/drop operations, and context-menu commands. Tree derivation, viewport rendering, keyboard handling, and cross-module bridge mechanics now live in focused files so future workers can change those areas without reopening the host.

Future Explorer changes should prefer these files for row types, drag/drop payloads, tree construction, virtualization, row icons, row rendering, row drag/drop event wiring, context menu presentation, keyboard behavior, tree model derivation, and selection bridge mechanics. `CompanyExplorerContent.tsx` should remain the orchestration surface for wiring hooks together and passing module-level state across boundaries.

## Editor Ownership

Target files:

```text
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/editor/useEditorTabs.ts
frontend/src/modules/editor/useEditorPersistence.ts
frontend/src/modules/editor/useEditorOutlineStyle.ts
frontend/src/modules/editor/useEditorSelectionBridge.ts
frontend/src/modules/editor/EditorTabBar.tsx
frontend/src/modules/editor/EditorCanvas.tsx
frontend/src/modules/editor/EditorTextBox.tsx
frontend/src/modules/editor/editorTypes.ts
```

Rules:

- Editor document operations should move toward command-style functions.
- Keep local UI geometry separate from semantic document values.
- Keep persistence helpers small and testable.
- Do not place editor persistence, tab logic, and rendering changes in the same host block when they can be separated.

Current Phase 2A split:

```text
frontend/src/modules/editor/editorTypes.ts
frontend/src/modules/editor/useEditorPreferences.ts
frontend/src/modules/editor/EditorTabBar.tsx
frontend/src/modules/editor/EditorFormattingToolbar.tsx
```

Current Phase 2B split:

```text
frontend/src/modules/editor/EditorDocumentSurface.tsx
frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx
frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts
```

Future Editor changes should put document-save types/helpers in `editorTypes.ts`, local view preferences in `useEditorPreferences.ts`, textarea DOM/event behavior in `useEditorDocumentSurfaceHandlers.ts`, linked document panels in `EditorLinkedDocumentPanels.tsx`, and tab/format toolbar UI in the leaf components instead of growing `EditorContent.tsx`.

Phase 2C target:

```text
frontend/src/modules/editor/useEditorDocumentPersistence.ts
frontend/src/modules/editor/useEditorLinkedEntityLoader.ts
frontend/src/modules/editor/editorDocumentPersistence.ts
```

Phase 2C may extract durable document load/save queue behavior into focused hooks/helpers only if the extracted functions keep the same UI behavior and do not introduce a new backend/API command layer. The Phase 3 command/API pass should still own any durable contract redesign.

Current Phase 2C split:

```text
frontend/src/modules/editor/useEditorDocumentPersistence.ts
```

`EditorContent.tsx` still owns linked-entity loading, title sync, undo/redo orchestration, scroll restoration, and editor surface wiring. The debounce, flush, single-flight save queue, delete-empty-document behavior, and cache invalidation calls moved behind `useEditorDocumentPersistence.ts` without changing backend API contracts.

## Map Workspace Ownership

Node map and logic gate map behavior should be coordinated without either module importing the other's internals.

Target files:

```text
frontend/src/modules/map-workspace/MapWorkspace.tsx
frontend/src/modules/map-workspace/useMapWorkspaceState.ts
frontend/src/modules/map-workspace/useMapSelectionBridge.ts
frontend/src/modules/map-workspace/mapWorkspaceTypes.ts
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/node-map/NodeMapView.tsx
frontend/src/modules/logic-gates/LogicGateMapView.tsx
```

Shared contract:

```ts
type MapKind = "node-map" | "logic-gate-map";

type MapWorkspaceState = {
  activeMapKind: MapKind;
  selectedEntityId: string | null;
  viewport: ViewportState;
};
```

Rules:

- Node Map owns node rendering and node operations.
- Logic Gate Map owns gate rendering and gate operations.
- Map Workspace owns active map kind, viewport, and selection routing.
- Shared event contracts belong in `map-workspace` or shared runtime files.

Current Phase 2A split:

```text
frontend/src/modules/node-map/nodeMapRouting.ts
frontend/src/modules/node-map/NodeMapContextMenus.tsx
```

Current Phase 2B split:

```text
frontend/src/modules/node-map/NodeMapNodeCard.tsx
frontend/src/modules/node-map/useNodeMapViewportHandlers.ts
```

Phase 2C target:

```text
frontend/src/modules/node-map/NodeMapRelationshipHitLines.tsx
frontend/src/modules/node-map/useNodeMapGraphPersistence.ts
frontend/src/modules/node-map/useNodeMapSelectionBridge.ts
frontend/src/modules/node-map/useNodeMapRelationshipOperations.ts
```

Current Phase 2C split:

```text
frontend/src/modules/node-map/NodeMapRelationshipHitLines.tsx
frontend/src/modules/node-map/useNodeMapGraphPersistence.ts
```

Current Phase 2E split:

```text
frontend/src/modules/node-map/useNodeMapGraphLoader.ts
```

Current Phase 3 command boundary:

```text
frontend/src/modules/node-map/nodeMapCommands.ts
```

Future Node Map changes should keep relationship routing math in `nodeMapRouting.ts`, menu/dialog presentation in `NodeMapContextMenus.tsx`, node-card rendering and node-card interaction affordances in `NodeMapNodeCard.tsx`, viewport context menu/zoom/pan pointer wiring in `useNodeMapViewportHandlers.ts`, graph load/subscription mechanics in `useNodeMapGraphLoader.ts`, and relationship hit-line rendering/events in `NodeMapRelationshipHitLines.tsx`. `NodeMapContent.tsx` should keep orchestration only until Phase 3 extracts reusable commands for API/headless callers.

`NodeMapContent.tsx` remains the explicit owner of graph state, selection state, node operations, and folder scoping. The transparent SVG relationship hit-line event wiring moved to `NodeMapRelationshipHitLines.tsx`, browser/session viewport plus map-layout persistence moved to `useNodeMapGraphPersistence.ts`, graph snapshot load/subscription mechanics moved to `useNodeMapGraphLoader.ts`, and batch relationship-delete API fan-out plus partial-failure summary moved to `nodeMapCommands.ts`.

Remaining Node Map hot-file risk:

```text
frontend/src/modules/node-map/useNodeMapSelectionBridge.ts
frontend/src/modules/node-map/useNodeMapRelationshipOperations.ts
frontend/src/modules/node-map/useNodeMapNodeOperations.ts
frontend/src/modules/node-map/NodeMapCanvas.tsx
```

Keep the host as state owner until Phase 3. Move only focused mechanics that can receive explicit state and callbacks.

## Logic Gate Map Ownership

`LogicGateMapContent.tsx` is currently the largest frontend collision zone and should be brought to the same split standard as Node Map before shared map or command/API work begins.

Target files:

```text
frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx
frontend/src/modules/logic-gate-map/LogicGateMapNodeCard.tsx
frontend/src/modules/logic-gate-map/LogicGateMapContextMenus.tsx
frontend/src/modules/logic-gate-map/LogicGateMapRelationshipHitLines.tsx
frontend/src/modules/logic-gate-map/useLogicGateMapViewportHandlers.ts
frontend/src/modules/logic-gate-map/useLogicGateMapGraphPersistence.ts
frontend/src/modules/logic-gate-map/useLogicGateMapSelectionBridge.ts
frontend/src/modules/logic-gate-map/useLogicGateMapRelationshipOperations.ts
frontend/src/modules/logic-gate-map/logicGateMapRouting.ts
```

Rules:

- Preserve logic-gate relationship semantics, selection, delete, multi-select, scoped folder behavior, and Explorer/Editor bridge behavior.
- Prefer local logic-gate-map files first.
- Do not introduce a generic map engine until both map hosts are thinner and shared behavior is obvious.

Current Phase 2E split:

```text
frontend/src/modules/logic-gate-map/LogicGateMapNodeCard.tsx
frontend/src/modules/logic-gate-map/LogicGateMapContextMenus.tsx
frontend/src/modules/logic-gate-map/LogicGateMapRelationshipHitLines.tsx
frontend/src/modules/logic-gate-map/useLogicGateMapViewportHandlers.ts
frontend/src/modules/logic-gate-map/useLogicGateMapGraphPersistence.ts
frontend/src/modules/logic-gate-map/logicGateMapRouting.ts
```

`LogicGateMapContent.tsx` remains the explicit owner of graph state, gate and relationship CRUD, selection state, and folder scoping. Node card rendering, menu/dialog presentation, transparent relationship hit-lines, viewport context menu/zoom/pan pointer wiring, browser/session/map-layout persistence, and routing math now live in logic-gate-map local files.

## Kanban Ownership

`KanbanContent.tsx` should be split before broad Kanban API/headless work. The host should own orchestration while board/column/card rendering and operations move to focused files.

Target files:

```text
frontend/src/modules/kanban/KanbanContent.tsx
frontend/src/modules/kanban/KanbanBoardSidebar.tsx
frontend/src/modules/kanban/KanbanColumnView.tsx
frontend/src/modules/kanban/KanbanCardView.tsx
frontend/src/modules/kanban/useKanbanBoardLoader.ts
frontend/src/modules/kanban/useKanbanSelectionBridge.ts
frontend/src/modules/kanban/useKanbanDragDrop.ts
frontend/src/modules/kanban/useKanbanCardOperations.ts
frontend/src/modules/kanban/useKanbanColumnOperations.ts
```

Rules:

- Preserve board selection, column/card drag/drop, card multi-select, linked Explorer/Editor behavior, delete behavior, and color/size persistence.
- Keep API redesign out of this split; Phase 3 owns command/API boundaries.

Current Phase 2E split:

```text
frontend/src/modules/kanban/KanbanBoardSidebar.tsx
frontend/src/modules/kanban/KanbanColumnView.tsx
frontend/src/modules/kanban/KanbanCardView.tsx
```

Current Phase 3 command boundary:

```text
frontend/src/modules/kanban/kanbanCommands.ts
```

`KanbanContent.tsx` remains the explicit owner of board/card/column state, selection bridge behavior, confirmation modals, and drag/drop orchestration. Board sidebar presentation, board picker UI, column title/resize/card-drop rendering, and card rendering live in focused Kanban-local components. Durable column/card API workflows now route through `kanbanCommands.ts` so UI and future headless callers can share bounded write plans without growing the host.

## API And Headless Direction

The UI should become one client of reusable commands. Future workers should prefer:

```text
button click -> command/action -> state/API layer -> render result
```

over:

```text
button click -> mutate component-local state -> maybe emit event -> maybe sync later
```

Command-style boundaries should be:

- tenant scoped
- idempotent where retries are likely
- bulk-friendly for high-volume agents
- observable for p50, p95, p99 latency and errors
- careful with AWS request count, payload size, scans, and always-on compute

Do not add a command abstraction just to rename a helper. Add it when the behavior needs to be reused by UI and future headless APIs, or when it removes meaningful coupling from hot host files.

Current Phase 3 implementation:

```text
frontend/src/modules/kanban/kanbanCommands.ts
frontend/src/modules/node-map/nodeMapCommands.ts
tests/frontend/modules/kanban/kanbanCommands.test.ts
tests/frontend/modules/node-map/nodeMapCommands.test.ts
```

These are module-local command boundaries, not new generic frameworks. They preserve the existing HTTP contracts while making selected Kanban write workflows and Node Map relationship-delete semantics reusable outside browser UI events.

## Integration Contract

Worker branches must reconcile with latest `origin/main` before task work and before integration.

Integration branches are required because freshness alone does not prove that the worker merges cleanly with the current batch of work:

```text
codex/<worker> + latest origin/main -> integration/<worker-or-batch> -> clean gates -> main
```

Conflict markers must never remain in the tree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
```

Use the fastest relevant check first:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```

Run full tests when shared behavior changed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root . -Full
```
