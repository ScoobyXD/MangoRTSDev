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
- The orchestrator receives up to three to five top-level project prompts.
- Each top-level prompt becomes a project.
- The orchestrator pre-creates one integration branch/worktree per project.
- The orchestrator creates workers for each project.
- Each project gets one project merge agent that merges that project's worker branches into that project's integration branch.
- The project merge agent runs checks and reports a testable worktree path plus exact dev commands.
- The human manually tests the project integration branch.
- Agents do not merge to `main` by default.
- Agents do not push by default.

## Scope Model

- Worker scope should be based on recommended primary files/directories.
- Scope is not a hard silo.
- Workers can edit adjacent files when correctness requires it.
- Workers must report all outside-scope edits and why they were needed.
- Avoid hard limits like maximum lines changed, maximum one task, or maximum one hot file touched.
- The approved integration-batch guardrail is: one broad architectural change per project batch.

## Merge Model

- Do not create a large taxonomy of merge agents.
- Use one project merge agent per top-level project prompt.
- Optional specialized branch merge agents can exist later, but they are not the default.
- Project merge agents merge worker branches into the project integration branch one at a time.
- Project merge agents run conflict scans and verification scripts themselves.
- Project merge agents stop at a ready-for-human-QA integration branch unless explicitly asked otherwise.

## Human Acceptance

- The user's role is product QA and final acceptance.
- After the project merge agent reports readiness, the user runs the backend/frontend and tests the change.
- If the user finds problems, they tell the orchestrator what failed.
- The orchestrator creates follow-up workers from the project integration branch.
- If the user likes the result, the user can manually merge/push or explicitly ask an agent to do it.

## Orchestrator Context Control

- The orchestrator must not rely on chat context as the source of truth.
- Durable state should live on disk in an orchestration ledger.
- The orchestrator should recreate itself when context gets large, after major milestones, or before starting a new project batch.
- A fresh orchestrator resumes by reading the ledger and inspecting `git worktree list`, branches, statuses, and integration branches.

