# Lifecycle And Branching

This document explains when agents are created and which source branch/worktree they use.

## Source Bases

```text
Orchestrator:
main worktree, latest local main after origin/main ff-only when allowed.

Project integration branch:
created from fresh main at the start of that project.

Initial workers:
created from that project's integration branch.

Follow-up workers after manual QA finds issues:
created from the same project integration branch the human tested.

Replacement workers for additional project scope:
created from the latest project integration branch after prior workers have merged.

New unrelated project:
created from fresh main or another explicitly approved base.
```

## Normal Flow

```text
User gives orchestrator three project prompts.

Orchestrator:
- creates integration/0000012-text-editor
- creates integration/0000013-kanban-board
- creates integration/0000014-company-explorer

Workers for text-editor:
- branch from integration/0000012-text-editor
- merge back into integration/0000012-text-editor

Workers for kanban:
- branch from integration/0000013-kanban-board
- merge back into integration/0000013-kanban-board

Workers for company-explorer:
- branch from integration/0000014-company-explorer
- merge back into integration/0000014-company-explorer
```

## Why Workers Branch From Project Integration

`main` may not contain the project's earlier worker changes yet. The project integration branch is the candidate product state for that project. Follow-up work should build on what the user is testing.

## When A Worker Finishes

```text
worker exits
project merge agent merges it into the project integration branch
orchestrator may spawn another worker from the updated project integration branch
```

## When Manual QA Fails

```text
human tells orchestrator what failed
orchestrator spawns fix worker from the tested project integration branch
project merge agent merges fix back into the same project integration branch
human tests again
```

## When Manual QA Passes

```text
human chooses whether to merge integration/<project> to main
human pushes, or explicitly asks an agent to merge/push
```

## Branch Lifetime

Worker branches and project integration branches should not become permanent development branches. The goal is short-lived candidate branches:

```text
create from fresh approved base
merge project workers
test
approve or revise
merge/drop
clean up stale branches/worktrees
```

Do not set hard line-count or file-count limits for workers. Instead, use judgment, reporting, and integration gates.

The approved project batch guardrail is:

```text
One broad architectural change per project integration batch.
```

