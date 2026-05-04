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
- future headless AI-agent operation through APIs
- millions of AI agents using APIs concurrently
- AWS-hosted app and database infrastructure with cloud-cost discipline
```

Default engineering rule:

```text
Find the simplest solution possible. Only increase complexity when needed.
```

## Parallel Development Rule

Large host files are collision zones. Future work should land in focused hooks, helpers, leaf components, command files, tests, and docs instead of repeatedly editing shared integration files.

The current hot files are:

```text
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/node-map/NodeMapContent.tsx
```

Touching one of these files is allowed only when the change genuinely belongs in host orchestration. Every final report that touches a hot file must include:

```text
Hot file touched: <path>
Reason: <specific reason>
Why this did not belong in a leaf hook/helper/component: <specific reason>
```

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
