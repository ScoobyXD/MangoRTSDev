# Batch Workflow

This is the preferred MangoRTS orchestration model for now.

Use small batch trains instead of an endless project pipeline. A batch should normally contain two to four projects. Eight-project batches are allowed only when the projects are clearly independent and the user explicitly accepts the larger QA and merge surface.

## Core Shape

```text
main
  -> Batch0000154-batch0000154
      -> FixKanbanBoardCardsUIProject-project0001005
          -> FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
          -> FixKanbanBoardCardsUIWorker2-project0001005-worker0095349
          -> FixKanbanBoardCardsUIWorker3-project0001005-worker0095350
      -> EditorTextStyleChangesProject-project0001006
          -> EditorTextStyleChangesWorker1-project0001006-worker0095354
          -> EditorTextStyleChangesWorker2-project0001006-worker0095355
```

The batch branch is the shared candidate for a related group of projects. Each project branch is independently testable before it is merged into the batch branch.

Every branch in the workflow must have a matching Git worktree. Agents work in worktree folders, not in bare branch names.

## Roles

```text
human
  owns product QA and final acceptance

orchestrator agent
  owns batch setup, ledger, project creation, project approvals, batch QA state, and main merge only when explicitly asked

project manager agent
  owns one project branch, worker creation, worker prompts, worker launches, worker merges, project checks, project QA report, project rollback

worker agent
  owns one bounded implementation task
```

The project manager is intentionally boring. It coordinates and merges. It does not replace human product judgment.

Project managers do not need to stay alive forever as watchers. The durable ledger is the thing that stays alive. A project manager can be recreated from the ledger, branch state, and worktree state whenever context gets large or a terminal dies.

## Branch Bases

At batch start, record:

```text
batch_base_branch = main
batch_base_commit = <main sha at batch start>
batch_branch = BatchName-batch0000007
```

Every project branch in the batch is created from `batch_base_commit`, not from whatever the batch branch later becomes.

This matters when one project succeeds and another fails. If project 1 is merged into the batch branch, and project 2 later needs a full rollback, project 2 resets to `batch_base_commit`, not to the current batch branch that already contains project 1.

After project 2 is rebuilt and approved, it merges into the current batch branch. Any conflict with project 1 is resolved at that project-to-batch merge point.

## Branch And Worktree Rule

Create both a branch and a matching Git worktree for every batch, project, and worker:

```text
Batch0000154-batch0000154
C:\Users\Jonat\MangoRTSDev-Batch0000154-batch0000154

FixKanbanBoardCardsUIProject-project0001005
C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIProject-project0001005

FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
C:\Users\Jonat\MangoRTSDev-FixKanbanBoardCardsUIWorker1-project0001005-worker0095348
```

Use this Git shape:

```powershell
git worktree add -b <BranchName> <AbsoluteWorktreePath> <BaseCommitOrBranch>
```

Do not manually create low-level Git tree objects. Git creates tree objects internally when commits are made.

## Normal Flow

```text
1. Human starts a batch from approved main.
2. Orchestrator records batch_base_commit.
3. Orchestrator creates one batch branch and worktree.
4. Orchestrator creates one project branch and worktree per project from batch_base_commit.
5. Orchestrator writes project manager prompts and starts or opens one project manager session per project worktree.
6. Each project manager splits its project into worker tasks.
7. Each project manager creates project-attached worker branches/worktrees from its project branch.
8. Each project manager writes worker prompt files and starts or opens visible worker sessions in waves.
9. Workers commit and report.
10. Project manager merges workers into the project branch one at a time.
11. Project manager runs checks and reports project ready for human QA.
12. Human tests the project branch.
13. Human chooses good, fix, or rollback for the project.
14. Approved project branches merge into the batch branch.
15. Human tests the combined batch branch.
16. Human chooses good, fix, or rollback for the batch.
17. Orchestrator merges batch to main only after explicit approval.
18. Human pushes main.
```

## Project QA Outcomes

### Good

The project branch is approved for batch merge.

The batch branch is a single-writer surface. Prefer having the orchestrator perform project-to-batch merges. If a project manager performs the merge, it must first acquire the batch merge lock in the ledger and release it after checks finish.

### Fix

The project manager creates follow-up workers from the current project branch. Follow-up workers build on the project state the human just tested.

### Rollback

The project manager abandons or archives the current project branch state, recreates or resets the project branch to `batch_base_commit`, creates fresh workers, and starts the project again.

The rollback must not use current batch branch HEAD as the reset point unless the human explicitly asks for that.

## Batch QA Outcomes

### Good

The orchestrator runs full checks on the batch branch, then merges the batch branch to `main` only after explicit human approval. The orchestrator does not push.

### Fix

The orchestrator creates a batch-fix project from the current batch branch when the bug is caused by interaction between already-approved projects. If the bug clearly belongs to one project, the orchestrator can reopen that project and create follow-up workers from the current batch branch or from the original project branch, whichever matches the failure.

### Rollback

If the batch has not merged to `main`, mark the batch abandoned and leave `main` untouched.

If the batch already merged to `main`, revert the batch merge commit. Do not use `git reset --hard` unless the human explicitly asks for that destructive operation.

## Schema And Migration Rule

Database changes require extra reporting:

- List every changed file under `backend/db/schema.sql` and `backend/db/migrations/`.
- Do not edit an already-applied migration unless it has not left the project branch and the user accepts rewriting it.
- Prefer one new migration file per schema behavior change.
- Project managers must include exact schema commands in the QA report.
- The orchestrator must check migration filename collisions before project-to-batch merges.

## Agent Launch Rule

Every new agent worktree should get a visible PowerShell terminal opened at that worktree path.

Opening PowerShell alone does not start an agent. The normal scalable path is the local Codex harness:

1. Write an exact prompt file under `.agent-state/prompts/`.
2. Open a visible terminal in the matching worktree.
3. If the local Codex CLI command and prompt-file flags are verified, launch Codex from that terminal/process.
4. If CLI launch is not verified, report the prompt file for the human to run manually.

The ChatGPT internal `spawn_agent` tool is optional. Do not make startup depend on spawning every project manager and worker through one chat session. If a runtime cap is reached, record the cap in the ledger and continue with local prompt files, terminals, and worker waves.
