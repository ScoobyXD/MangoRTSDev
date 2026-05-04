# Worker Protocol

Workers implement bounded pieces of a project. They should have enough freedom to do quality work, but enough recommended scope to reduce merge conflicts with other agents.

## Required Prompt Content

Every worker prompt must include:

- The sacred text from `docs/agents/sacred-text.md`.
- The statement that the worker is one of potentially up to 20 agents.
- The project objective.
- The worker task.
- Recommended primary files/directories.
- The scope freedom rule.
- Required checks.
- Required final report format.

## Scope Freedom Rule

Use this text in worker prompts:

```text
Primary file scope is recommended to reduce merge conflicts. It is not a hard silo. You may edit adjacent files when necessary to complete the task correctly. If you edit outside primary scope, explain each outside-scope edit and why it was necessary. Avoid unrelated cleanup.
```

## What Workers Should Do

1. Read the required docs.
2. Run preflight.
3. Confirm branch/worktree.
4. Inspect relevant files.
5. Implement the task.
6. Add or update tests when behavior changes, or explain why tests are blocked.
7. Run conflict scan.
8. Run focused checks and `fast_verify.ps1`.
9. Commit the worker branch if instructed by the orchestrator.
10. Write a final report and exit.

## What Workers Should Not Do

- Do not push.
- Do not merge to `main`.
- Do not edit global Git config.
- Do not expand into unrelated product areas.
- Do not hide outside-scope edits.
- Do not leave conflict markers.

## Required Worker Final Report

```text
Worker:
worker-<id>-<slug>

Branch:
codex/<id>-<slug>

Project:
project-<id>-<slug>

Primary scope:
<files/directories assigned>

Files changed:
<list>

Outside-scope edits:
<none or list with reason>

Hot files touched:
<none or list with reason>

Behavior changed:
<summary>

Tests/checks run:
<commands and results>

Known risks/follow-ups:
<summary>
```

