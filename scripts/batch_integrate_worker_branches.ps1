param(
  [Parameter(Mandatory = $true)]
  [string]$BatchName,

  [Parameter(Mandatory = $true)]
  [string[]]$WorkerBranches,

  [string]$MainPath = ".",

  [switch]$CommitWorkerChanges,

  [switch]$UseMergeForWorkerFreshness,

  [switch]$NoMainMerge,

  [switch]$RunFullVerification
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git
Assert-AgentCommand -Name rg

$mainRoot = Resolve-AgentPath -Path $MainPath
Assert-AgentMainWorktree -RepoPath $mainRoot
Assert-AgentCleanStatus -RepoPath $mainRoot -Context "main worktree"

$safeBatch = ConvertTo-AgentSlug -Name $BatchName
$integrationBranch = "integration/$safeBatch"
$integrationPath = Get-AgentSiblingPath -MainPath $mainRoot -LeafName "MangoRTSDev-integration-$safeBatch"

if (Test-AgentBranchExists -RepoPath $mainRoot -BranchName $integrationBranch) {
  throw "Branch '$integrationBranch' already exists."
}

if (Test-Path -LiteralPath $integrationPath) {
  throw "Worktree path '$integrationPath' already exists."
}

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("fetch", "origin")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--ff-only", "origin/main")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("worktree", "add", "-b", $integrationBranch, $integrationPath, "main")

$included = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

foreach ($workerBranch in $WorkerBranches) {
  Write-Host ""
  Write-Host "Integrating $workerBranch into $integrationBranch"

  try {
    $workerPath = Get-AgentWorktreePathForBranch -MainPath $mainRoot -BranchName $workerBranch
    if (-not $workerPath) {
      throw "No worktree found for $workerBranch."
    }

    $workerStatus = Invoke-AgentGit -RepoPath $workerPath -Arguments @("status", "--porcelain")
    if ($workerStatus) {
      if (-not $CommitWorkerChanges) {
        throw "$workerBranch has uncommitted changes. Commit them or rerun with -CommitWorkerChanges."
      }

      Invoke-AgentGit -RepoPath $workerPath -Arguments @("add", "-A")
      Invoke-AgentGit -RepoPath $workerPath -Arguments @("commit", "-m", "worker: commit $workerBranch changes")
    }

    Assert-AgentCleanStatus -RepoPath $workerPath -Context "worker branch $workerBranch"

    try {
      if ($UseMergeForWorkerFreshness) {
        Invoke-AgentGit -RepoPath $workerPath -Arguments @("merge", "--no-ff", "origin/main", "-m", "Merge origin/main into $workerBranch")
      } else {
        Invoke-AgentGit -RepoPath $workerPath -Arguments @("rebase", "origin/main")
      }
    } catch {
      Invoke-AgentGitExitCode -RepoPath $workerPath -Arguments @("rebase", "--abort") | Out-Null
      Invoke-AgentGitExitCode -RepoPath $workerPath -Arguments @("merge", "--abort") | Out-Null
      throw "Freshness update failed for ${workerBranch}: $($_.Exception.Message)"
    }

    Invoke-AgentConflictScan -Root $workerPath
    Assert-AgentCleanStatus -RepoPath $workerPath -Context "worker branch $workerBranch after freshness update"

    try {
      Invoke-AgentGit -RepoPath $integrationPath -Arguments @("merge", "--no-ff", $workerBranch, "-m", "Integrate $workerBranch into $integrationBranch")
    } catch {
      Invoke-AgentGitExitCode -RepoPath $integrationPath -Arguments @("merge", "--abort") | Out-Null
      throw "Integration merge failed for ${workerBranch}: $($_.Exception.Message)"
    }

    Invoke-AgentConflictScan -Root $integrationPath
    & (Join-Path $PSScriptRoot "fast_verify.ps1") -Root $integrationPath
    if ($LASTEXITCODE -ne 0) {
      throw "fast_verify.ps1 failed after merging $workerBranch."
    }

    $included.Add($workerBranch)
  } catch {
    $message = "$workerBranch skipped: $($_.Exception.Message)"
    Write-Warning $message
    $skipped.Add($message)
  }
}

if ($included.Count -eq 0) {
  throw "No worker branches were integrated into $integrationBranch."
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

$integrationSha = Invoke-AgentGit -RepoPath $integrationPath -Arguments @("rev-parse", "--short", "HEAD")
$mainSha = $null

if (-not $NoMainMerge) {
  Assert-AgentCleanStatus -RepoPath $mainRoot -Context "main worktree before final batch merge"
  Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--no-ff", $integrationBranch, "-m", "Merge $integrationBranch")
  $mainSha = Invoke-AgentGit -RepoPath $mainRoot -Arguments @("rev-parse", "--short", "HEAD")
}

Write-Host ""
Write-Host "Batch integration complete."
Write-Host "Batch branch:       $integrationBranch"
Write-Host "Integration commit: $integrationSha"
if ($mainSha) {
  Write-Host "Main merge commit:  $mainSha"
} else {
  Write-Host "Main merge commit:  skipped because -NoMainMerge was set"
}
Write-Host ""
Write-Host "Included workers:"
$included | ForEach-Object { Write-Host " - $_" }

if ($skipped.Count -gt 0) {
  Write-Host ""
  Write-Host "Skipped workers:"
  $skipped | ForEach-Object { Write-Host " - $_" }
}
