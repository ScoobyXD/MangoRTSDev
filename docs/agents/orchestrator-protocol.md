# Orchestrator Protocol

The orchestrator is the coordinator. It receives the user's large request, decomposes it into projects and worker assignments, manages the ledger, and decides what agents should exist next.

The orchestrator should not personally do all implementation or all merges. It should delegate implementation to workers and project integration to project merge agents.

## Inputs

The user may give up to three to five top-level project prompts, for example:

```text
Text Editor:
<list of editor behavior/UI changes>

Kanban Board:
<list of Kanban board behavior/UI changes>

Company Explorer:
<list of Company Explorer behavior/UI changes>
```

Each top-level prompt becomes one project.

## Startup Steps

1. Read `docs/agents/sacred-text.md`.
2. Read `docs/agents/current-decisions.md`.
3. Run preflight and inspect current repo/worktree state.
4. Allocate IDs from the ledger:
   - run ID
   - orchestrator ID
   - project IDs
   - worker IDs
   - merge IDs
5. Create or update the run ledger.
6. Create one project integration branch/worktree per project from the chosen base.
7. Split each project into worker assignments.
8. Create worker branches/worktrees from the project integration branch.
9. Spawn workers with the sacred text, project objective, recommended primary file scope, and scope freedom rule.
10. Spawn one project merge agent per project after workers have branches ready to integrate.

## Decomposition Rule

Decompose by likely file ownership and merge collision risk, not by forcing tiny tasks.

Workers should receive recommended primary files/directories. The orchestrator does not need to solve the whole implementation before delegation. Workers are expected to make local engineering decisions within their assignment.

## Authority

The orchestrator owns:

- ID allocation.
- Ledger updates.
- Project creation.
- Worker creation.
- Merge agent creation.
- Deciding when to create replacement workers.
- Deciding when to recreate itself.

The orchestrator does not own:

- Product acceptance. The human owns this.
- Default merge to `main`. This requires explicit human approval.
- Default push to GitHub. This requires explicit human approval.

## When To Spawn New Workers

Spawn initial workers from the project integration branch after the project branch/worktree is created.

Spawn follow-up workers from the latest project integration branch after:

- a worker's changes have been merged into the project integration branch, or
- the human reports a QA issue against the project integration branch.

For unrelated new projects, create a fresh project integration branch from the approved base.

## When To Recreate The Orchestrator

Create a new orchestrator instance when:

- context is getting large,
- a major user request completes,
- all active workers for a run are finished,
- a set of project integration branches is ready for human QA,
- the user provides a new major set of prompts,
- the current orchestrator can safely resume from the ledger.

A fresh orchestrator resumes from:

```text
.agent-state/orchestration.json
.agent-state/counters.json
git worktree list
git branch --list codex/* integration/*
git status for main and active worktrees
```

## Main Rule

```text
Workers do work.
Project merge agents integrate project candidates.
The orchestrator decides what exists next.
The ledger is the source of truth.
The human decides whether a project is good enough for main.
```

