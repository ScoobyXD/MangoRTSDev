# Orchestrator Protocol

The orchestrator is the coordinator. It receives the user's batch request, decomposes it into projects and project manager assignments, manages the ledger, and decides what agents should exist next.

The orchestrator should not personally do all implementation or all merges. It should delegate implementation to workers and project-level integration to project manager agents. The orchestrator owns the batch branch and should normally perform project-to-batch merges.

## Inputs

The user gives one batch prompt with two to four top-level project prompts, for example:

```text
Batch:
UI polish batch

Project 1 - Text Editor:
<list of editor behavior/UI changes>

Project 2 - Kanban Board:
<list of Kanban board behavior/UI changes>

Project 3 - Company Explorer:
<list of Company Explorer behavior/UI changes>
```

Each top-level prompt becomes one project.

## Startup Steps

1. Read `docs/agents/sacred-text.md`.
2. Read `docs/agents/current-decisions.md`.
3. Run preflight and inspect current repo/worktree state.
4. Confirm startup is running from `C:\Users\Jonat\MangoOSDev` on branch `main`.
5. Confirm the main worktree is clean and conflict-marker scan passes.
6. Allocate IDs from the ledger:
   - batch ID
   - orchestrator ID
   - project IDs
   - manager IDs
   - worker IDs
7. Create or update the batch ledger.
8. Record `batch_base_commit` from approved `main`.
9. Create one batch branch and matching Git worktree from `batch_base_commit`.
10. Create one project branch and matching Git worktree per project from `batch_base_commit`.
11. Record every branch/worktree mapping in the ledger.
12. Start one visible PowerShell terminal per project manager worktree.
13. Spawn or prompt one project manager per project.
14. Project managers split each project into worker assignments.
15. Project managers create worker branches and matching Git worktrees from their project branch.
16. Project managers spawn workers with the sacred text, project objective, recommended primary file scope, and scope freedom rule.

## Decomposition Rule

Decompose by likely file ownership and merge collision risk, not by forcing tiny tasks.

Workers should receive recommended primary files/directories. The orchestrator does not need to solve the whole implementation before delegation. Workers are expected to make local engineering decisions within their assignment.

## Authority

The orchestrator owns:

- ID allocation.
- Ledger updates.
- Batch creation.
- Project creation.
- Project manager creation.
- Deciding when to create replacement workers.
- Project-to-batch merge ownership unless explicitly delegated through a ledger lock.
- Final batch-to-main merge only after explicit human approval.
- Deciding when to recreate itself.

The orchestrator does not own:

- Product acceptance. The human owns this.
- Worker implementation details. Workers own their assigned implementation tasks.
- Project-level worker merges. Project managers own these.
- Default merge to `main`. This requires explicit human approval.
- Push to GitHub. This is human action unless explicitly requested.

## When To Spawn New Workers

Initial workers are spawned by the project manager from the project branch after the project branch/worktree is created.

Spawn follow-up workers from the latest project branch after:

- a worker's changes have been merged into the project branch, or
- the human reports a QA issue against the project branch.

For a full project rollback, recreate or reset the project branch from `batch_base_commit`, not from the current batch branch HEAD.

For a batch-level integration bug after projects have merged into the batch branch, create a batch-fix project from current batch branch HEAD.

## When To Recreate The Orchestrator

Create a new orchestrator instance when:

- context is getting large,
- a major user request completes,
- all active workers for a run are finished,
- a set of project branches is ready for human QA,
- projects are merged into the batch branch and final batch QA is ready,
- the user provides a new major set of prompts,
- the current orchestrator can safely resume from the ledger.

A fresh orchestrator resumes from:

```text
.agent-state/orchestration.json
.agent-state/counters.json
git worktree list
git branch --list *batch* *project* worker*
git status for main and active worktrees
```

## Main Rule

```text
Workers do work.
Project managers integrate worker candidates.
The orchestrator decides what exists next.
The orchestrator owns the batch branch.
The ledger is the source of truth.
The human decides whether a project is good enough for the batch and whether a batch is good enough for main.
```
