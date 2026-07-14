param(
  [Parameter(Mandatory = $true)]
  [string]$Name,

  [string]$MainPath = ".",

  [switch]$NoStart
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git

$mainRoot = Resolve-AgentPath -Path $MainPath
Assert-AgentMainWorktree -RepoPath $mainRoot
Assert-AgentCleanStatus -RepoPath $mainRoot -Context "main worktree"

$baseSlug = ConvertTo-MangoWorktreePurposeSlug -Name $Name
$suffixNumber = Get-MangoNextCodexSuffixNumber -RepoPath $mainRoot
while ($suffixNumber -le 9999999) {
  $suffix = "{0:D7}" -f $suffixNumber
  $slug = "$baseSlug$suffix"
  $branchName = "codex/$slug"
  $workerPath = Get-AgentSiblingPath -MainPath $mainRoot -LeafName "MangoRTSDev-$slug"

  if ((-not (Test-AgentBranchExists -RepoPath $mainRoot -BranchName $branchName)) -and (-not (Test-Path -LiteralPath $workerPath))) {
    break
  }

  $suffixNumber += 1
}

if ($suffixNumber -gt 9999999) {
  throw "Could not find an available 7-digit worker suffix."
}

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("fetch", "origin")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--ff-only", "origin/main")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("worktree", "add", "-b", $branchName, $workerPath, "main")

$safeWorkerPath = ConvertTo-AgentSafeDirectory -Path $workerPath

Write-Host "Created worker worktree:"
Write-Host "  Branch: $branchName"
Write-Host "  Path:   $workerPath"
Write-Host ""
Write-Host "Initial worker status:"
Invoke-AgentGit -RepoPath $workerPath -Arguments @("status", "--short", "--branch")
Write-Host ""
Write-Host "Paste this into the worker Codex instance:"
Write-Host @"
You are a MangoRTS worker agent.

Task:
<describe task>

Owned files/modules:
<list owned files or module directories>

Read before changing code:
- docs/parallel-agent-refactor-handoff.md
- docs/parallel-agent-workflow.md
- docs/parallel-agent-architecture.md

Before editing, run:
- powershell -ExecutionPolicy Bypass -File .\scripts\agent_preflight.ps1 -Root .
- git -c safe.directory=$safeWorkerPath fetch origin
- git -c safe.directory=$safeWorkerPath rebase origin/main
- powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .

Rules:
- Do not push.
- Do not edit global Git config.
- Keep hot host files thin.
- Run powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root . before final.
"@

if (-not $NoStart) {
  $escapedPath = $workerPath.Replace("'", "''")
  $escapedSafePath = $safeWorkerPath.Replace("'", "''")
  Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location -LiteralPath '$escapedPath'; git -c safe.directory='$escapedSafePath' status --short --branch"
  )
}
