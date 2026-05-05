# Agent Operating Docs

This folder is the one-stop shop for MangoRTS multi-agent development. Start here when a fresh Codex instance needs to resume the orchestration design or run one part of the workflow.

Read in this order:

```text
docs/agents/sacred-text.md
docs/agents/current-decisions.md
docs/agents/naming-conventions.md
docs/agents/batch-workflow.md
docs/agents/orchestrator-protocol.md
docs/agents/local-codex-harness.md
docs/agents/worker-protocol.md
docs/agents/project-merge-agent-protocol.md
docs/agents/lifecycle-and-branching.md
docs/agents/state-ledger.md
docs/agents/dependencies-and-docker-plan.md
docs/agents/prompt-templates.md
docs/agents/copy-paste-prompts.md
```

Related existing references:

```text
docs/parallel-agent-workflow.md
docs/parallel-agent-architecture.md
docs/parallel-agent-refactor-handoff.md
docs/tests.md
```

## Current Model

The preferred model is small batch trains. The user gives the orchestrator a batch containing normally two to four project prompts. The orchestrator creates one batch branch from approved `main`, records the batch base commit, creates one project branch/worktree per project from that same batch base commit, and starts one project manager agent per project.

Project managers split their project into worker tasks and create project-attached worker branches/worktrees. Worker names must show the project, per-project worker number, project ID, and worker ID, for example `FixKanbanBoardCardsUIWorker1-project0001005-worker0095348`. Scope is recommended to reduce merge conflicts, not a hard silo. Workers may edit adjacent files when correctness requires it, but they must report those edits and why.

Each top-level project gets one project manager agent. That manager merges the project's worker branches into the project's project branch, runs checks, and reports exact commands for manual QA. The human tests each project branch and chooses good, fix, or rollback. Approved project branches merge into the batch branch. The human then tests the combined batch branch and chooses good, fix, or rollback. By default, agents do not merge to `main` and do not push.

For scaling, prefer the local Codex harness in `docs/agents/local-codex-harness.md`: generated prompt files, visible worktree terminals, and verified local Codex CLI launches. The ChatGPT internal subagent harness is optional and may have a low concurrency cap; the workflow must not depend on spawning every project manager and worker inside one chat session.

## Core Rule

```text
Agents prepare project and batch branches.
Humans judge product quality.
Main changes only after explicit human approval.
Push happens only by human action or explicit user request.
```
