# Project Manager Agent Protocol

A project manager agent owns one project branch. Its job is to split a project into workers, merge all worker branches for that project into that project branch, run checks, and produce a ready-for-human-QA worktree.

Use one project manager agent per top-level project prompt.

## Inputs

```text
Manager agent:
FixKanbanBoardCardsUIManager-project0001005

Project:
FixKanbanBoardCardsUIProject-project0001005

Project branch:
FixKanbanBoardCardsUIProject-project0001005

Project worktree:
C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005

Worker branches:
- FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
- FixKanbanBoardCardsUIWorker2-project0001005-worker0095349
- FixKanbanBoardCardsUIWorker3-project0001005-worker0095350
```

## Responsibilities

1. Read the required docs.
2. Run preflight in the project worktree.
3. Confirm the project branch/worktree is correct.
4. Merge worker branches one at a time.
5. Resolve only conflicts relevant to this project.
6. Run conflict-marker scan after each merge.
7. Run fast verification after risky merges or after each merge when practical.
8. Run full verification before reporting ready for QA.
9. Record merged, skipped, and blocked branches in the ledger.
10. Report exact manual QA commands.
11. If project QA requires rollback, reset/recreate from `batch_base_commit`, not from current batch branch HEAD.

## Default Stop Point

Stop at the project branch. Do not merge to the batch branch until the human approves project QA. Do not merge to `main`. Do not push.

The user will manually test and decide whether to approve, request fixes, or roll back the project.

## Required Checks

From the project worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
node scripts\run_all_tests.mjs
```

## Required Ready-For-QA Report

Use this shape:

```text
Project ready for manual QA:
FixKanbanBoardCardsUIProject-project0001005

Project branch:
FixKanbanBoardCardsUIProject-project0001005

Project worktree:
C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005

Merged worker branches:
<list>

Skipped/blocked worker branches:
<none or list with reason>

Checks already run:
- check_conflict_markers.ps1 passed
- fast_verify.ps1 passed
- node scripts\run_all_tests.mjs passed

Run backend:
cd C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005\backend
go run ./cmd/miraeopus-api

Run frontend:
cd C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005\frontend
npm run dev

Apply schema:
cd C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005
powershell -ExecutionPolicy Bypass -File .\scripts\apply_canonical_schema.ps1

Schema/migration files changed:
<none or list backend/db/schema.sql and backend/db/migrations/*.sql>
```

There is no `backend\go` directory. Backend commands run from:

```text
<project-worktree>\backend
```
