# Naming Conventions

Use separate numeric counters for each entity type. Do not use one global counter.

Branch and worktree names must be readable without opening the ledger. Worker names must include their project, per-project worker number, project ID, and worker ID.

## Entity Names

```text
Batch0000154-batch0000154
FixKanbanBoardCardsUIProject-project0001005
EditorTextStyleChangesProject-project0001006
orchestrator0000154
FixKanbanBoardCardsUIManager-project0001005
EditorTextStyleChangesManager-project0001006
FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
FixKanbanBoardCardsUIWorker2-project0001005-worker0095349
EditorTextStyleChangesWorker1-project0001006-worker0095354
```

## Counter Ownership

Counters are stored in the orchestration ledger, not inferred from memory.

Example:

```json
{
  "batch": 154,
  "project": 1006,
  "orchestrator": 154,
  "manager": 1006,
  "worker": 95354
}
```

The orchestrator owns initial counter allocation. Project managers may allocate workers only through the ledger/script path that increments the shared worker counter atomically. Project managers and workers never invent IDs by hand.

## Branch Names

Batch branch:

```text
Batch0000154-batch0000154
```

Project branches:

```text
FixKanbanBoardCardsUIProject-project0001005
EditorTextStyleChangesProject-project0001006
```

Project manager names:

```text
FixKanbanBoardCardsUIManager-project0001005
EditorTextStyleChangesManager-project0001006
```

Worker branches:

```text
FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
FixKanbanBoardCardsUIWorker2-project0001005-worker0095349
FixKanbanBoardCardsUIWorker3-project0001005-worker0095350
EditorTextStyleChangesWorker1-project0001006-worker0095354
```

Worker names must not be bare numeric IDs such as `worker0095348`. The ledger still records parentage, but branch/worktree names must be human-readable in `git worktree list`, terminal titles, process lists, and reports.

Avoid branch prefixes like `codex/` for this workflow unless a script requires them. If an existing script requires a prefix, update the script instead of changing this naming model.

## Worktree Names

Batch worktree:

```text
C:\Users\Jonat\MangoOSDev-Batch0000154-batch0000154
```

Project worktrees:

```text
C:\Users\Jonat\MangoOSDev-FixKanbanBoardCardsUIProject-project0001005
C:\Users\Jonat\MangoOSDev-EditorTextStyleChangesProject-project0001006
```

Worker worktrees:

```text
C:\Users\Jonat\MangoOSDev-FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
C:\Users\Jonat\MangoOSDev-FixKanbanBoardCardsUIWorker2-project0001005-worker0095349
C:\Users\Jonat\MangoOSDev-EditorTextStyleChangesWorker1-project0001006-worker0095354
```

## Slug Rules

- Preserve the user's project wording when possible.
- Use only letters, numbers, and hyphens in branch/worktree names.
- Do not use spaces in branch/worktree names.
- Keep project names readable even if they use PascalCase.
- Use `Project` in project branch names.
- Use `Manager` in project manager names.
- Use `Worker<N>-project<ID>-worker<ID>` in worker names, where `<N>` is the worker's sequence inside that project.
