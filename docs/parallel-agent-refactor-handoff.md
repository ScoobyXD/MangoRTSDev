# Parallel Agent Refactor Handoff

This document is the source of truth for the next fresh Codex instances that will harden MangoRTS for reliable parallel agent development and long-term API-first scale.

Read this file before changing code for this program. If another document disagrees with this file about the parallel-agent refactor plan, stop and reconcile the docs first.

## Why This Exists

The current workflow runs several Codex instances at once from separate Git worktrees. Recent merges produced unresolved conflict markers in frontend source files, causing Vite/Babel parse failures. Screenshots showed raw Git markers such as `<<<<<<< HEAD`, `=======`, and `>>>>>>> codex/<branch>`.

These markers appeared inside large, high-churn files such as:

```text
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/node-map/NodeMapContent.tsx
```

The immediate issue is workflow safety. The deeper issue is that large integration files concentrate too many unrelated responsibilities, so multiple agents collide even when they are assigned different conceptual modules.

The goal is not to reduce the number of agents. The user wants to run up to 20 agents in parallel with minimal human orchestration. That is a hard requirement.

## Product And Engineering Objective Function

All future changes in this program must optimize for this operating principle:

```text
This startup is building B2B software for:
- millions of companies
- millions of users and AI agents per company
- millions of UI elements and simultaneous background operations
- strict latency culture with sub-100ms targets
- strict robustness and reliability
- future headless AI-agent operation through APIs. This will be the main way entities will interact with MangoRTS in the future
- millions of AI agents using APIs concurrently
- AWS-hosted app and database infrastructure, with code written efficiently to minimize cloud cost

Default engineering rule:
Find the simplest solution possible. Only increase complexity when needed.
Write code in an architecture where it would be possible for 20 agents to develop on this app simultaneously. (We have already been making efforts in this)
```

This principle has practical consequences:

- UI behavior must move toward command/API semantics, not UI-only local behavior.
- Hot reads must avoid N+1 patterns, unbounded fan-out, and expensive reconstruction loops.
- Shared frontend state must have explicit ownership to avoid event loops and stale writes.
- Backend APIs must be efficient, bulk-friendly, idempotent where appropriate, and friendly to headless agents.
- AWS cost matters. Avoid designs that multiply requests, scans, payload size, storage churn, or always-on compute without a measured reason.
- Parallel-agent workflow must be fast. The user is not willing to wait 30 minutes for every spin-up, merge, or integration.

## Non-Negotiable User Requirements

- Do not collapse back to one or two agents. The target is 4-20 parallel agents.
- Minimize human intervention. The user wants to copy/paste prepared prompts and let Codex instances orchestrate the work.
- Keep reliability high even with many agents.
- Do not push unless explicitly asked.
- Do not make broad unrelated refactors while resolving merge conflicts.
- Do not edit global Git config. Use per-command `safe.directory` for this Windows/sandbox setup.
- Prefer fast verification gates first, then run slower gates only when the change risk justifies it.
- Future phase work should be done by fresh Codex instances on this branch/worktree after reading this document and the progress log.

## Current Execution Plan

There are three distinct phases.

1. Phase 1: Make 20-agent work safer.
2. Phase 2: Split hot files and reduce merge collision zones.
3. Phase 3: Improve API/headless boundaries.

Do not jump straight into deep product refactors. Phase 1 must land first because it protects all later work from creating more conflict damage.

## Phase 1: Make 20-Agent Work Safer

### Purpose

Build the workflow rails that let many agents work in parallel without broken conflict markers or unreliable direct merges into `main`.

### Deliverables

Add or update docs and scripts so future agents can run the workflow by copy/pasting prompts.

Recommended files:

```text
docs/parallel-agent-refactor-handoff.md
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md
scripts/check_conflict_markers.ps1
scripts/agent_preflight.ps1
scripts/create_worker_worktree.ps1
scripts/create_integration_worktree.ps1
scripts/integrate_worker_branch.ps1
scripts/batch_integrate_worker_branches.ps1
scripts/fast_verify.ps1
```

If the repo already has overlapping scripts when Phase 1 starts, prefer updating the existing script instead of duplicating names.

### Core Workflow

The safe workflow is:

```text
main
  -> creates worker branches/worktrees
  -> workers make isolated changes
  -> temporary integration branch is created from latest main
  -> worker branch is merged into the integration branch
  -> conflicts are resolved in integration
  -> conflict-marker scan runs
  -> relevant fast tests run
  -> full tests run when risk requires it
  -> clean integration branch merges into main
```

The unsafe workflow is:

```text
worker branch -> direct merge into main with conflicts
```

That unsafe workflow is how raw conflict markers can land in `main`.

### Required Merge Gates

Every worker merge must pass these gates before `main` is updated:

1. Worktree status is inspected.
2. Worker branch is committed or confirmed clean.
3. Latest `main` is fetched and fast-forwarded.
4. Worker is merged into a temporary integration branch, not directly into `main`.
5. Conflict marker scan passes:

```powershell
rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
```

6. Relevant verification passes.
7. Final `git status --short --branch` is clean or only contains known unrelated files.

### Freshness Contract

Every worker, phase executor, composer, and integrator must reconcile with latest `origin/main` before doing meaningful work. Stale branches are one of the main causes of repeated conflict churn.

Use the right freshness strategy for the role:

```text
Main composer:
- fetch origin
- fast-forward local main to origin/main
- create new worker branches from updated main only

Worker agent:
- fetch origin before code changes
- bring the worker branch up to date with origin/main before starting the task
- prefer rebase for local unpushed worker branches
- use merge --no-ff origin/main if rebase is not safe or would rewrite shared work
- resolve freshness conflicts before doing task work

Integrator agent:
- fetch origin
- fast-forward main to origin/main
- confirm the worker is committed and clean
- reconcile the worker with latest origin/main before creating the integration result
- merge worker into a temporary integration branch, never directly into main first

Batch integrator:
- fetch origin
- fast-forward main to origin/main
- reconcile each worker with latest origin/main before merging it into the batch branch
- skip and report workers with heavy freshness conflicts instead of blocking the whole batch
```

Freshness is not a substitute for the integration branch. Even a fresh worker must still go through integration before `main` is updated.

### Verification Tiers

The workflow should be fast by default and stricter when needed.

Tier 0: instant safety checks

```text
git status --short --branch
git worktree list
rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
git diff --name-only
```

Tier 1: fast affected-area checks

```text
frontend changed: npm build or existing frontend type/build check
backend changed: go test focused package or backend tests
docs/scripts only: conflict scan plus script syntax/readability checks
```

Tier 2: full verification

```powershell
node scripts\run_all_tests.mjs
```

Use Tier 2 before final main merge for shared architecture, API contracts, schema changes, hot modules, or broad refactors. Do not run slow tests during simple worker spin-up.

### Windows And Sandbox Git Rules

This repo often appears as dubious ownership because the normal Windows user owns the repo and Codex shell commands may run as a sandbox user.

Use per-command safe directory:

```powershell
git -c safe.directory=C:/Users/Jonat/MangoOSDev -C C:/Users/Jonat/MangoOSDev status --short --branch
```

Do not run:

```powershell
git config --global --add safe.directory ...
```

For write-heavy Git commands in this environment, ask for escalation immediately when using Codex tools:

```text
git pull --ff-only origin main
git worktree add ...
git add -A
git commit
git fetch origin
git merge --ff-only origin/main
git merge --no-ff ...
Start-Process powershell.exe ...
```

### Suggested Script Behavior

#### `scripts/check_conflict_markers.ps1`

Purpose: fail fast if unresolved conflict markers are present.

Expected behavior:

```powershell
param(
  [string]$Root = "."
)

rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" $Root
if ($LASTEXITCODE -eq 0) {
  Write-Error "Conflict markers found. Resolve them before merging."
  exit 1
}
if ($LASTEXITCODE -eq 1) {
  Write-Host "No conflict markers found."
  exit 0
}
exit $LASTEXITCODE
```

Phase 1 should implement this for real, with PowerShell-compatible error handling.

#### `scripts/agent_preflight.ps1`

Purpose: print the state needed before creating workers or merging.

Expected output:

```text
repo path
current branch
git status --short --branch
git worktree list
git remote -v
recent local branches matching codex/* and integration/*
```

#### `scripts/create_worker_worktree.ps1`

Purpose: create a new worker worktree quickly.

Inputs:

```text
-Name "Company Explorer Drag Drop"
-MainPath "C:\Users\Jonat\MangoOSDev"
```

Rules:

- Slug the name: lowercase, spaces to hyphens, remove unsafe Git/path characters.
- Branch name: `codex/<slug>`
- Path: `..\MangoOSDev-<slug>`
- Fast-forward `main` from `origin/main` before creating.
- Start a visible PowerShell window in the new worktree.
- Do not run full tests during spin-up.

#### `scripts/create_integration_worktree.ps1`

Purpose: create a temporary integration branch/worktree from latest main.

Inputs:

```text
-Slug "company-explorer-drag-drop"
-MainPath "C:\Users\Jonat\MangoOSDev"
```

Rules:

- Branch name: `integration/<slug>`
- Path: `..\MangoOSDev-integration-<slug>`
- Base: latest local `main` after fast-forward from `origin/main`

#### `scripts/integrate_worker_branch.ps1`

Purpose: integrate exactly one worker branch safely.

Inputs:

```text
-WorkerBranch "codex/company-explorer-drag-drop"
-MainPath "C:\Users\Jonat\MangoOSDev"
```

Rules:

- Discover worker worktree with `git worktree list`.
- Commit worker changes if requested and safe.
- Create integration branch from latest `main`.
- Merge worker into integration branch.
- Stop for non-trivial conflicts or resolve straightforward conflicts only.
- Run conflict-marker scan.
- Run relevant verification.
- Merge integration branch into `main` only after clean gates.
- Never push.

#### `scripts/batch_integrate_worker_branches.ps1`

Purpose: integrate a related group of workers into a batch integration branch.

Example batches:

```text
integration/editor-batch
integration/map-batch
integration/company-explorer-batch
integration/backend-api-batch
```

Rules:

- Merge one worker at a time into the batch branch.
- Run conflict marker scan after each worker.
- Run fast affected checks after each worker.
- Run full verification before final merge to `main`.
- If a worker conflicts heavily, skip it and report the branch instead of blocking the whole batch.

### Phase 1 Acceptance Criteria

Phase 1 is complete when:

- The operating principle is documented.
- Hot files are documented.
- The integration branch workflow is documented.
- Conflict-marker scanning exists as a script.
- Worker and integration scripts exist or a clear minimal equivalent exists.
- Copy/paste prompts exist for worker, integrator, and batch integrator agents.
- The final Phase 1 response includes exact commands the user can run.

## Phase 2: Split Hot Files And Reduce Merge Collision Zones

### Purpose

Reduce the files where parallel agents collide. Do not change behavior just to make the code look nicer. Extract responsibilities so future work naturally lands in smaller owned files.

### Why Phase 2 Has Subphases

Phase 2 is intentionally split into small subphases because these files are high-risk shared hosts. A single large mechanical refactor would create a bigger merge and review risk than the conflict problem it is trying to solve.

Phase 2A made the first conservative split: shared types, helpers, routing math, virtualization, toolbar/menu pieces, and low-risk leaf UI were moved out first.

Phase 2B was added after review showed the host files were still too large for the desired 4-20 parallel-agent workflow. It moved bigger render/event surfaces out without starting Phase 3 API/headless redesign.

Phase 2C exists because the remaining concerns are still valid:

```text
CompanyExplorerContent.tsx still owns tree construction, selection authority, and bridge orchestration.
NodeMapContent.tsx still owns graph state, relationship operations, persistence, and SVG relationship hit-line event wiring.
EditorContent.tsx still owns durable document load/save queue behavior.
```

Phase 2C should continue splitting collision zones while preserving behavior. It must not redesign backend/API contracts or introduce a broad command layer; that belongs to Phase 3.

After Phase 2C, the same collision pattern was identified in backend and broader frontend hosts:

```text
backend/internal/http/server.go
backend/internal/store/memory.go
backend/internal/store/postgres.go
frontend/src/app/applayout.tsx
frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/kanban/KanbanContent.tsx
```

These should be split before Phase 3 if the team wants reliable 20-agent parallel work. This is still Phase 2 work: same behavior, same APIs, same packages/modules where practical, smaller ownership surfaces.

### Phase 2D: Backend Hot-File Split

Purpose: reduce backend merge collisions in `server.go`, `memory.go`, and `postgres.go` without changing API contracts or persistence behavior.

This is one backend phase, but it should still be executed conservatively in this order inside the phase:

1. Split `backend/internal/http/server.go`.
2. Split `backend/internal/store/memory.go`.
3. Split `backend/internal/store/postgres.go`.

Rules:

- Keep packages stable: `backend/internal/http` and `backend/internal/store`.
- Keep `Server`, `NewServer`, and `Routes` in `server.go`.
- Keep `MemoryRepo` and `PostgresRepo` construction in their base files.
- Keep the `Repository` interface and shared store query/input types in a small common file.
- Do not change route behavior, request payloads, response payloads, status codes, SQL semantics, transaction boundaries, in-memory locking behavior, or repository method contracts.
- Prefer same-package mechanical moves over new abstractions.

Backend HTTP target files:

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

Backend store target files:

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

Acceptance criteria:

- `server.go` is mostly construction and route registration.
- `memory.go` and `postgres.go` are mostly repo construction plus truly shared helpers.
- Each backend domain can be edited without touching unrelated backend domains.
- `go test ./...`, fast verification, and full tests pass.

### Phase 2E: Remaining Frontend Hot-File Split

Purpose: finish frontend collision-zone splitting before Phase 3 API/headless command work.

This is one frontend phase, but it should still be executed conservatively in this order inside the phase:

1. Split `frontend/src/app/applayout.tsx`.
2. Split `frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx`.
3. Finish the remaining `frontend/src/modules/node-map/NodeMapContent.tsx` split.
4. Split `frontend/src/modules/kanban/KanbanContent.tsx`.

Rules:

- Preserve dashboard behavior, module registration, frame selection/linking, resize/drag behavior, keyboard routing, map canvas behavior, relationship selection/delete behavior, multi-select behavior, scoped folder behavior, Kanban board/card behavior, and cross-module bridges.
- Keep selection authority explicit.
- Prefer focused hooks, helpers, and leaf components over shared engines.
- Do not create a generic map engine yet.
- Do not redesign frontend API/headless command boundaries; Phase 3 owns that.

App Layout candidate files:

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

Logic Gate Map candidate files:

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

Node Map remaining candidate files:

```text
frontend/src/modules/node-map/useNodeMapSelectionBridge.ts
frontend/src/modules/node-map/useNodeMapRelationshipOperations.ts
frontend/src/modules/node-map/useNodeMapNodeOperations.ts
frontend/src/modules/node-map/useNodeMapGraphLoader.ts
frontend/src/modules/node-map/NodeMapCanvas.tsx
```

Kanban candidate files:

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

Acceptance criteria:

- AppLayout, LogicGateMap, NodeMap, and Kanban hosts are readable orchestration surfaces.
- New frontend work can usually land in leaf files/hooks instead of hot hosts.
- Frontend build, fast verification, and full tests pass.

### Phase 2D-2E Execution Order

Run exactly two remaining Phase 2 executor prompts:

1. Phase 2D backend hot-file split.
2. Phase 2E remaining frontend hot-file split.

After each phase:

- Fetch `origin`.
- Check `origin/main...HEAD`.
- If behind and dirty, stop before rebase/merge and ask whether to create a local preservation commit.
- Run the conflict-marker scan.
- Run the fastest relevant verification.
- Run full tests for shared frontend/backend host splits.
- Update this progress log.

Phase 3 should start only after the active collision zones are thin enough that command/API work can land in new files rather than large hosts.

### Hot Files

These files are hot and must stay thin after the refactor:

```text
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/node-map/NodeMapContent.tsx
```

Future agents must not re-expand these files. Editing a hot file requires a clear reason in the final report.

### Why These Files Are Hot

Recent conflict screenshots showed failures in these areas:

- Import blocks at the top of the files.
- Hook setup sections.
- Shared selection/event wiring.
- Context menu logic.
- Drag/drop logic.
- JSX rendering blocks.
- Map selection transitions.
- Editor persistence and outline behavior.

Even when agents are assigned to different conceptual modules, they collide if they all edit the same large host files.

### Target Architecture

Host components should become thin orchestrators:

```text
host component
  reads high-level state
  wires focused hooks
  renders focused leaf components
  avoids owning broad domain logic directly
```

Domain behavior should live in focused hooks, helpers, and leaf components.

### Company Explorer Split

Target direction:

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
- Avoid growing the import block with unrelated domain imports.

### Editor Split

Target direction:

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

- Editor document operations should move toward command-style functions that can be called by UI or headless APIs.
- Local UI geometry should stay separate from semantic document values.
- Persistence helpers should be small and testable.

### Node Map And Logic Gate Map Split

The UI currently has one map experience that can show node maps or logic gate maps depending on selection. Separate module folders are acceptable and probably correct, but they need a shared coordinator.

Target direction:

```text
frontend/src/modules/map-workspace/MapWorkspace.tsx
frontend/src/modules/map-workspace/useMapWorkspaceState.ts
frontend/src/modules/map-workspace/useMapSelectionBridge.ts
frontend/src/modules/map-workspace/mapWorkspaceTypes.ts
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/node-map/NodeMapView.tsx
frontend/src/modules/logic-gates/LogicGateMapView.tsx
```

Shared concept:

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
- Avoid Node Map importing Logic Gate internals or Logic Gate Map importing Node Map internals.
- Shared event/selection contracts belong in map-workspace or shared runtime files, not in giant host components.

### Phase 2 Acceptance Criteria

Phase 2 is complete when:

- The three hot host files are smaller and intentionally thin.
- New behavior can usually be added to leaf files or hooks.
- Existing tests/build pass.
- Docs explain the hot-file split and warn future agents not to reverse it.
- The final response lists every hot file touched and why.

## Phase 3: Improve API And Headless Boundaries

### Purpose

Prepare MangoRTS for a future where headless AI agents interact through APIs as the primary interface. The UI should become one client of the domain command/API layer, not the only place behavior exists.

### Direction

Move user-visible operations toward command-style functions:

```ts
createKanbanBoard(command)
renameExplorerItem(command)
moveExplorerItem(command)
selectMapEntity(command)
updateEditorDocument(command)
createLogicGate(command)
connectLogicGateRelationship(command)
```

The UI should call commands/actions:

```text
button click -> command/action -> state/API layer -> render result
```

Avoid UI-only behavior:

```text
button click -> mutate component-local state -> maybe emit event -> maybe sync later
```

### API Requirements

Headless APIs should be:

- Authenticated and tenant-scoped.
- Idempotent where retries are likely.
- Bulk-friendly where agents may operate at high volume.
- Designed around projection/read models for hot reads.
- Clear about semantic command outcomes.
- Observable with p50/p95/p99 latency and error metrics.
- Efficient on AWS-hosted infrastructure.

### Cost Requirements

AWS cost must be considered in implementation choices:

- Avoid unnecessary polling.
- Avoid per-item API fan-out when bulk reads are possible.
- Avoid unbounded database scans.
- Keep payloads compact on hot paths.
- Prefer targeted reconciliation over blanket refreshes.
- Avoid always-on expensive infrastructure until measured need justifies it.
- Use cache/projection layers where they reduce repeated hot read cost.

### Reliability Requirements

Headless operation at high scale needs deterministic semantics:

- Explicit authority for each context type.
- Idempotency keys for retryable write APIs where appropriate.
- Monotonic sequence or version contracts for ordered updates.
- Scoped reconciliation on gaps.
- No infinite event echo loops.
- Backpressure and retry policies for background operations.
- Tests for command behavior independent of the UI.

### Phase 3 Acceptance Criteria

Phase 3 is complete when:

- At least the first critical UI operations are routed through reusable command/action boundaries.
- Docs explain how a headless agent would perform the same operations.
- Tests verify command behavior without needing browser UI interaction.
- Hot APIs avoid obvious N+1 and unbounded scan patterns.
- The final response names remaining UI-only workflows.

## Human-Minimal Orchestration Model

The user should not need to manually reason through worktree setup, branch naming, integration branches, or batching every time.

The intended operating model is:

1. User chooses a prepared prompt.
2. User fills in a small task name or branch slug.
3. Codex instance runs the preflight.
4. Codex creates or uses the correct worktree.
5. Codex makes or integrates changes.
6. Codex reports exact status and next copy/paste command.

If a script can make this reliable, add the script. If a prompt can make it reliable without script complexity, prefer the prompt. Find the simplest solution possible.

## Copy/Paste Prompts

These prompts are intentionally detailed so the user can paste them into new Codex instances with minimal thought.

### Prompt: Phase 1 Executor

```text
You are a fresh Codex instance working in MangoOSDev.

Read this file first:
docs/parallel-agent-refactor-handoff.md

Your job is to complete Phase 1 only: make 20-agent work safer.

Do not start Phase 2 frontend hot-file splitting yet.
Do not start Phase 3 API/headless refactoring yet.
Do not push.
Do not edit global Git config.

Implement the smallest useful set of docs/scripts that provides:
- documented operating principle
- documented hot-file architecture rules
- conflict-marker scan script
- worker worktree creation workflow
- integration worktree workflow
- single-worker integration workflow
- batch integration workflow
- copy/paste prompts for worker, integrator, and batch integrator agents
- fast verification guidance

This Windows repo may be owned by the normal user while Codex runs as a sandbox user.
Use per-command safe.directory instead of global Git config.
Request escalation immediately for write-heavy Git commands if needed.

Before editing, inspect:
- git status --short --branch using per-command safe.directory if needed
- docs structure
- scripts structure

Before editing, also ensure this branch includes latest main:
- if existing handoff/docs changes are uncommitted, preserve them with a clear local commit before rebasing or merging
- git fetch origin
- bring this branch up to date with origin/main, preferring rebase if safe and merge if rebase is not appropriate
- resolve conflicts conservatively
- run the conflict-marker scan
- only then execute Phase 1

Before final, run:
- scripts conflict-marker scan if implemented
- the fastest relevant verification for docs/scripts changes

Final response must include:
- files changed
- scripts added/updated
- exact commands the user can run
- tests/checks run and result
- final git status --short --branch
- next recommended prompt for Phase 2
```

### Prompt: Worker Agent

```text
You are a MangoRTS worker agent.

Task:
<describe task>

Owned files/modules:
<list owned files or module directories>

Read before changing code:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md if it exists
- docs/parallel-agent-architecture.md if it exists
- relevant docs/frontend/modules/*.md for your module

Before changing code, apply the worker freshness contract:
1. Inspect:
   - git status --short --branch
   - git worktree list
   - git remote -v
2. Fetch latest main:
   - git fetch origin
3. Bring this worker branch up to date with latest main before editing:
   - preferred for local unpushed worker branches: git rebase origin/main
   - fallback if rebase is not safe: git merge --no-ff origin/main
4. Resolve freshness conflicts before starting the assigned task.
5. Run:
   - rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
6. Only start the assigned work after the branch is clean and current.

Rules:
- Do not push.
- Do not edit global Git config.
- Do not broaden the task.
- Prefer focused hooks, helpers, and leaf components over expanding large host components.
- Do not edit hot files unless necessary:
  - frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
  - frontend/src/modules/editor/EditorContent.tsx
  - frontend/src/modules/node-map/NodeMapContent.tsx
- If you edit a hot file, explain exactly why in your final response.
- Preserve the operating principle: sub-100ms latency culture, reliability, API/headless future, AWS cost efficiency, simplest solution possible, and code architecture that can support 20 agents developing simultaneously.

Before final:
- run rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
- run the fastest relevant verification for your changed area
- report every file changed
- report any hot file touched
- report tests/checks run and result
```

### Prompt: Main Composer To Create Worker

```text
You are my Codex CLI composer in main for MangoRTS.

Create a new git worktree for a Codex worker from main.

Worker name:
<worker name>

Use this workflow:
1. Read docs/parallel-agent-refactor-handoff.md and docs/parallel-agent-workflow.md if present.
2. Run preflight:
   - git status --short --branch
   - git worktree list
   - git remote -v
3. Slug the worker name for Git refs and paths:
   - lowercase
   - replace spaces with hyphens
   - remove unsafe ref/path characters
4. Make sure main is up to date with origin/main before creating the worker:
   - git fetch origin
   - git pull --ff-only origin main
5. Create the worktree:
   - branch name: codex/<slug>
   - path: ..\MangoOSDev-<slug>
   - command: git worktree add -b "codex/<slug>" "..\MangoOSDev-<slug>" main
6. Start a new visible PowerShell window from that new worktree.
7. Print the worker prompt to paste into that new Codex instance.

Important Windows/sandbox rule:
For this workflow, request escalation immediately for write-heavy/local-machine commands:
- git fetch origin
- git pull --ff-only origin main
- git worktree add ...
- Start-Process powershell.exe ...

Do not push.
Do not edit global Git config.
```

### Prompt: Integrator Agent For One Worker

```text
You are the MangoRTS integration agent.

Read first:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md if present
- docs/parallel-agent-architecture.md if present

Worker branch:
codex/<branch-slug>

Your job:
Integrate exactly one worker branch into a temporary integration branch.
Do not merge the worker directly into main first.

Rules:
- Do not push.
- Do not edit global Git config.
- Use per-command safe.directory for worktrees when needed.
- Resolve only conflicts caused by this worker branch.
- Do not make broad refactors during integration.
- If conflicts are non-trivial, resolve conservatively and document the reasoning.
- Never leave conflict markers.

Workflow:
1. From main worktree, inspect:
   - git status --short --branch
   - git worktree list
   - git remote -v
2. Discover the worker worktree with git worktree list.
3. Inspect worker status.
4. If worker has changes, commit all worker-branch changes with a clear commit message.
5. Confirm worker branch is clean.
6. On main:
   - git fetch origin
   - git merge --ff-only origin/main
7. Reconcile worker with latest origin/main before creating the integration result:
   - preferred for local unpushed worker branches: git rebase origin/main
   - fallback if rebase is not safe: git merge --no-ff origin/main
   - resolve freshness conflicts conservatively
   - run rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
   - confirm worker branch is clean again
8. Create integration branch/worktree from latest main:
   - branch: integration/<branch-slug>
   - path: ..\MangoOSDev-integration-<branch-slug>
9. In integration worktree:
   - git merge --no-ff codex/<branch-slug> -m "Integrate codex/<branch-slug>"
10. Resolve straightforward conflicts only.
11. Run:
   - rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
12. Run relevant fast verification.
13. Run full verification if the change touches shared architecture, hot files, backend APIs, schema, or core state:
   - node scripts\run_all_tests.mjs
14. If clean, merge integration branch into main:
   - git merge --no-ff integration/<branch-slug> -m "Merge integration/<branch-slug>"
15. Stop before pushing.

Final response must include:
- worker branch
- worker commit SHA
- integration branch
- integration commit SHA
- final main merge commit SHA if created
- conflict files resolved
- tests/checks run and pass/fail
- final git status --short --branch
- unrelated files left untouched
- any new DB migration/schema script required, or state that none is required
```

### Prompt: Batch Integrator Agent

```text
You are the MangoRTS batch integration agent.

Read first:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md if present
- docs/parallel-agent-architecture.md if present

Batch name:
<batch-name>

Worker branches:
- codex/<branch-1>
- codex/<branch-2>
- codex/<branch-3>

Your job:
Integrate these related worker branches into one temporary batch integration branch, then merge the clean batch result into main.

Rules:
- Do not push.
- Do not edit global Git config.
- Use per-command safe.directory when needed.
- Merge workers into the batch branch one at a time.
- After each worker merge, run conflict-marker scan.
- If a worker has heavy conflicts, skip that worker, keep the batch moving, and report it.
- Do not make broad refactors during conflict resolution.

Workflow:
1. Update main with origin/main by fast-forward only:
   - git fetch origin
   - git merge --ff-only origin/main
2. Create:
   - branch: integration/<batch-name>
   - path: ..\MangoOSDev-integration-<batch-name>
3. For each worker branch:
   - inspect worker status
   - commit worker changes if needed
   - reconcile the worker with latest origin/main before merging:
     - preferred for local unpushed worker branches: git rebase origin/main
     - fallback if rebase is not safe: git merge --no-ff origin/main
   - resolve freshness conflicts conservatively
   - run rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
   - if freshness conflicts are heavy, skip the worker and report it
   - merge worker into batch integration branch
   - resolve straightforward conflicts
   - run rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
   - run fast affected verification
4. After all included workers are merged:
   - run node scripts\run_all_tests.mjs if available or required by risk
5. Merge clean batch integration branch into main.
6. Stop before pushing.

Final response must include:
- included worker branches
- skipped worker branches and why
- conflict files resolved
- batch integration commit SHA
- final main merge commit SHA if created
- tests/checks run and pass/fail
- final git status --short --branch
```

### Prompt: Phase 2 Executor

```text
You are a fresh Codex instance working in MangoOSDev.

Read this file first:
docs/parallel-agent-refactor-handoff.md

Your job is to complete Phase 2 only: split hot files and reduce merge collision zones.

Do not start Phase 3 API/headless refactoring yet except where a tiny extraction naturally preserves behavior.
Do not push.
Do not edit global Git config.

Start by inspecting the current code after Phase 1:
- git status --short --branch using per-command safe.directory if needed
- frontend/src/modules/company-explorer
- frontend/src/modules/editor
- frontend/src/modules/node-map
- frontend/src/modules/logic-gates if present
- existing tests and docs for those modules

Before editing, apply the phase freshness contract:
- if existing Phase 1 changes are uncommitted, preserve them with a clear local commit before rebasing or merging
- git fetch origin
- bring this branch up to date with origin/main, preferring rebase if safe and merge if rebase is not appropriate
- resolve conflicts conservatively
- run the conflict-marker scan
- only then start Phase 2

Refactor conservatively:
- preserve behavior
- extract focused hooks/helpers/components
- keep hot host files thin
- do not invent large abstractions
- add comments only where a junior engineer needs orientation
- update docs for every behavior/architecture change

Before final:
- run conflict-marker scan
- run relevant frontend build/tests
- run full tests if shared behavior changed

Final response must include:
- hot files touched and why
- new files added
- behavior preserved
- tests/checks run and result
- remaining hot-file risks
- next recommended prompt for Phase 3
```

### Prompt: Phase 2C Executor

```text
You are a fresh Codex instance working in MangoOSDev on branch codex/conflict-fixer.

Phase 1, Phase 2A, and Phase 2B were already implemented locally on this branch and were not pushed.

Read first:
docs/parallel-agent-refactor-handoff.md

Also read:
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md

Your job is Phase 2C only: keep splitting remaining hot-file collision zones.

Do not start Phase 3 API/headless command refactoring yet except where a tiny extraction naturally preserves behavior.
Do not push.
Do not edit global Git config.
Do not merge this branch into main just to continue.

Before editing:
1. Inspect:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD

2. Fetch origin:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin

3. Re-check freshness:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD

4. If the branch is behind origin/main, bring it up to date before Phase 2C:
   preferred because this branch is local/unpushed:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rebase origin/main

   fallback only if rebase is unsafe:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge --no-ff origin/main

5. Resolve conflicts conservatively if any.

6. Run:
   powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .

Only then start Phase 2C.

Golden rule:
This startup is building B2B software for millions of companies, millions of users and AI agents per company, millions of UI elements and simultaneous background operations, strict sub-100ms latency culture, strict reliability, future headless AI-agent API operation, and AWS cost discipline.

Default engineering rule:
Find the simplest solution possible. Only increase complexity when needed.
Write code in an architecture where it would be possible for 20 agents to develop on this app simultaneously. (We have already been making efforts in this)

Hot files:
- frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
- frontend/src/modules/editor/EditorContent.tsx
- frontend/src/modules/node-map/NodeMapContent.tsx

Phase 2C focus:

1. Company Explorer:
   - Extract tree model derivation, keyboard behavior, and selection bridge helpers where behavior can be preserved.
   - Candidate files:
     frontend/src/modules/company-explorer/useCompanyExplorerTreeModel.ts
     frontend/src/modules/company-explorer/useCompanyExplorerSelectionBridge.ts
     frontend/src/modules/company-explorer/useCompanyExplorerKeyboard.ts
     frontend/src/modules/company-explorer/CompanyExplorerTree.tsx
   - Keep selection authority explicit.
   - Do not reintroduce peer-module localStorage authority.
   - Do not hide cross-module bridge behavior in generic utilities.

2. Node Map:
   - Extract SVG relationship hit-line rendering/event wiring.
   - Extract focused graph persistence or selection bridge hooks only where the host can pass explicit state and callbacks.
   - Candidate files:
     frontend/src/modules/node-map/NodeMapRelationshipHitLines.tsx
     frontend/src/modules/node-map/useNodeMapGraphPersistence.ts
     frontend/src/modules/node-map/useNodeMapSelectionBridge.ts
     frontend/src/modules/node-map/useNodeMapRelationshipOperations.ts
   - Preserve canvas behavior, relationship selection, delete behavior, multi-select behavior, and scoped folder behavior.
   - Do not create a new command/API layer yet.

3. Editor:
   - Extract durable document load/save queue behavior into focused hooks/helpers if it can be done without changing API contracts.
   - Candidate files:
     frontend/src/modules/editor/useEditorDocumentPersistence.ts
     frontend/src/modules/editor/useEditorLinkedEntityLoader.ts
     frontend/src/modules/editor/editorDocumentPersistence.ts
   - Keep autosave, flush-on-blur, undo/redo, scroll restoration, linked node/logic-gate loading, and cache invalidation behavior unchanged.
   - Do not redesign backend document commands yet.

Refactor conservatively:
- preserve behavior
- keep host files thinner
- prefer focused hooks/helpers/components over large abstractions
- keep imports stable and local to each module
- update docs for architecture/progress changes
- add focused tests only if behavior moves into pure helpers or risk increases

Before final:
- run powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
- run powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
- run node scripts\run_all_tests.mjs because these are shared hot-module changes

Final response must include:
- hot files touched and why
- new files added
- behavior preserved
- tests/checks run and result
- remaining hot-file risks
- whether Phase 3 can now start or whether another Phase 2 split is still warranted
- next recommended prompt for Phase 3 only if Phase 2 collision risk is low enough
```

### Prompt: Phase 2D Backend Hot-File Split Executor

```text
You are a fresh Codex instance working in MangoOSDev on branch codex/conflict-fixer.

Workspace:
C:\Users\Jonat\MangoOSDev-conflict-fixer

Read first:
docs/parallel-agent-refactor-handoff.md
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md

Your job is Phase 2D only: split backend hot files into same-package domain files to reduce merge collisions.

Do not start Phase 3 API/headless command refactoring.
Do not change route behavior, request payloads, response payloads, status codes, repository semantics, or frontend contracts.
Do not change SQL semantics, transaction boundaries, in-memory locking behavior, or repository method contracts.
Do not push.
Do not edit global Git config.
Do not merge this branch into main just to continue.
Do not revert existing uncommitted Phase 2 work.

Before editing:
1. Inspect:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD

2. Fetch origin:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin

3. Re-check freshness:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge-base origin/main HEAD

4. Merge-compatibility decision:
   - If the left/right count is 0 N and merge-base equals origin/main, current origin/main is already the base for this branch; do not merge.
   - If the branch is behind origin/main and the worktree is dirty, stop and ask before creating a local preservation commit.
   - Do not stash/drop/revert silently.

5. Run:
   powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .

Only then start Phase 2D.

Scope:
- backend/internal/http/server.go
- backend/internal/store/memory.go
- backend/internal/store/postgres.go
- new same-package backend/internal/http/*_handlers.go files
- new same-package backend/internal/store/* domain files
- docs only as needed for progress/architecture notes

Backend HTTP target split:
- keep Server, NewServer, Routes, and route registration in server.go
- move generic JSON/error helpers to http_helpers.go
- move map layout endpoints to map_layout_handlers.go
- move company explorer endpoints to company_explorer_handlers.go
- move node endpoints to node_handlers.go
- move node relationship endpoints to node_relationship_handlers.go
- move logic gate endpoints to logic_gate_handlers.go
- move logic gate relationship endpoints to logic_gate_relationship_handlers.go
- move workspace snapshot/stream/event hub endpoints to workspace_handlers.go
- move operation endpoints to operation_handlers.go
- move kanban endpoints to kanban_handlers.go

Backend store target split:
- keep Repository interface and shared store query/input types in repository.go
- keep MemoryRepo struct/construction and truly shared helpers in memory.go
- keep PostgresRepo struct/construction and truly shared helpers in postgres.go
- move MemoryRepo node behavior to memory_nodes.go
- move MemoryRepo logic gate behavior to memory_logic_gates.go
- move MemoryRepo kanban behavior to memory_kanban.go
- move MemoryRepo company explorer behavior to memory_company_explorer.go
- move MemoryRepo operation behavior to memory_operations.go
- move PostgresRepo node behavior to postgres_nodes.go
- move PostgresRepo logic gate behavior to postgres_logic_gates.go
- move PostgresRepo kanban behavior to postgres_kanban.go
- move PostgresRepo company explorer behavior to postgres_company_explorer.go
- move PostgresRepo operation behavior to postgres_operations.go

Refactor conservatively:
- same package only
- mechanical moves first
- keep imports minimal
- preserve comments where they explain behavior
- no new abstraction unless needed to keep moved code compiling
- run `go test ./...` after the HTTP split before continuing to store files if the split is non-trivial

Before final:
- run powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
- run go test ./...
- run powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
- run node scripts\run_all_tests.mjs because this is shared backend API surface

Final response must include:
- hot backend file touched and why
- new files added
- behavior preserved
- tests/checks run and result
- merge/freshness compatibility result against origin/main
- remaining backend hot-file risks
- next recommended prompt: Phase 2E remaining frontend hot-file split
```

### Prompt: Phase 3 Executor

```text
You are a fresh Codex instance working in MangoOSDev on branch codex/conflict-fixer.

Workspace:
C:\Users\Jonat\MangoOSDev-conflict-fixer

Read first:
docs/parallel-agent-refactor-handoff.md
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md
docs/latency-obsession-architecture.md

Your job is to complete Phase 3 only: improve API/headless boundaries.

Sacred text:
This startup is building B2B software for:
- millions of companies
- millions of users and AI agents per company
- millions of UI elements and simultaneous background operations
- strict latency culture with sub-100ms targets
- strict robustness and reliability
- future headless AI-agent operation through APIs. This will be the main way entities will interact with MangoRTS in the future
- millions of AI agents using APIs concurrently
- AWS-hosted app and database infrastructure, with code written efficiently to minimize cloud cost

Default engineering rule:
Find the simplest solution possible. Only increase complexity when needed.
Write code in an architecture where it would be possible for 20 agents to develop on this app simultaneously. (We have already been making efforts in this)

Do not push.
Do not edit global Git config.
Do not broaden Phase 3 into unrelated UI redesign.
Do not revert existing uncommitted Phase 2 work.
Do not change API contracts casually; every contract change must be explicitly justified by the headless/API boundary goal and covered by tests/docs.

Start by inspecting:
- current backend API routes
- frontend command/action patterns
- module docs
- tests
- latency architecture docs

Before editing, apply the phase freshness contract:
1. Inspect:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD

2. Fetch origin:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin

3. Re-check freshness:
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
   git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge-base origin/main HEAD

4. Merge-compatibility decision:
   - If the left/right count is 0 N and merge-base equals origin/main, current origin/main is already the base for this branch; do not merge.
   - If the branch is behind origin/main and the worktree is dirty, stop and ask before creating a local preservation commit.
   - Do not stash/drop/revert silently.

5. Run:
   powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .

Only then start Phase 3.

Move critical UI workflows toward reusable command/action boundaries that can later be called by headless APIs and AI agents.

Recommended first targets:
- extract focused command/action helpers for durable UI workflows still owned by hot hosts
- prefer module-local command files or backend endpoint-family files over growing hot host files
- add command tests that exercise behavior without browser UI interaction
- update module docs to explain equivalent headless/API workflows

Rules:
- simplest solution possible; only increase complexity when needed
- preserve the 20-agent development architecture by landing work in focused files with clear ownership
- avoid broad rewrites and generic frameworks unless they remove real coupling
- avoid N+1 and unbounded scans
- keep AWS cost efficiency in mind
- add focused tests for command behavior
- update docs
- keep selection/state authority explicit
- preserve existing frontend/backend behavior unless the contract change is the Phase 3 deliverable

Before final:
  powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
  npm.cmd run build
  git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer diff --check
  powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
  node scripts\run_all_tests.mjs

If Vite/esbuild fails with spawn EPERM under the sandbox, rerun the same verification with escalation instead of treating it as a code failure.

Before final, update:
- docs/parallel-agent-refactor-handoff.md with Phase 3 progress
- docs/parallel-agent-architecture.md and affected module docs with new command/API ownership boundaries

Final response must include:
- command/API boundaries added
- headless workflows improved
- hot files touched and why
- behavior preserved or contracts intentionally changed
- tests/checks run and result
- merge/freshness compatibility result against origin/main
- remaining UI-only workflows
- next recommended work
```

## Manual Integration Commands

Use these when scripts are not available yet.

Create an integration branch for one worker:

```powershell
cd C:\Users\Jonat\MangoOSDev
git -c safe.directory=C:/Users/Jonat/MangoOSDev status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev merge --ff-only origin/main

$slug = "company-explorer-refactor"
$integration = "integration/$slug"
$path = "..\MangoOSDev-integration-$slug"

git -c safe.directory=C:/Users/Jonat/MangoOSDev worktree add -b $integration $path main
cd $path
git -c safe.directory=$((Resolve-Path .).Path.Replace('\','/')) merge --no-ff "codex/$slug" -m "Integrate codex/$slug"
rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
node scripts\run_all_tests.mjs
```

Merge clean integration into main:

```powershell
cd C:\Users\Jonat\MangoOSDev
git -c safe.directory=C:/Users/Jonat/MangoOSDev merge --no-ff "integration/company-explorer-refactor" -m "Merge integration/company-explorer-refactor"
git -c safe.directory=C:/Users/Jonat/MangoOSDev status --short --branch
```

## Branch And Worktree Naming

Use predictable names:

```text
Worker branch:       codex/<slug>
Worker worktree:     ..\MangoOSDev-<slug>
Integration branch:  integration/<slug>
Integration tree:    ..\MangoOSDev-integration-<slug>
Batch branch:        integration/<domain>-batch
Batch tree:          ..\MangoOSDev-integration-<domain>-batch
```

Slug rule:

```text
lowercase
spaces to hyphens
letters, numbers, hyphens only
trim repeated hyphens
```

## Conflict Resolution Policy

When resolving conflicts:

- Understand both sides before editing.
- Preserve intentional behavior from both branches when possible.
- Resolve imports carefully; import conflicts are a major pattern here.
- Run the conflict-marker scan immediately after resolution.
- Do not use a conflict as an excuse for broad cleanup.
- If the conflict is in a hot file, prefer resolving by moving code into focused helper files when that is small and obviously safe.
- If resolution requires product judgment, stop and ask.

## Hot File Contract For Future Agents

The hot files are intentionally being split. Do not reverse the architecture by dumping new logic back into them.

Required final-report line for any worker touching a hot file:

```text
Hot file touched: <path>
Reason: <specific reason>
Why this did not belong in a leaf hook/helper/component: <specific reason>
```

Preferred behavior:

- Add new logic to focused hook/helper/component files.
- Keep import blocks stable.
- Keep host JSX small.
- Keep event bridge logic behind named helpers.
- Keep UI components stateless where practical.

## Progress Log Protocol

Every fresh Codex instance working on this program must update this section or a linked progress doc before finishing.

Each entry should include:

```text
Date:
Phase:
Branch/worktree:
Files changed:
Commands/checks run:
What changed:
What was intentionally not changed:
Risks:
Next recommended prompt:
```

### 2026-05-04 - Phase 1 Workflow Rails Implemented

Phase: Phase 1.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-refactor-handoff.md
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md
scripts/parallel_agent_common.ps1
scripts/check_conflict_markers.ps1
scripts/agent_preflight.ps1
scripts/create_worker_worktree.ps1
scripts/create_integration_worktree.ps1
scripts/integrate_worker_branch.ps1
scripts/batch_integrate_worker_branches.ps1
scripts/fast_verify.ps1
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rebase origin/main
rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\agent_preflight.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```

What changed:

- Preserved the pre-Phase 1 handoff docs in a local docs commit before updating from `origin/main`.
- Rebasing this branch onto latest `origin/main` completed without conflicts.
- Added workflow docs with copy/paste commands for worker creation, integration worktrees, one-worker integration, batch integration, and verification tiers.
- Added architecture docs documenting the operating principle, hot-file contract, module ownership targets, map-workspace ownership, and API/headless direction.
- Added PowerShell scripts for conflict-marker scanning, preflight reporting, worker worktree creation, integration worktree creation, one-worker integration, batch integration, and fast affected verification.
- Updated script examples to use per-process `powershell -ExecutionPolicy Bypass -File ...` because this Windows shell blocks direct `.ps1` execution.

What was intentionally not changed:

- No frontend hot-file splitting was started.
- No backend API/headless refactor was started.
- No global Git config was edited.
- No push was performed.
- The Phase 1 workflow scripts were not used to create or merge any new worker/integration worktrees during this implementation.

Risks:

- The integration scripts are intentionally conservative, but they should be exercised on a low-risk worker branch before relying on them for a large batch.
- `fast_verify.ps1` runs full frontend/backend checks only when affected paths are detected or `-Full` is provided; integrators still need judgment for broad behavioral changes.

Next recommended prompt:

Use the "Prompt: Phase 2 Executor" section in this document from a fresh Codex instance after reviewing `docs/parallel-agent-workflow.md` and `docs/parallel-agent-architecture.md`.

### 2026-05-04 - Phase 2A Hot-File Split Implemented

Phase: Phase 2A.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/company-explorer/CompanyExplorerIcons.tsx
frontend/src/modules/company-explorer/companyExplorerDragDrop.ts
frontend/src/modules/company-explorer/companyExplorerTreeRows.ts
frontend/src/modules/company-explorer/companyExplorerTypes.ts
frontend/src/modules/company-explorer/useCompanyExplorerVirtualTree.ts
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/editor/EditorFormattingToolbar.tsx
frontend/src/modules/editor/EditorTabBar.tsx
frontend/src/modules/editor/editorTypes.ts
frontend/src/modules/editor/useEditorPreferences.ts
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/node-map/NodeMapContextMenus.tsx
frontend/src/modules/node-map/nodeMapRouting.ts
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
npm.cmd install
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```

What changed:

- Split Company Explorer row types, drag/drop helpers, tree construction, virtualization, and icons out of `CompanyExplorerContent.tsx`.
- Split Editor document-save types/helpers, local preference persistence, tab bar UI, and formatting toolbar UI out of `EditorContent.tsx`.
- Split Node Map relationship routing math and context-menu/dialog presentation out of `NodeMapContent.tsx`.
- Preserved behavior by keeping host state/effects and cross-module selection/event bridges in the existing host components.

What was intentionally not changed:

- No Phase 3 command/API/headless boundary refactor was started.
- No Node Map/Logic Gate Map workspace coordinator was introduced yet.
- No push was performed.
- No global Git config was edited.

Risks:

- `CompanyExplorerContent.tsx` and `NodeMapContent.tsx` still contain large render/event sections that future workers can split further, especially tree rows and node cards.
- `EditorContent.tsx` still owns textarea edit behavior and persistence orchestration; Phase 3 should move durable document operations toward reusable commands before broad UI changes.

Why this phase existed:

Phase 2A was intentionally limited to the first conservative split: it reduced the most obvious helper/render collisions while keeping host orchestration intact for behavior safety.

Next recommended prompt:

Use the "Prompt: Phase 2C Executor" section in this document if Phase 2B has already landed and the host files are still too large for 4-20 parallel agents. Otherwise continue with "Prompt: Phase 2 Executor".

### 2026-05-04 - Phase 2B Hot-File Split Extended

Phase: Phase 2B.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/company-explorer/CompanyExplorerContextMenu.tsx
frontend/src/modules/company-explorer/CompanyExplorerTreeRow.tsx
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/editor/EditorDocumentSurface.tsx
frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx
frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/node-map/NodeMapNodeCard.tsx
frontend/src/modules/node-map/useNodeMapViewportHandlers.ts
```

Commands/checks run:

```text
npm.cmd run build
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer diff --check
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

What changed:

- Moved Company Explorer row rendering, rename input rendering, row drag/drop event wiring, and context menu presentation out of `CompanyExplorerContent.tsx`.
- Moved Editor linked-document surface rendering, linked metadata/history/title panels, and textarea DOM/event handlers out of `EditorContent.tsx`.
- Moved Node Map node-card rendering/interaction controls and viewport context menu/zoom/pan pointer wiring out of `NodeMapContent.tsx`.
- Kept host components responsible for state, persistence queues, cross-module event bridges, and durable operations; no Phase 3 command/API boundary was introduced.

What was intentionally not changed:

- No backend API/headless command refactor was started.
- No Node Map/Logic Gate Map workspace coordinator was introduced.
- No push was performed.
- No global Git config was edited.

Risks:

- `CompanyExplorerContent.tsx` still owns tree construction effects, selection authority, and cross-module bridge calls; future workers should avoid editing it unless they are changing orchestration.
- `NodeMapContent.tsx` still owns graph state, relationship operations, persistence, and SVG relationship hit-line event wiring; these are the next collision zones before deep API work.
- `EditorContent.tsx` still owns durable save queue and linked-entity load/save operations; Phase 3 should move reusable document commands toward API/headless-safe boundaries.

Why this phase existed:

Phase 2B was added because review after Phase 2A showed the host files were still too large for the desired 4-20 parallel-agent workflow. It moved row rendering, editor document UI/events, node-card rendering, and viewport pointer wiring out of the hosts while still avoiding Phase 3 API/headless command redesign.

Next recommended prompt:

Use the "Prompt: Phase 2C Executor" section in this document from a fresh Codex instance after reviewing the Phase 2B ownership notes in `docs/parallel-agent-architecture.md`.

### 2026-05-04 - Phase 2C Follow-Up Requested

Phase: Phase 2 planning.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
```

Commands/checks run:

```text
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
```

What changed:

- Documented why Phase 2 was split into Phase 2A, Phase 2B, and Phase 2C instead of doing one large risky refactor.
- Added Phase 2C ownership targets for remaining collision zones in Company Explorer, Editor, and Node Map.
- Added a copy/pasteable "Prompt: Phase 2C Executor" for a fresh Codex instance.
- Updated the Phase 2B next-step guidance so Phase 2C happens before Phase 3 if hot-file collision risk is still too high.

Why Phase 2C exists:

- `CompanyExplorerContent.tsx` still owns tree construction, selection authority, and bridge orchestration.
- `NodeMapContent.tsx` still owns graph state, relationship operations, persistence, and SVG relationship hit-line event wiring.
- `EditorContent.tsx` still owns durable document load/save queue behavior.

What was intentionally not changed:

- No source refactor was performed in this documentation-only update.
- No Phase 3 command/API/headless refactor was started.
- No push was performed.
- No global Git config was edited.

Next recommended prompt:

Use the "Prompt: Phase 2C Executor" section in this document from a fresh Codex instance.

### 2026-05-04 - Phase 2C Hot-File Split Implemented

Phase: Phase 2C.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/company-explorer/CompanyExplorerTree.tsx
frontend/src/modules/company-explorer/useCompanyExplorerKeyboard.ts
frontend/src/modules/company-explorer/useCompanyExplorerSelectionBridge.ts
frontend/src/modules/company-explorer/useCompanyExplorerTreeModel.ts
frontend/src/modules/editor/EditorContent.tsx
frontend/src/modules/editor/useEditorDocumentPersistence.ts
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/node-map/NodeMapRelationshipHitLines.tsx
frontend/src/modules/node-map/useNodeMapGraphPersistence.ts
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
npm.cmd run build
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer diff --check
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

What changed:

- Moved Company Explorer tree model derivation into `useCompanyExplorerTreeModel.ts`, keyboard behavior into `useCompanyExplorerKeyboard.ts`, tree viewport rendering into `CompanyExplorerTree.tsx`, and cross-module selection bridge mechanics into `useCompanyExplorerSelectionBridge.ts`.
- Moved Editor durable document save queue behavior into `useEditorDocumentPersistence.ts` while keeping linked-entity loading, scroll restoration, undo/redo, and editor surface wiring in `EditorContent.tsx`.
- Moved Node Map transparent SVG relationship hit-line event wiring into `NodeMapRelationshipHitLines.tsx`.
- Moved Node Map browser/session viewport persistence and map-layout persistence into `useNodeMapGraphPersistence.ts`.
- Updated architecture docs to record the Phase 2C ownership boundaries.

What was intentionally not changed:

- No Phase 3 backend/API/headless command layer was introduced.
- No Node Map/Logic Gate Map workspace coordinator was introduced.
- Node Map relationship CRUD and selection state remain in `NodeMapContent.tsx`.
- Editor linked-entity loading remains in `EditorContent.tsx`.
- No push was performed.
- No global Git config was edited.

Risks:

- `NodeMapContent.tsx` is still a large host because relationship operations, graph scoping, selection bridge behavior, and node details/panel state remain together.
- `EditorContent.tsx` still owns linked-entity loading and selection bridge behavior; another narrow Phase 2 split could extract `useEditorLinkedEntityLoader.ts` before Phase 3 if collision risk remains high.
- `CompanyExplorerContent.tsx` is thinner, but still owns CRUD, drag/drop operations, and selection state authority by design.

Next recommended prompt:

Run one more narrow Phase 2 split before Phase 3 if the next worker batch will keep touching Node Map or Editor internals. Target `useNodeMapRelationshipOperations.ts`, `useNodeMapSelectionBridge.ts`, and `useEditorLinkedEntityLoader.ts` only; after that, start Phase 3 with the "Prompt: Phase 3 Executor" section.

### 2026-05-04 - Phase 2D-2E Plan Simplified

Phase: Phase 2 planning.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge-base origin/main HEAD
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
```

Merge/freshness compatibility:

- After fetch, `origin/main...HEAD` was `0 2`.
- `merge-base origin/main HEAD` matched `origin/main`.
- Current `origin/main` is already the base of this branch, so merging `origin/main` into the dirty Phase 2 worktree would be a no-op for committed history and was intentionally not run.
- A future worker should repeat this check; if `origin/main` moves while the worktree is dirty, ask before creating a local preservation commit.

What changed:

- Replaced the granular Phase 2D-2I plan with two remaining Phase 2 phases:
  - Phase 2D backend hot-file split covering `server.go`, `memory.go`, and `postgres.go`.
  - Phase 2E remaining frontend hot-file split covering `applayout.tsx`, `LogicGateMapContent.tsx`, remaining `NodeMapContent.tsx`, and `KanbanContent.tsx`.
- Updated architecture ownership docs with backend, app layout, logic-gate-map, Node Map, and Kanban hot-file targets.
- Updated the copy/pasteable Phase 2D executor prompt for the next fresh Codex instance.

What was intentionally not changed:

- No source code was changed in this planning update.
- No merge, rebase, stash, commit, or push was performed.
- Phase 3 API/headless command work was not started.

Next recommended prompt:

Use the "Prompt: Phase 2D Backend Hot-File Split Executor" section in this document.

### 2026-05-04 - Phase 2D Backend Hot-File Split Implemented

Phase: Phase 2D.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

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
backend/internal/store/kanban.go
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
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge-base origin/main HEAD
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
go test ./...
go test ./... from backend module root
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

Merge/freshness compatibility:

- After fetch, `origin/main...HEAD` was `0 2`.
- `merge-base origin/main HEAD` matched `origin/main` (`a14d8a8d0f8f0db04bfa4a9a3442cb74ecc3e3cc`).
- Current `origin/main` is already the base of this branch, so no merge was run.

What changed:

- Split `backend/internal/http/server.go` into route registration plus same-package endpoint-family handler files.
- Moved generic HTTP JSON/error helpers to `http_helpers.go`.
- Moved `Repository`, shared store errors, operation input, Kanban query/input types, and shared validation/normalization helpers into `repository.go`.
- Split `MemoryRepo` node, logic gate, Kanban, Company Explorer, and operation behavior into focused same-package files.
- Split `PostgresRepo` node, logic gate, Kanban, Company Explorer, and operation behavior into focused same-package files.
- Removed the old `kanban.go` shell after its shared types moved to `repository.go`.

What was intentionally not changed:

- No Phase 3 API/headless command refactor was started.
- No route behavior, payload shape, status code, repository contract, SQL semantics, transaction boundary, or in-memory locking behavior was changed intentionally.
- No push was performed.
- No global Git config was edited.
- Existing uncommitted frontend Phase 2 work was preserved.

Risks:

- `server.go` still centralizes route registration, so route table changes remain a backend coordination point.
- `Repository` remains a broad interface by design until Phase 3 decides whether API/headless command boundaries need a deeper split.
- Store helpers such as Kanban normalization and editor text-box projection checks are still shared same-package functions because both memory and Postgres implementations depend on the exact same semantics.

Next recommended prompt:

Use the "Prompt: Phase 2E Remaining Frontend Hot-File Split Executor" section from this document from a fresh Codex instance.

### 2026-05-04 - Phase 2E Remaining Frontend Hot-File Split Implemented

Phase: Phase 2E.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Hot frontend files touched:

```text
frontend/src/app/applayout.tsx
frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/kanban/KanbanContent.tsx
```

New frontend files added:

```text
frontend/src/app/FrameChrome.tsx
frontend/src/app/frameLayoutTypes.ts
frontend/src/app/useFrameDragResize.ts
frontend/src/app/useFramePersistence.ts
frontend/src/modules/logic-gate-map/LogicGateMapContextMenus.tsx
frontend/src/modules/logic-gate-map/LogicGateMapNodeCard.tsx
frontend/src/modules/logic-gate-map/LogicGateMapRelationshipHitLines.tsx
frontend/src/modules/logic-gate-map/logicGateMapRouting.ts
frontend/src/modules/logic-gate-map/useLogicGateMapGraphPersistence.ts
frontend/src/modules/logic-gate-map/useLogicGateMapViewportHandlers.ts
frontend/src/modules/node-map/useNodeMapGraphLoader.ts
frontend/src/modules/kanban/KanbanBoardSidebar.tsx
frontend/src/modules/kanban/KanbanCardView.tsx
frontend/src/modules/kanban/KanbanColumnView.tsx
```

Docs changed:

```text
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge-base origin/main HEAD
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
npm.cmd run build
npm.cmd run build after each non-trivial host split
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer diff --check
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

Merge/freshness compatibility:

- `git fetch origin` needed sandbox escalation because the sandbox could not write `FETCH_HEAD`; the escalated fetch succeeded.
- After fetch, `origin/main...HEAD` was `0 2`.
- `merge-base origin/main HEAD` matched `origin/main` (`a14d8a8d0f8f0db04bfa4a9a3442cb74ecc3e3cc`).
- Current `origin/main` is already the base of this branch, so no merge was run.

What changed:

- Split App Layout frame constants/types, frame persistence, frame drag/resize mechanics, and frame chrome rendering into app-local files while leaving `applayout.tsx` as the dashboard orchestration surface.
- Split Logic Gate Map node card rendering, context menus, relationship hit-lines, viewport handlers, graph persistence, and routing math into logic-gate-map local files while preserving host state ownership.
- Moved Node Map graph snapshot load/subscription mechanics into `useNodeMapGraphLoader.ts`.
- Split Kanban board sidebar, column rendering/resizing/drop surface, and card rendering into Kanban-local components while keeping API operations and selection authority in `KanbanContent.tsx`.
- Updated architecture docs with the final Phase 2E frontend ownership boundaries.

What was intentionally not changed:

- No Phase 3 API/headless command boundary refactor was started.
- No backend API contract, request payload, response payload, status code, repository semantic, or frontend/backend contract was changed.
- No generic map engine or shared map workspace coordinator was introduced.
- No push was performed.
- No global Git config was edited.
- Existing uncommitted Phase 2 work was preserved.

Behavior preserved:

- Dashboard module registration, frame selection/linking, frame resize/drag behavior, keyboard routing, and frame persistence.
- Logic Gate Map canvas behavior, scoped folder behavior, relationship selection/delete, multi-select behavior, and Explorer/Editor bridges.
- Node Map graph loading/subscription behavior, scoped folder behavior, and existing relationship/node/selection ownership.
- Kanban board picker/sidebar behavior, board/card/column rendering, card multi-select, linked Explorer/Editor behavior, drag/drop, delete behavior, and color/size persistence.

Risks:

- `NodeMapContent.tsx` still owns relationship CRUD, node operations, selection state, and panel state. Those are deliberate host responsibilities until Phase 3 defines command/API boundaries.
- `KanbanContent.tsx` still owns API operations, drag/drop orchestration, and selection bridge behavior; future Kanban command work should land in focused operation hooks rather than regrowing the host.
- `applayout.tsx` remains the app-level dashboard coordination point for tab/frame/link state.
- `LogicGateMapContent.tsx` is thinner but still owns graph state and CRUD operations by design.

Next recommended prompt:

Phase 3 API/headless command boundary refactor.

### 2026-05-04 - Phase 3 API/Headless Command Boundaries Implemented

Phase: Phase 3.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/frontend/modules/kanban.md
docs/frontend/modules/nodes.md
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
frontend/src/modules/kanban/KanbanContent.tsx
frontend/src/modules/kanban/kanbanApi.ts
frontend/src/modules/kanban/kanbanCommands.ts
frontend/src/modules/node-map/NodeMapContent.tsx
frontend/src/modules/node-map/nodeMapCommands.ts
tests/frontend/config/tsconfig.node-tests.json
tests/frontend/scripts/run-node-relationship-tests.mjs
tests/frontend/modules/kanban/kanbanCommands.test.ts
tests/frontend/modules/node-map/nodeMapCommands.test.ts
```

Commands/checks run:

```text
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer log --oneline --decorate --max-count=5
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer rev-list --left-right --count origin/main...HEAD
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer merge-base origin/main HEAD
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
npm.cmd run test:node-relationships from the frontend module root
npm.cmd run build from the frontend module root
git -c safe.directory=C:/Users/Jonat/MangoOSDev-conflict-fixer diff --check
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

Merge/freshness compatibility:

- `git fetch origin` needed sandbox escalation because the sandbox could not write `FETCH_HEAD`; the escalated fetch succeeded.
- After fetch, `origin/main...HEAD` was `0 2`.
- `merge-base origin/main HEAD` matched `origin/main` (`a14d8a8d0f8f0db04bfa4a9a3442cb74ecc3e3cc`).
- Current `origin/main` is already the base of this branch, so no merge, rebase, stash, or preservation commit was needed.

What changed:

- Added `frontend/src/modules/kanban/kanbanCommands.ts` as the module-local command boundary for durable Kanban write workflows: column create/rename/delete/layout/reorder, card reorder, Explorer-node card upsert, and card delete.
- Updated `KanbanContent.tsx` to call the Kanban command helpers while preserving UI ownership of visual state, optimistic rendering, drag state, confirmation modals, and selection authority.
- Added `frontend/src/modules/node-map/nodeMapCommands.ts` for Node Map relationship-delete request de-dupe, endpoint fan-out, and partial-failure summary without browser UI dependencies.
- Updated `NodeMapContent.tsx` to call the Node Map relationship-delete command while preserving graph state, node CRUD, selection state, folder scope, and canvas rendering ownership in the host.
- Added command tests for Kanban and Node Map API behavior to the existing frontend Node test harness.
- Updated module and architecture docs with the new headless/API-equivalent workflows.

What was intentionally not changed:

- No backend route, request payload, response payload, status code, repository contract, or SQL behavior changed.
- No generic command framework, shared map engine, or cross-module workspace coordinator was introduced.
- Logic Gate Map relationship CRUD, Node Map node create/delete/update, Editor document persistence, and Company Explorer CRUD remain UI-hosted or hook-hosted workflows for future command extraction.
- No push was performed.
- No global Git config was edited.

Behavior preserved:

- Kanban board/column/card state ownership, linked selection behavior, drag/drop behavior, optimistic rendering, confirmation-gated deletion, sparse position writes, and idempotent node-card placement.
- Node Map relationship delete selection cleanup, status/error messaging, partial-failure handling, 404-triggered snapshot reconciliation, and relationship-line deletion semantics.

Remaining UI-only workflows:

- Node Map node create/update/delete and linked-node creation.
- Logic Gate Map gate and relationship create/update/delete.
- Editor durable document save/load command surface beyond the existing persistence hook.
- Company Explorer folder/item CRUD and drag/drop command surface.

Next recommended prompt:

Run a narrow follow-up Phase 3 pass for Logic Gate Map command parity with Node Map relationship deletion and for Editor document save/load commands. Keep it module-local and test commands without browser UI.

### 2026-05-04 - Phase 3 Prompt Guardrail Updated

Phase: Phase 3 preparation.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/latency-obsession-architecture.md
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
docs/parallel-agent-workflow.md
```

What changed:

- Added the explicit 20-agent development architecture rule to the core operating principle.
- Aligned the latency architecture source-of-truth goal text with the current B2B/headless/API/AWS cost sacred text.
- Updated the Phase 3 executor prompt so the next Codex instance preserves Phase 2 work, performs freshness checks, and keeps 20-agent development architecture as a first-class constraint.

What was intentionally not changed:

- No source code was changed.
- No Phase 3 implementation was started.
- No push, merge, rebase, stash, or commit was performed.

Next recommended prompt:

Use the updated "Prompt: Phase 3 Executor" section in this document.

### 2026-05-04 - Freshness Contract Added

Phase: pre-Phase 1 planning.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-refactor-handoff.md
```

Commands/checks run:

```text
rg -n "^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$" .
Result: no conflict markers found.
```

What changed:

- Added a dedicated Freshness Contract section.
- Updated worker prompts so worker branches fetch and reconcile with latest `origin/main` before task work.
- Updated composer prompts so new worker branches are created only from updated `main`.
- Updated one-worker and batch integrator prompts so integration starts from latest `main` and reconciles workers before merging.
- Updated Phase 1, Phase 2, and Phase 3 executor prompts so fresh Codex instances preserve existing work, update from `origin/main`, scan for conflict markers, and only then start phase work.

What was intentionally not changed:

- No scripts were implemented yet.
- No frontend/backend code was changed.

Risks:

- Phase 1 still needs to convert these prompt rules into scripts so the user does not have to manage the details manually.

Next recommended prompt:

Use the "Prompt: Phase 1 Executor" section in this document after this branch/worktree includes the latest `origin/main`.

### 2026-05-04 - Initial Handoff Document

Phase: pre-Phase 1 planning.

Branch/worktree: `codex/conflict-fixer` in `C:\Users\Jonat\MangoOSDev-conflict-fixer`.

Files changed:

```text
docs/parallel-agent-refactor-handoff.md
docs/latency-obsession-architecture.md
```

What changed:

- Captured the three-phase plan.
- Recorded the corrected operating principle.
- Documented the known hot files and why they are hot.
- Added copy/paste prompts for worker, integrator, batch integrator, and phase executor agents.
- Added proposed script names and behavior for Phase 1.

What was intentionally not changed:

- No frontend code was refactored.
- No scripts were implemented yet.
- No tests were added yet.

Next recommended prompt:

Use the "Prompt: Phase 1 Executor" section in this document after the current bugfix worker has been merged back into main and this branch/worktree has been refreshed as needed.
