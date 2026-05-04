# State Ledger

The orchestration ledger is the durable source of truth. Chat context is not reliable enough for long-running orchestration.

The exact implementation is still pending. This document defines the intended shape.

## Planned Files

These should likely be ignored by Git for live runs:

```text
.agent-state/counters.json
.agent-state/orchestration.json
.agent-state/workers/
.agent-state/projects/
.agent-state/merges/
```

Commit templates/schemas instead:

```text
.agent-state.example.json
docs/agents/state-ledger.md
```

## Counters

Use separate seven-digit counters:

```json
{
  "run": 5,
  "project": 12,
  "orchestrator": 5,
  "worker": 1003,
  "merge": 44
}
```

## Run Record

```json
{
  "run_id": "run-0000005-change-combine-board",
  "orchestrator_id": "orch-0000005-change-combine-board",
  "status": "active",
  "created_at": "2026-05-04T00:00:00-07:00",
  "projects": [
    "project-0000012-kanban-board"
  ]
}
```

## Project Record

```json
{
  "project_id": "project-0000012-kanban-board",
  "user_prompt_title": "Kanban Board",
  "integration_branch": "integration/0000012-kanban-board",
  "integration_worktree": "C:\\Users\\Jonat\\MangoOSDev-integration-0000012-kanban-board",
  "status": "workers-active",
  "workers": [
    "worker-0001000-kanban-board-picker"
  ],
  "merge_agent": "merge-0000044-kanban-board",
  "qa_status": "not-ready"
}
```

## Worker Record

```json
{
  "worker_id": "worker-0001000-kanban-board-picker",
  "project_id": "project-0000012-kanban-board",
  "branch": "codex/0001000-kanban-board-picker",
  "worktree": "C:\\Users\\Jonat\\MangoOSDev-0001000-kanban-board-picker",
  "base_branch": "integration/0000012-kanban-board",
  "primary_scope": [
    "frontend/src/modules/kanban/KanbanContent.tsx",
    "frontend/src/modules/kanban/KanbanBoardSidebar.tsx"
  ],
  "status": "done",
  "commit": "<sha>",
  "checks": [
    "check_conflict_markers.ps1",
    "fast_verify.ps1"
  ],
  "outside_scope_edits": []
}
```

## Merge Record

```json
{
  "merge_id": "merge-0000044-kanban-board",
  "project_id": "project-0000012-kanban-board",
  "integration_branch": "integration/0000012-kanban-board",
  "status": "ready-for-human-qa",
  "merged_worker_branches": [
    "codex/0001000-kanban-board-picker"
  ],
  "skipped_worker_branches": [],
  "checks": [
    "check_conflict_markers.ps1",
    "fast_verify.ps1",
    "node scripts/run_all_tests.mjs"
  ],
  "integration_commit": "<sha>"
}
```

## Resume Procedure

A fresh orchestrator should:

1. Read `docs/agents/README.md`.
2. Read ledger files.
3. Run `git worktree list`.
4. List `codex/*` and `integration/*` branches.
5. Run status checks for `main` and active worktrees.
6. Reconcile ledger entries with actual Git state.
7. Continue from the latest durable state.

