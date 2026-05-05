# Current Decisions

This document captures the latest decisions from the orchestration design discussion so a fresh Codex instance can continue without the original chat context.

## Documentation Structure

- `docs/agents/` is the one-stop shop for agent and human operating docs.
- Existing docs remain useful references, especially `docs/parallel-agent-workflow.md`, `docs/parallel-agent-architecture.md`, and `docs/parallel-agent-refactor-handoff.md`.
- The sacred text must live in one clear place and be copied verbatim into every agent prompt.

## Dependency And Docker Direction

- Create one canonical dependency manifest before implementing Docker deeply.
- Preferred future file: `dependencies.yaml` at repo root.
- Dockerfiles and compose files should implement the dependency manifest rather than becoming the only source of truth.
- Planned Docker artifacts:

```text
Dockerfile.backend
Dockerfile.frontend
Dockerfile.agent
docker-compose.yml
```

- `ripgrep` is required for agent scripts. On Windows:

```powershell
winget install BurntSushi.ripgrep.MSVC
```

## Orchestration Model

- The orchestrator coordinates; it should not personally perform all implementation or merge work.
- The preferred workflow is small batch trains, not an endless pipeline.
- A normal batch contains two to four top-level project prompts. Larger batches require explicit human acceptance.
- The orchestrator receives one batch prompt with one section per project.
- The orchestrator creates one batch branch/worktree from approved `main`.
- The orchestrator records `batch_base_commit` before creating project branches.
- Each top-level prompt becomes a project.
- Each project branch/worktree is created from `batch_base_commit`, not from the moving batch branch.
- The orchestrator creates one project manager agent for each project.
- Each project manager creates workers for its project.
- Worker branch/worktree names must be project-attached and human-readable, for example `FixKanbanBoardCardsUIWorker1-project0001005-worker0095348`. Bare worker names such as `worker0095348` are no longer acceptable for this workflow.
- Each project manager merges that project's worker branches into that project's project branch.
- Each project manager runs checks and reports a testable worktree path plus exact backend, frontend, and schema commands.
- The orchestrator should not spawn every worker in the batch by default. It starts project managers; project managers create and launch workers in waves.
- Prefer a local Codex harness for scale: generate prompt files, open visible terminals in the correct worktrees, and launch verified local Codex CLI sessions when available. The ChatGPT internal `spawn_agent` harness is optional and may have a low concurrency cap.
- The human manually tests each project branch and chooses good, fix, or rollback.
- Approved projects merge into the batch branch.
- The human manually tests the final batch branch and chooses good, fix, or rollback.
- Agents do not merge to `main` by default.
- Agents do not push by default.
- The human personally pushes `main` after approval.

## Scope Model

- Worker scope should be based on recommended primary files/directories.
- Scope is not a hard silo.
- Workers can edit adjacent files when correctness requires it.
- Workers must report all outside-scope edits and why they were needed.
- Project managers own worker decomposition and worker creation. The orchestrator may allocate counter ranges or provide scripts, but it should not pre-create all workers unless the human explicitly asks for static preallocation.
- Avoid hard limits like maximum lines changed, maximum one task, or maximum one hot file touched.
- The approved integration-batch guardrail is: one broad architectural change per project batch.

## Merge Model

- Do not create a large taxonomy of manager or merge agents.
- Use one project manager agent per top-level project prompt.
- Optional specialized branch merge agents can exist later, but they are not the default.
- Project managers merge worker branches into the project branch one at a time.
- Project managers run conflict scans and verification scripts themselves.
- Project managers stop at a ready-for-human-QA project branch unless explicitly asked otherwise.
- The batch branch is a single-writer surface. Prefer orchestrator-owned project-to-batch merges.
- If a project manager merges into the batch branch, it must first acquire the batch merge lock in the ledger.

## Human Acceptance

- The user's role is product QA and final acceptance.
- After the project manager reports readiness, the user runs the backend/frontend/schema commands and tests the project branch.
- Project QA has three outcomes: good, fix, or rollback.
- Good means the project can merge into the batch branch.
- Fix means the project manager creates follow-up workers from the current tested project branch.
- Rollback means the project resets to `batch_base_commit`, not to the current batch branch HEAD.
- Final batch QA also has three outcomes: good, fix, or rollback.
- Good means the orchestrator can merge the batch branch to `main` after explicit approval and checks.
- Fix means the orchestrator creates a batch-fix project or reopens an affected project.
- Rollback means the batch is abandoned if not merged to `main`, or reverted if already merged.

## Orchestrator Context Control

- The orchestrator must not rely on chat context as the source of truth.
- Durable state should live on disk in an orchestration ledger.
- Agents are disposable; the ledger is alive.
- The orchestrator should recreate itself when context gets large, after major milestones, or before starting a new project batch.
- A fresh orchestrator resumes by reading the ledger and inspecting `git worktree list`, branches, statuses, batch branches, and project branches.
