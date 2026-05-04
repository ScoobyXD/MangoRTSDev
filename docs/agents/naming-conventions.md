# Naming Conventions

Use separate seven-digit counters for each entity type. Do not use one global counter.

## Entity Names

```text
run-0000005-change-combine-board
project-0000012-kanban-board
orch-0000005-change-combine-board
worker-0001000-kanban-board-picker
worker-0001001-kanban-header-hit-targets
worker-0001002-kanban-explorer-icon
worker-0001003-kanban-scrollbars
merge-0000044-kanban-board
```

## Counter Ownership

Counters are stored in the orchestration ledger, not inferred from memory.

Example:

```json
{
  "run": 5,
  "project": 12,
  "orchestrator": 5,
  "worker": 1003,
  "merge": 44
}
```

The orchestrator owns counter allocation. Workers and merge agents never invent IDs.

## Branch Names

Project integration branch:

```text
integration/0000012-kanban-board
```

Worker branches:

```text
codex/0001000-kanban-board-picker
codex/0001001-kanban-header-hit-targets
codex/0001002-kanban-explorer-icon
codex/0001003-kanban-scrollbars
```

The project and its integration branch share the same project number and slug:

```text
project-0000012-kanban-board
integration/0000012-kanban-board
```

The project merge agent has its own merge counter and references the project:

```text
merge-0000044-kanban-board
owns integration/0000012-kanban-board
```

## Worktree Names

Project integration worktree:

```text
C:\Users\Jonat\MangoOSDev-integration-0000012-kanban-board
```

Worker worktrees:

```text
C:\Users\Jonat\MangoOSDev-0001000-kanban-board-picker
C:\Users\Jonat\MangoOSDev-0001001-kanban-header-hit-targets
```

## Slug Rules

- Lowercase.
- Use hyphens between words.
- Keep slugs meaningful and short.
- Do not include punctuation other than hyphens.
- Prefer the user's project wording when possible.

