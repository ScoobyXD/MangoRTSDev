# State Ledger

The orchestration ledger is the durable source of truth. Chat context is not reliable enough for long-running orchestration.

The exact implementation is still pending. This document defines the intended shape.

## Planned Files

These should likely be ignored by Git for live runs:

```text
.agent-state/counters.json
.agent-state/orchestration.json
.agent-state/batches/
.agent-state/workers/
.agent-state/projects/
.agent-state/managers/
```

Commit templates/schemas instead:

```text
.agent-state.example.json
docs/agents/state-ledger.md
```

## Counters

Use separate numeric counters:

```json
{
  "batch": 7,
  "project": 1006,
  "orchestrator": 7,
  "manager": 1006,
  "worker": 95350
}
```

## Batch Record

```json
{
  "batch_id": "BatchName-batch0000007",
  "orchestrator_id": "orchestrator0000007",
  "status": "active",
  "created_at": "2026-05-04T00:00:00-07:00",
  "base_branch": "main",
  "batch_base_commit": "<main sha at batch start>",
  "batch_branch": "BatchName-batch0000007",
  "batch_worktree": "C:\\Users\\Jonat\\MangoRTSDev-BatchName-batch0000007",
  "batch_merge_lock": null,
  "projects": [
    "FixKanbanBoardCardsUIProject-project0001005"
  ]
}
```

## Project Record

```json
{
  "project_id": "FixKanbanBoardCardsUIProject-project0001005",
  "batch_id": "BatchName-batch0000007",
  "user_prompt_title": "Fix Kanban Board Cards UI",
  "project_branch": "FixKanbanBoardCardsUIProject-project0001005",
  "project_worktree": "C:\\Users\\Jonat\\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005",
  "base_commit": "<same as batch_base_commit>",
  "status": "workers-active",
  "workers": [
    "FixKanbanBoardCardsUIWorker1-project0001005-worker0095348"
  ],
  "manager_agent": "FixKanbanBoardCardsUIManager-project0001005",
  "qa_status": "not-ready",
  "merged_to_batch": false,
  "failed_commits": []
}
```

## Worker Record

```json
{
  "worker_id": "worker0095348",
  "worker_number": 1,
  "worker_name": "FixKanbanBoardCardsUIWorker1-project0001005-worker0095348",
  "project_id": "FixKanbanBoardCardsUIProject-project0001005",
  "branch": "FixKanbanBoardCardsUIWorker1-project0001005-worker0095348",
  "worktree": "C:\\Users\\Jonat\\MangoRTSDev-FixKanbanBoardCardsUIWorker1-project0001005-worker0095348",
  "base_branch": "FixKanbanBoardCardsUIProject-project0001005",
  "prompt_file": "C:\\Users\\Jonat\\MangoRTSDev\\.agent-state\\prompts\\FixKanbanBoardCardsUIWorker1-project0001005-worker0095348.txt",
  "agent_launch_mode": "local-codex-cli",
  "agent_launch_command": "<recorded local command or null>",
  "terminal_opened": true,
  "terminal_title": "FixKanbanBoardCardsUIWorker1-project0001005-worker0095348",
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

## Manager Record

```json
{
  "manager_id": "FixKanbanBoardCardsUIManager-project0001005",
  "project_id": "FixKanbanBoardCardsUIProject-project0001005",
  "project_branch": "FixKanbanBoardCardsUIProject-project0001005",
  "status": "ready-for-human-qa",
  "merged_worker_branches": [
    "FixKanbanBoardCardsUIWorker1-project0001005-worker0095348"
  ],
  "skipped_worker_branches": [],
  "checks": [
    "check_conflict_markers.ps1",
    "fast_verify.ps1",
    "node scripts/run_all_tests.mjs"
  ],
  "project_commit": "<sha>",
  "schema_files_changed": []
}
```

## Project-To-Batch Merge Record

```json
{
  "project_id": "FixKanbanBoardCardsUIProject-project0001005",
  "batch_id": "BatchName-batch0000007",
  "status": "merged-to-batch",
  "batch_branch": "BatchName-batch0000007",
  "project_commit": "<sha>",
  "batch_merge_commit": "<sha>",
  "checks": [
    "check_conflict_markers.ps1",
    "fast_verify.ps1",
    "node scripts/run_all_tests.mjs"
  ],
  "schema_files_changed": []
}
```

## Rollback Record

```json
{
  "type": "project-rollback",
  "project_id": "EditorTextStyleChangesProject-project0001006",
  "batch_id": "BatchName-batch0000007",
  "failed_project_commit": "<sha before rollback>",
  "rollback_to_commit": "<batch_base_commit>",
  "reason": "<human-provided reason>",
  "created_at": "2026-05-04T00:00:00-07:00"
}
```

Project rollback must use `batch_base_commit` unless the human explicitly approves a different base.

## Resume Procedure

A fresh orchestrator should:

1. Read `docs/agents/README.md`.
2. Read ledger files.
3. Run `git worktree list`.
4. List batch, project, and worker branches.
5. Run status checks for `main` and active worktrees.
6. Reconcile ledger entries with actual Git state.
7. Continue from the latest durable state.
