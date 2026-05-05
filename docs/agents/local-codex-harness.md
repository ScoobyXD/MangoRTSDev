# Local Codex Harness

This document defines the preferred execution model when MangoRTS needs many agents. The ChatGPT internal `spawn_agent` harness is useful for small delegation, but it may have a low concurrent-agent cap. MangoRTS orchestration must not depend on that cap being high.

## Default Direction

Use the local machine as the agent harness:

```text
orchestrator script/session
  creates batch + project branches/worktrees
  generates project manager prompt files
  opens or launches one local Codex process per project manager

project manager script/session
  creates project-attached worker branches/worktrees
  generates worker prompt files
  opens or launches local Codex worker processes in waves
  merges workers back into the project branch
```

The local harness still uses the same Git and ledger rules. It only changes how agent sessions are started.

## Why

- Local Codex processes are not child `spawn_agent` threads inside one chat session.
- Work can start from visible worktree folders with project-specific branch names.
- Overflow workers can wait as prompt files instead of failing startup.
- The ledger remains the durable source of truth if a terminal dies.

There may still be account, model, API, or CLI rate limits. Those are outside Git and outside the orchestration docs. The workflow must be robust when only a limited number of agents can run concurrently.

## Launch Modes

### Preferred: Local Codex CLI

Scripts may launch Codex locally only after confirming the exact installed CLI command and non-interactive prompt-file support on the machine.

The script should discover this with commands such as:

```powershell
Get-Command codex
codex --help
```

Do not hard-code unverified flags in permanent scripts. The launch command must be recorded in the ledger for each started agent.

Example shape, with placeholders until verified:

```powershell
Start-Process powershell.exe `
  -WorkingDirectory "<WorkerWorktree>" `
  -ArgumentList @(
    "-NoExit",
    "-Command",
    "<codex_cli_command> <prompt_file_flag> <PromptFile>"
  )
```

### Fallback: Visible Terminal Plus Prompt File

If Codex CLI launch cannot be verified, scripts must still:

- create the branch/worktree
- write the exact prompt file
- open a visible PowerShell terminal in the worktree
- print the exact prompt file path for the human
- record `terminal-open-prompt-ready` in the ledger

Opening PowerShell alone does not start an agent. A terminal is only active agent work after a Codex session is launched inside it.

### Optional: ChatGPT Internal Spawn

The internal `spawn_agent` tool can be used for a small number of project managers or workers, but it is not the primary scaling path. If it hits a thread limit, stop using it for additional workers and switch to the local prompt-file/terminal flow.

## Responsibility Split

The orchestrator:

- verifies main/preflight/conflicts
- records `batch_base_commit`
- creates the batch branch/worktree from `batch_base_commit`
- creates every project branch/worktree from `batch_base_commit`
- writes project manager prompts
- starts or opens project manager sessions
- owns project-to-batch merges after human QA approval

The project manager:

- splits its project into worker tasks
- allocates project-attached worker names through the ledger/script path
- creates worker branches/worktrees from the project branch
- writes worker prompts
- starts or opens worker sessions in waves
- merges worker branches back into the project branch
- reports ready-for-human-QA commands

The orchestrator should not create all initial worker branches unless explicitly asked for a full static preallocation. The normal path is project-manager-owned worker creation.

## Concurrency Policy

Prefer waves over giant fan-out:

```text
start project managers
project manager starts first useful worker wave
workers finish and commit
project manager merges and starts next worker wave if needed
```

If a runtime cap is reached:

- do not keep retrying the same failed spawn call
- record the cap in the ledger
- create prompt files for pending agents
- open terminals for pending worktrees if useful
- continue when slots or local CLI sessions are available

## Required Ledger Fields

For every locally launched or prompt-ready agent, record:

```json
{
  "agent_launch_mode": "local-codex-cli | visible-terminal-prompt | internal-spawn",
  "agent_launch_command": "<command or null>",
  "prompt_file": "<absolute prompt path>",
  "terminal_opened": true,
  "terminal_title": "<title>",
  "status": "launched | terminal-open-prompt-ready | completed | blocked"
}
```

For workers, the branch and worktree must use the project-attached worker name from `docs/agents/naming-conventions.md`.
