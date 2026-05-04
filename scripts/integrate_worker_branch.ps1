param(
  [Parameter(Mandatory = $true)]
  [string]$WorkerBranch,

  [string]$MainPath = ".",

  [string]$IntegrationSlug = "",

  [switch]$CommitWorkerChanges,

  [string]$WorkerCommitMessage = "",

  [switch]$UseMergeForWorkerFreshness,

  [switch]$NoMainMerge,

  [switch]$RunFullVerification
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git
Assert-AgentCommand -Name rg

$mainRoot = Resolve-AgentPath -Path $MainPath
Assert-AgentMainWorktree -RepoPath $mainRoot

$workerPath = Get-AgentWorktreePathForBranch -MainPath $mainRoot -BranchName $WorkerBranch
if (-not $workerPath) {
  throw "Could not find a worktree for worker branch '$WorkerBranch'."
}

$workerStatus = Invoke-AgentGit -RepoPath $workerPath -Arguments @("status", "--porcelain")
if ($workerStatus) {
  if (-not $CommitWorkerChanges) {
    Write-Host "Worker branch has uncommitted changes:"
    $workerStatus | ForEach-Object { Write-Host $_ }
    throw "Rerun with -CommitWorkerChanges after reviewing the worker changes, or commit them manually."
  }

  if ([string]::IsNullOrWhiteSpace($WorkerCommitMessage)) {
    $WorkerCommitMessage = "worker: commit $WorkerBranch changes"
  }

  Invoke-AgentGit -RepoPath $workerPath -Arguments @("add", "-A")
  Invoke-AgentGit -RepoPath $workerPath -Arguments @("commit", "-m", $WorkerCommitMessage)
}

Assert-AgentCleanStatus -RepoPath $workerPath -Context "worker branch $WorkerBranch"
Assert-AgentCleanStatus -RepoPath $mainRoot -Context "main worktree"

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("fetch", "origin")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--ff-only", "origin/main")

if ($UseMergeForWorkerFreshness) {
  Invoke-AgentGit -RepoPath $workerPath -Arguments @("merge", "--no-ff", "origin/main", "-m", "Merge origin/main into $WorkerBranch")
} else {
  Invoke-AgentGit -RepoPath $workerPath -Arguments @("rebase", "origin/main")
}

Invoke-AgentConflictScan -Root $workerPath
Assert-AgentCleanStatus -RepoPath $workerPath -Context "worker branch $WorkerBranch after freshness update"

if ([string]::IsNullOrWhiteSpace($IntegrationSlug)) {
  if ($WorkerBranch.StartsWith("codex/")) {
    $IntegrationSlug = $WorkerBranch.Substring("codex/".Length)
  } else {
    $IntegrationSlug = $WorkerBranch
  }
}

$safeSlug = ConvertTo-AgentSlug -Name $IntegrationSlug
$integrationBranch = "integration/$safeSlug"
$integrationPath = Get-AgentSiblingPath -MainPath $mainRoot -LeafName "MangoOSDev-integration-$safeSlug"

if (Test-AgentBranchExists -RepoPath $mainRoot -BranchName $integrationBranch) {
  throw "Branch '$integrationBranch' already exists."
}

if (Test-Path -LiteralPath $integrationPath) {
  throw "Worktree path '$integrationPath' already exists."
}

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("worktree", "add", "-b", $integrationBranch, $integrationPath, "main")

try {
  Invoke-AgentGit -RepoPath $integrationPath -Arguments @("merge", "--no-ff", $WorkerBranch, "-m", "Integrate $WorkerBranch")
} catch {
  Write-Host "Merge did not complete cleanly. Resolve conflicts in $integrationPath, then run the conflict-marker scan."
  Invoke-AgentGit -RepoPath $integrationPath -Arguments @("status", "--short", "--branch")
  throw
}

Invoke-AgentConflictScan -Root $integrationPath
& (Join-Path $PSScriptRoot "fast_verify.ps1") -Root $integrationPath
if ($LASTEXITCODE -ne 0) {
  throw "fast_verify.ps1 failed."
}

if ($RunFullVerification) {
  Push-Location $integrationPath
  try {
    & node scripts\run_all_tests.mjs
    if ($LASTEXITCODE -ne 0) {
      throw "node scripts\run_all_tests.mjs failed."
    }
  } finally {
    Pop-Location
  }
}

$workerSha = Invoke-AgentGit -RepoPath $workerPath -Arguments @("rev-parse", "--short", "HEAD")
$integrationSha = Invoke-AgentGit -RepoPath $integrationPath -Arguments @("rev-parse", "--short", "HEAD")
$mainSha = $null

if (-not $NoMainMerge) {
  Assert-AgentCleanStatus -RepoPath $mainRoot -Context "main worktree before final integration merge"
  Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--no-ff", $integrationBranch, "-m", "Merge $integrationBranch")
  $mainSha = Invoke-AgentGit -RepoPath $mainRoot -Arguments @("rev-parse", "--short", "HEAD")
}

Write-Host ""
Write-Host "Integration complete."
Write-Host "Worker branch:      $WorkerBranch"
Write-Host "Worker commit:      $workerSha"
Write-Host "Integration branch: $integrationBranch"
Write-Host "Integration commit: $integrationSha"
if ($mainSha) {
  Write-Host "Main merge commit:  $mainSha"
} else {
  Write-Host "Main merge commit:  skipped because -NoMainMerge was set"
}
