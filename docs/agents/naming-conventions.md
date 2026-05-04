# Naming Conventions

Use separate numeric counters for each entity type. Do not use one global counter.

The user prefers readable project branch names and simple numeric worker branch names. Parentage belongs in the ledger, so worker branch names do not need to repeat the project name.

## Entity Names

```text
BatchName-batch0000007
FixKanbanBoardCardsUIProject-project0001005
EditorTextStyleChangesProject-project0001006
orchestrator0000007
FixKanbanBoardCardsUIManager-project0001005
worker0095348
worker0095349
worker0095350
```

## Counter Ownership

Counters are stored in the orchestration ledger, not inferred from memory.

Example:

```json
{
  "batch": 7,
  "project": 1006,
  "orchestrator": 7,
  "manager": 1006,
  "worker": 95350
}
```

The orchestrator owns counter allocation. Project managers and workers never invent IDs.

## Branch Names

Batch branch:

```text
BatchName-batch0000007
```

Project branches:

```text
FixKanbanBoardCardsUIProject-project0001005
EditorTextStyleChangesProject-project0001006
```

Worker branches:

```text
worker0095348
worker0095349
worker0095350
```

The worker branch can be just the worker ID because the ledger records:

```json
{
  "worker_id": "worker0095348",
  "project_id": "FixKanbanBoardCardsUIProject-project0001005",
  "branch": "worker0095348"
}
```

Avoid branch prefixes like `codex/` for this workflow unless a script requires them. If an existing script requires a prefix, the script should be updated rather than changing the workflow naming model.

## Worktree Names

Batch worktree:

```text
C:\Users\Jonat\MangoOSDev-BatchName-batch0000007
```

Project worktrees:

```text
C:\Users\Jonat\MangoOSDev-FixKanbanBoardCardsUIProject-project0001005
C:\Users\Jonat\MangoOSDev-EditorTextStyleChangesProject-project0001006
```

Worker worktrees:

```text
C:\Users\Jonat\MangoOSDev-worker0095348
C:\Users\Jonat\MangoOSDev-worker0095349
```

## Slug Rules

- Preserve the user's project wording when possible.
- Use only letters, numbers, and hyphens in branch/worktree names.
- Do not use spaces in branch/worktree names.
- Keep project names readable even if they use PascalCase.
- Worker names should be numeric IDs only unless the human asks for descriptive worker branch names.
