# Agent Operating Docs

This folder is the one-stop shop for MangoRTS multi-agent development. Start here when a fresh Codex instance needs to resume the orchestration design or run one part of the workflow.

Read in this order:

```text
docs/agents/sacred-text.md
docs/agents/current-decisions.md
docs/agents/naming-conventions.md
docs/agents/orchestrator-protocol.md
docs/agents/worker-protocol.md
docs/agents/project-merge-agent-protocol.md
docs/agents/lifecycle-and-branching.md
docs/agents/state-ledger.md
docs/agents/dependencies-and-docker-plan.md
docs/agents/prompt-templates.md
```

Related existing references:

```text
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
docs/tests.md
```

## Current Model

The user gives the orchestrator three to five large-ish project prompts. The orchestrator allocates project IDs, pre-creates one integration branch/worktree per project, splits each project into worker tasks, and assigns recommended file scopes to workers.

Workers implement their assigned slices on worker branches. Scope is recommended to reduce merge conflicts, not a hard silo. Workers may edit adjacent files when correctness requires it, but they must report those edits and why.

Each top-level project gets one project merge agent. That merge agent merges the project's worker branches into the project's integration branch, runs checks, and reports exact commands for manual QA. By default, agents do not merge to `main` and do not push. The human tests the integration branch and decides whether to approve, request fixes, drop the project, or manually merge/push.

## Core Rule

```text
Agents prepare project integration branches.
Humans judge product quality.
Main changes only after explicit human approval.
Push happens only by human action or explicit user request.
```

