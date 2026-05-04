# Project Merge Agent Protocol

A project merge agent owns one project integration branch. Its job is to merge all worker branches for that project into that integration branch, run checks, and produce a ready-for-human-QA worktree.

Use one project merge agent per top-level project prompt.

## Inputs

```text
Merge agent:
merge-0000044-kanban-board

Project:
project-0000012-kanban-board

Integration branch:
integration/0000012-kanban-board

Integration worktree:
C:\Users\Jonat\MangoOSDev-integration-0000012-kanban-board

Worker branches:
- codex/0001000-kanban-board-picker
- codex/0001001-kanban-header-hit-targets
- codex/0001002-kanban-explorer-icon
- codex/0001003-kanban-scrollbars
```

## Responsibilities

1. Read the required docs.
2. Run preflight in the integration worktree.
3. Confirm the integration branch/worktree is correct.
4. Merge worker branches one at a time.
5. Resolve only conflicts relevant to this project.
6. Run conflict-marker scan after each merge.
7. Run fast verification after risky merges or after each merge when practical.
8. Run full verification before reporting ready for QA.
9. Record merged, skipped, and blocked branches in the ledger.
10. Report exact manual QA commands.

## Default Stop Point

Stop at the project integration branch. Do not merge to `main` by default. Do not push by default.

The user will manually test and decide whether to approve, request fixes, drop the project, or explicitly ask for a main merge.

## Required Checks

From the integration worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

## Required Ready-For-QA Report

Use this shape:

```text
Project ready for manual QA:
project-0000012-kanban-board

Integration branch:
integration/0000012-kanban-board

Integration worktree:
C:\Users\Jonat\MangoOSDev-integration-0000012-kanban-board

Merged worker branches:
<list>

Skipped/blocked worker branches:
<none or list with reason>

Checks already run:
- check_conflict_markers.ps1 passed
- fast_verify.ps1 passed
- node scripts\run_all_tests.mjs passed

Run backend:
cd C:\Users\Jonat\MangoOSDev-integration-0000012-kanban-board\backend
go run ./cmd/miraeopus-api

Run frontend:
cd C:\Users\Jonat\MangoOSDev-integration-0000012-kanban-board\frontend
npm run dev

Apply schema:
cd C:\Users\Jonat\MangoOSDev-integration-0000012-kanban-board
powershell -ExecutionPolicy Bypass -File .\scripts\apply_canonical_schema.ps1
```

There is no `backend\go` directory. Backend commands run from:

```text
<integration-worktree>\backend
```

