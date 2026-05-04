# Copy-Paste Prompts

These prompts are the human operating surface for batch orchestration.

Fill in the bracketed sections before pasting. The live ledger is the source of truth after the batch starts.

## Start Batch Prompt

Paste this into a fresh Codex instance from the main MangoRTS worktree, normally:

```text
C:\Users\Jonat\MangoOSDev
```

Prompt:

```text
You are the MangoRTS batch orchestrator agent.

Read first:
- docs/agents/README.md
- docs/agents/sacred-text.md
- docs/agents/current-decisions.md
- docs/agents/batch-workflow.md
- docs/agents/naming-conventions.md
- docs/agents/orchestrator-protocol.md
- docs/agents/state-ledger.md
- docs/agents/prompt-templates.md
- docs/parallel-agent-workflow.md
- docs/parallel-agent-architecture.md
- docs/tests.md

Repo:
C:\Users\Jonat\MangoOSDev

Batch name:
<BatchName>

Projects in this batch:

PROJECT 1:
<ProjectName>
<Paste the full project description and required changes here>

PROJECT 2:
<ProjectName>
<Paste the full project description and required changes here>

PROJECT 3, optional:
<ProjectName>
<Paste the full project description and required changes here>

Rules:
- Use the small-batch workflow.
- Use my naming convention from docs/agents/naming-conventions.md.
- Create a batch branch from current approved main and record batch_base_commit.
- Create every project branch from batch_base_commit, not from the moving batch branch.
- Create or update the .agent-state ledger before creating branches.
- Open a visible PowerShell terminal for every project manager and worker worktree.
- If direct Codex agent spawning is available, spawn project managers and workers. If not, open the terminals and print exact prompts for me to paste into them.
- Project managers may split projects into workers, but worker scope is recommended, not a hard silo.
- Do not push.
- Do not merge to main.
- Do not let project branches merge to the batch branch until I approve that project after manual QA.
- The batch branch is single-writer. Use the orchestrator for project-to-batch merges unless the ledger lock clearly gives one project manager temporary merge ownership.
- Each project manager must report copy-pasteable backend, frontend, and schema commands when the project is ready for QA.
- Run conflict scans and verification as defined in docs/agents/project-merge-agent-protocol.md and docs/tests.md.

At the end of startup, report:
- batch id and branch
- batch base commit
- batch worktree
- project ids and branches
- project worktrees
- project manager prompts or spawned agent ids
- worker plan per project
- visible PowerShell terminals opened
- current ledger file paths
```

## Project QA: Good

Use this when a project branch tested well and should merge into the batch branch.

```text
Project QA result: GOOD.

Project:
<ProjectNameProject-project0000000>

I manually tested the project worktree and the project is approved for batch merge.

Merge this project branch into the batch branch.

Rules:
- Do not merge to main.
- Do not push.
- Use the batch branch recorded in the ledger.
- Confirm this project branch originally started from batch_base_commit.
- Before merging, check the ledger batch merge lock. If another merge is active, stop and report.
- Merge the project branch into the current batch branch with an explicit merge commit.
- Resolve only conflicts relevant to this project and the already-approved batch state.
- Be careful with backend/db/schema.sql and backend/db/migrations/*.sql. Report every schema or migration file touched and any migration filename collision.
- Run:
  powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
  powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
- Run full tests if frontend/backend/schema behavior changed:
  node scripts\run_all_tests.mjs
- Update the ledger.

Final report must include:
- project branch merged
- batch branch
- batch worktree
- merge commit SHA
- checks run and results
- schema/migration files changed, if any
- copy-pasteable backend, frontend, and schema commands for final batch QA if all projects are now merged
```

## Project QA: Fix

Use this when a project branch is close but needs adjustments.

```text
Project QA result: FIX REQUIRED.

Project:
<ProjectNameProject-project0000000>

Problems I found:
<Describe what failed, what looked wrong, and what behavior I expected>

Please make follow-up fixes on this same project.

Rules:
- Do not merge this project into the batch branch yet.
- Do not merge to main.
- Do not push.
- Spawn follow-up workers from the current project branch that I tested.
- Keep worker scopes narrow enough to reduce merge conflicts.
- Preserve all working behavior from the current project branch.
- After follow-up workers finish, merge them back into the project branch one at a time.
- Run conflict scan, fast verification, and relevant full tests.
- Update the ledger.
- Return a fresh project-ready-for-QA report with copy-pasteable backend, frontend, and schema commands.
```

## Project QA: Rollback

Use this when the project is bad enough that it should restart from the original batch switch point.

```text
Project QA result: ROLLBACK PROJECT.

Project:
<ProjectNameProject-project0000000>

Reason:
<Describe why this project should be discarded and restarted>

Roll this project back to the original switch point from the batch branch.

Rules:
- Use batch_base_commit from the ledger.
- Do not reset this project to the current batch branch HEAD.
- Do not discard other projects or any already-approved batch work.
- Do not merge to main.
- Do not push.
- Preserve the failed project branch or record its commit in the ledger before abandoning it.
- Recreate or reset the project branch from batch_base_commit.
- Create fresh workers for the revised project plan.
- Open visible PowerShell terminals for new worker worktrees.
- Update the ledger with the rollback event and new worker IDs.
- Return the new worker plan and project branch/worktree details.
```

## Batch QA: Good

Use this when all approved projects are merged into the batch branch and final combined QA passed.

```text
Batch QA result: GOOD.

Batch:
<BatchName-batch0000000>

I manually tested the batch worktree and everything works.

Merge this batch branch into main.

Rules:
- Do not push.
- Confirm all projects in the ledger are merged, abandoned, or explicitly excluded.
- Confirm the main worktree is clean and at the approved base or latest allowed origin/main state.
- Run conflict scan and full verification on the batch branch before merging:
  powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
  node scripts\run_all_tests.mjs
- Merge the batch branch into main with an explicit merge commit.
- Run conflict scan and full verification on main after the merge.
- Update the ledger.

Final report must include:
- batch branch
- main merge commit SHA
- checks run and results
- schema/migration files included
- final git status
- reminder that I personally push main to GitHub
```

## Batch QA: Fix

Use this when the combined batch has a problem after project branches were merged.

```text
Batch QA result: FIX REQUIRED.

Batch:
<BatchName-batch0000000>

Problems I found:
<Describe what failed in combined batch QA>

Please diagnose and create the smallest safe fix path.

Rules:
- Do not merge to main.
- Do not push.
- If the failure is an interaction between already-approved projects, create a batch-fix project from the current batch branch.
- If the failure clearly belongs to one project, reopen that project and decide whether the fix should branch from the current batch branch or the original project branch. Explain the choice before implementing.
- Spawn focused workers for the fix.
- Merge fixes into the batch branch only after checks pass.
- Run conflict scan, fast verification, and relevant full tests.
- Update the ledger.
- Return fresh batch QA commands.
```

## Batch QA: Rollback

Use this when the entire batch should be abandoned.

```text
Batch QA result: ROLLBACK BATCH.

Batch:
<BatchName-batch0000000>

Reason:
<Describe why the batch should be abandoned>

Roll back the whole batch.

Rules:
- If the batch has not merged to main, do not touch main. Mark the batch abandoned in the ledger and preserve branch/worktree details for later inspection.
- If the batch has already merged to main, do not use git reset --hard. Revert the batch merge commit unless I explicitly authorize a destructive reset.
- Do not push.
- Report all branches/worktrees that are now abandoned or still active.
- Report exact cleanup commands separately; do not run destructive cleanup unless I explicitly approve.
```

