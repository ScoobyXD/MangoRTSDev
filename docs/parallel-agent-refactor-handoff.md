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
- Preserve the operating principle: sub-100ms latency culture, reliability, API/headless future, AWS cost efficiency, simplest solution possible.

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

### Prompt: Phase 3 Executor

```text
You are a fresh Codex instance working in MangoOSDev.

Read this file first:
docs/parallel-agent-refactor-handoff.md

Your job is to complete Phase 3 only: improve API/headless boundaries.

Do not push.
Do not edit global Git config.

Start by inspecting:
- current backend API routes
- frontend command/action patterns
- module docs
- tests
- latency architecture docs

Before editing, apply the phase freshness contract:
- if existing Phase 2 changes are uncommitted, preserve them with a clear local commit before rebasing or merging
- git fetch origin
- bring this branch up to date with origin/main, preferring rebase if safe and merge if rebase is not appropriate
- resolve conflicts conservatively
- run the conflict-marker scan
- only then start Phase 3

Move critical UI workflows toward reusable command/action boundaries that can later be called by headless APIs and AI agents.

Rules:
- simplest solution possible
- avoid broad rewrites
- avoid N+1 and unbounded scans
- keep AWS cost efficiency in mind
- add focused tests for command behavior
- update docs

Before final:
- run conflict-marker scan
- run relevant backend/frontend tests
- run full tests if shared API behavior changed

Final response must include:
- command/API boundaries added
- headless workflows improved
- tests/checks run and result
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
