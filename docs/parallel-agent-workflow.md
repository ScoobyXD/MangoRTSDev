# Parallel Agent Workflow

This is the practical operating guide for running many Codex workers against MangoRTS without letting merge conflicts or raw conflict markers reach `main`.

Read this with:

```text
docs/agents/README.md
docs/parallel-agent-refactor-handoff.md
docs/parallel-agent-architecture.md
```

`docs/agents/README.md` is the current one-stop shop for orchestration, worker, merge-agent, naming, lifecycle, and handoff decisions. The handoff remains the historical source of truth. This file is the copy/paste workflow surface.

Important: the current batch orchestration model in `docs/agents/` supersedes the older `codex/<worker>` examples in this file. New batch workers must use project-attached names such as `FixKanbanBoardCardsUIWorker1-project0001005-worker0095348`.

## Operating Rule

Always update from latest `origin/main` before meaningful work, and integrate worker branches through temporary integration branches. Never merge a dirty or stale worker branch directly into `main`.

The safe shape is:

```text
main
  -> codex/<worker>
  -> integration/<worker-or-batch>
  -> main
```

No script in this workflow pushes.

## Prerequisites

Required local commands:

```text
git
rg
node
npm
go
```

On Windows, install `ripgrep` for the `rg` command before running the parallel-agent scripts:

```powershell
winget install BurntSushi.ripgrep.MSVC
```

`rg` is used by the conflict-marker scan and fast verification gates. `agent_preflight.ps1` fails early if `git` or `rg` is missing.

## Windows Safe Directory

This repo is often owned by the normal Windows user while Codex commands run as a sandbox user. Use per-command safe directory when Git asks for it:

```powershell
git -c safe.directory=C:/Users/Jonat/MangoOSDev status --short --branch
```

Do not run global Git config changes for this workflow.

## Phase 1 Scripts

Run these from a repo worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent_preflight.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```

Create a worker from an up-to-date `main` worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create_worker_worktree.ps1 `
  -Name "Company Explorer Drag Drop" `
  -MainPath "C:\Users\Jonat\MangoOSDev"
```

Create an integration worktree from an up-to-date `main` worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create_integration_worktree.ps1 `
  -Slug "company-explorer-drag-drop" `
  -MainPath "C:\Users\Jonat\MangoOSDev"
```

Integrate one worker branch through a temporary integration branch:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\integrate_worker_branch.ps1 `
  -WorkerBranch "codex/company-explorer-drag-drop" `
  -MainPath "C:\Users\Jonat\MangoOSDev"
```

Integrate a related batch:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\batch_integrate_worker_branches.ps1 `
  -BatchName "company-explorer-batch" `
  -WorkerBranches @(
    "codex/company-explorer-selection",
    "codex/company-explorer-drag-drop"
  ) `
  -MainPath "C:\Users\Jonat\MangoOSDev" `
  -RunFullVerification
```

Use `-NoMainMerge` on integration scripts when you want to inspect the integration worktree before merging the clean result into `main`.

Use `-UseMergeForWorkerFreshness` when rebasing would rewrite shared work or when a worker branch is already coordinated with another person.

Use `-CommitWorkerChanges` only after reviewing the worker branch and deciding that committing every worker change is safe.

## Required Merge Gates

Every worker merge must pass these gates before `main` is updated:

```powershell
git status --short --branch
git worktree list
git fetch origin
git merge --ff-only origin/main
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```

Run the full suite when the worker touches shared architecture, hot frontend hosts, backend APIs, schema, or core state:

```powershell
node scripts\run_all_tests.mjs
```

## Verification Tiers

Tier 0 is instant safety:

```powershell
git status --short --branch
git worktree list
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
git diff --name-only
```

Tier 1 is affected-area verification:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```

`fast_verify.ps1` always runs the conflict scan. It also parses changed PowerShell scripts, runs the frontend build when `frontend/*` changed, and runs backend Go tests when `backend/*` changed.

Tier 2 is full verification:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root . -Full
```

This delegates to:

```powershell
node scripts\run_all_tests.mjs
```

## Copy/Paste: Worker Agent

```text
You are a MangoRTS worker agent.

Task:
<describe task>

Owned files/modules:
<list owned files or module directories>

Read before changing code:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md
- docs/parallel-agent-architecture.md
- relevant docs/frontend/modules/*.md for your module

Before editing:
1. Run powershell -ExecutionPolicy Bypass -File .\scripts\agent_preflight.ps1 -Root .
2. Run git fetch origin.
3. Reconcile with latest origin/main:
   - preferred for local unpushed worker branches: git rebase origin/main
   - fallback when rebase is not appropriate: git merge --no-ff origin/main
4. Run powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .

Rules:
- Do not push.
- Do not edit global Git config.
- Do not broaden the task.
- Prefer focused hooks, helpers, and leaf components over expanding large host components.
- Do not edit hot host files unless necessary.
- If you touch a hot file, explain why in the final response.
- Preserve the operating principle: latency, reliability, headless APIs, AWS cost efficiency, simplest solution possible, and code architecture that can support 20 agents developing simultaneously.

Before final:
- run powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
- run powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
- report every file changed
- report any hot file touched
```

## Copy/Paste: One-Worker Integrator

```text
You are the MangoRTS integration agent.

Worker branch:
codex/<branch-slug>

Read first:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md
- docs/parallel-agent-architecture.md

Run:
powershell -ExecutionPolicy Bypass -File .\scripts\integrate_worker_branch.ps1 -WorkerBranch "codex/<branch-slug>" -MainPath "C:\Users\Jonat\MangoOSDev"

Rules:
- Do not push.
- Do not edit global Git config.
- Resolve only conflicts caused by this worker branch.
- Never leave conflict markers.
- Use -NoMainMerge if you need to inspect the integration worktree before merging into main.

Final response:
- worker branch and commit SHA
- integration branch and commit SHA
- final main merge commit SHA if created
- conflict files resolved
- checks run and result
- final git status --short --branch
```

## Copy/Paste: Batch Integrator

```text
You are the MangoRTS batch integration agent.

Batch name:
<batch-name>

Worker branches:
- codex/<branch-1>
- codex/<branch-2>
- codex/<branch-3>

Read first:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md
- docs/parallel-agent-architecture.md

Run:
powershell -ExecutionPolicy Bypass -File .\scripts\batch_integrate_worker_branches.ps1 `
  -BatchName "<batch-name>" `
  -WorkerBranches @("codex/<branch-1>", "codex/<branch-2>", "codex/<branch-3>") `
  -MainPath "C:\Users\Jonat\MangoOSDev" `
  -RunFullVerification

Rules:
- Do not push.
- Do not edit global Git config.
- Merge workers one at a time.
- Skip and report workers with heavy conflicts.
- Never leave conflict markers.

Final response:
- included worker branches
- skipped worker branches and why
- conflict files resolved
- batch integration commit SHA
- final main merge commit SHA if created
- checks run and result
- final git status --short --branch
```

## Manual Fallback

If the scripts are unavailable, use the manual integration shape:

```powershell
cd C:\Users\Jonat\MangoOSDev
git -c safe.directory=C:/Users/Jonat/MangoOSDev status --short --branch
git -c safe.directory=C:/Users/Jonat/MangoOSDev fetch origin
git -c safe.directory=C:/Users/Jonat/MangoOSDev merge --ff-only origin/main

$slug = "company-explorer-drag-drop"
$integration = "integration/$slug"
$path = "..\MangoOSDev-integration-$slug"

git -c safe.directory=C:/Users/Jonat/MangoOSDev worktree add -b $integration $path main
cd $path
git -c safe.directory=$((Resolve-Path .).Path.Replace('\','/')) merge --no-ff "codex/$slug" -m "Integrate codex/$slug"
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
```
