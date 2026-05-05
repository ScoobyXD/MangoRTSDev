# Lifecycle And Branching

This document explains when agents are created and which source branch/worktree they use.

## Source Bases

```text
Orchestrator:
main worktree, latest approved local main after origin/main ff-only when allowed.

Batch branch:
created from approved main at batch start.

Project branch:
created from batch_base_commit, even if the batch branch later moves.

Initial workers:
created from that project's project branch by the project manager.

Follow-up workers after manual QA finds issues:
created from the same project branch the human tested.

Replacement workers for additional project scope:
created from the latest project branch after prior workers have merged.

Project rollback:
recreate or reset the project branch from batch_base_commit, not from current batch branch HEAD.

Batch-fix project:
created from current batch branch HEAD when the combined approved projects reveal an integration bug.

New unrelated batch:
created from fresh approved main or another explicitly approved base.
```

## Normal Flow

```text
User gives orchestrator one batch with two project prompts.

Orchestrator:
- records batch_base_commit from main
- creates Batch0000154-batch0000154
- creates FixKanbanBoardCardsUIProject-project0001005 from batch_base_commit
- creates EditorTextStyleChangesProject-project0001006 from batch_base_commit
- writes project manager prompt files
- starts or opens one project manager session per project

Workers for Kanban:
- created by FixKanbanBoardCardsUIManager-project0001005
- use names such as FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
- branch from FixKanbanBoardCardsUIProject-project0001005
- merge back into FixKanbanBoardCardsUIProject-project0001005

Workers for Editor:
- created by EditorTextStyleChangesManager-project0001006
- use names such as EditorTextStyleChangesWorker1-project0001006-worker0095354
- branch from EditorTextStyleChangesProject-project0001006
- merge back into EditorTextStyleChangesProject-project0001006

Human approves Kanban:
- FixKanbanBoardCardsUIProject-project0001005 merges into Batch0000154-batch0000154

Human rejects Editor hard:
- EditorTextStyleChangesProject-project0001006 rolls back to batch_base_commit, not BatchName-batch0000007 HEAD
```

## Why Projects Branch From Batch Base

All projects in a batch need the same initial switch point. If one project succeeds and merges into the batch branch, a different failed project must still be able to restart from the original batch start, without accidentally inheriting the successful project's changes.

Project branches are independently testable product candidates. Follow-up work should build on the project branch the user tested unless the user requests a full rollback.

## When A Worker Finishes

```text
project-attached worker exits
project manager merges it into the project branch
project manager may spawn another worker from the updated project branch
```

## When Manual QA Fails

```text
human tells orchestrator what failed
project manager spawns fix worker from the tested project branch
project manager merges fix back into the same project branch
human tests again
```

## When Manual QA Passes

```text
human approves project branch for batch merge
orchestrator merges approved project branch into batch branch
human later approves batch branch for main merge
human pushes main, or explicitly asks an agent to push
```

## When Project QA Requires Rollback

```text
human says rollback project
project manager records current failed project commit
project manager recreates/resets project branch from batch_base_commit
project manager starts fresh workers
human tests project again
```

The project rollback source is the original batch base, not the current batch branch.

## When Batch QA Fails

```text
human says batch needs fixes
orchestrator creates batch-fix project from current batch branch
workers fix combined behavior
orchestrator merges fix into batch branch
human tests batch again
```

If the batch is bad enough to abandon and has not merged to main, mark it abandoned and leave main untouched.

## Branch Lifetime

Worker branches, project branches, and batch branches should not become permanent development branches. The goal is short-lived candidate branches:

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
One broad architectural change per batch.
```
