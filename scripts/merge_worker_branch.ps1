param(
  [Parameter(Mandatory = $true)]
  [Alias("WorkerRef", "WorkerPath")]
  [string]$WorkerBranch,

  [string]$MainPath = ".",

  [switch]$CommitWorkerChanges,

  [string]$WorkerCommitMessage = "",

  [ValidateSet("Full", "Fast", "None")]
  [string]$Verification = "Full"
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git
Assert-AgentCommand -Name rg

function Invoke-GitOneLine {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $lines = @(Invoke-AgentGit -RepoPath $RepoPath -Arguments $Arguments)
  if ($lines.Count -eq 0) {
    return ""
  }

  return [string]($lines | Select-Object -First 1)
}

function ConvertTo-BackendRelativePath {
  param([string]$GitPath)

  if (-not $GitPath.StartsWith("backend/")) {
    return $GitPath
  }

  return ".\" + $GitPath.Substring("backend/".Length).Replace("/", "\")
}

function Write-PsqlScript {
  param([string[]]$SqlPaths)

  Write-Host '$ErrorActionPreference = "Stop"'
  Write-Host 'if (-not $env:DB_HOST) { throw "Set DB_HOST first" }'
  Write-Host 'if (-not $env:DB_PORT) { $env:DB_PORT = "5432" }'
  Write-Host 'if (-not $env:DB_NAME) { throw "Set DB_NAME first" }'
  Write-Host 'if (-not $env:DB_USER) { throw "Set DB_USER first" }'
  Write-Host 'if (-not $env:PGPASSWORD) { throw "Set PGPASSWORD first" }'
  Write-Host 'if (-not $env:PGSSLMODE) { $env:PGSSLMODE = "require" }'
  Write-Host '$dbHost = $env:DB_HOST.Trim()'
  Write-Host 'if ($dbHost.StartsWith("host=")) {'
  Write-Host '  $dbHost = $dbHost.Substring(5)'
  Write-Host '}'
  Write-Host '$files = @('
  foreach ($path in $SqlPaths) {
    $relativePath = ConvertTo-BackendRelativePath -GitPath $path
    Write-Host "  `"$relativePath`""
  }
  Write-Host ')'
  Write-Host 'foreach ($file in $files) {'
  Write-Host '  $path = Join-Path (Get-Location) $file'
  Write-Host '  psql -h $dbHost -p $env:DB_PORT -U $env:DB_USER -d $env:DB_NAME -v ON_ERROR_STOP=1 --single-transaction -f $path'
  Write-Host '  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE for $file" }'
  Write-Host '}'
}

$mainRoot = Resolve-AgentPath -Path $MainPath
Assert-AgentMainWorktree -RepoPath $mainRoot

Write-Host "Main worktree status before merge:"
@(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("status", "--short", "--branch")) | ForEach-Object { Write-Host $_ }

$initialMainDirty = @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("status", "--porcelain"))

Write-Host ""
$workerInput = $WorkerBranch
try {
  $workerReference = Resolve-AgentWorkerReference -MainPath $mainRoot -WorkerInput $workerInput
} catch {
  Write-Host "Worker resolution failed: $($_.Exception.Message)"
  Write-Host ""
  Write-Host "Registered worktrees:"
  @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("worktree", "list")) | ForEach-Object { Write-Host $_ }
  Write-Host ""
  Write-Host "Remotes:"
  @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("remote", "-v")) | ForEach-Object { Write-Host $_ }
  throw
}

$WorkerBranch = [string]$workerReference.Branch
$workerPath = [string]$workerReference.Path

Write-Host "Worker input: $workerInput"
if ($workerReference.Source -eq "path") {
  Write-Host "Resolved worker branch from path: $WorkerBranch"
} else {
  Write-Host "Resolved worker branch from branch input: $WorkerBranch"
}

Write-Host ""
Write-Host "Worker worktree: $workerPath"
Write-Host "Worker status before commit:"
@(Invoke-AgentGit -RepoPath $workerPath -Arguments @("status", "--short", "--branch")) | ForEach-Object { Write-Host $_ }

$workerStatus = @(Invoke-AgentGit -RepoPath $workerPath -Arguments @("status", "--porcelain"))
if ($workerStatus.Count -gt 0) {
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
$workerSha = Invoke-GitOneLine -RepoPath $workerPath -Arguments @("rev-parse", "HEAD")

Write-Host ""
Write-Host "Updating main from origin/main..."
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("fetch", "origin")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--ff-only", "origin/main")

$preMergeHead = Invoke-GitOneLine -RepoPath $mainRoot -Arguments @("rev-parse", "HEAD")

try {
  Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--no-ff", $WorkerBranch, "-m", "Merge branch '$WorkerBranch'")
} catch {
  Write-Host ""
  Write-Host "Merge did not complete cleanly. Current main status:"
  @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("status", "--short", "--branch")) | ForEach-Object { Write-Host $_ }
  throw
}

Invoke-AgentConflictScan -Root $mainRoot

$mergeSha = Invoke-GitOneLine -RepoPath $mainRoot -Arguments @("rev-parse", "HEAD")
$changedByMerge = @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("diff", "--name-only", $preMergeHead, "HEAD"))
$backendChanged = @($changedByMerge | Where-Object { $_ -like "backend/*" })

$dbSqlPaths = New-Object System.Collections.Generic.List[string]
$dbStatusLines = @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("diff", "--name-status", $preMergeHead, "HEAD", "--", "backend/db"))
foreach ($line in $dbStatusLines) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $parts = $line -split "`t"
  if ($parts.Count -lt 2) {
    continue
  }

  $status = $parts[0]
  $path = $parts[$parts.Count - 1]
  if ($status -notmatch "^D" -and $path -match "^backend/db/.*\.sql$" -and -not $dbSqlPaths.Contains($path)) {
    $dbSqlPaths.Add($path)
  }
}

$verificationCommand = "not run"
$verificationResult = "SKIPPED"
$verificationExitCode = 0

if ($Verification -ne "None") {
  if ($Verification -eq "Fast") {
    $verificationCommand = "powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root ."
    try {
      & (Join-Path $PSScriptRoot "fast_verify.ps1") -Root $mainRoot
      if ($LASTEXITCODE -ne 0) {
        $verificationExitCode = $LASTEXITCODE
        $verificationResult = "FAIL exit code $LASTEXITCODE"
      } else {
        $verificationResult = "PASS"
      }
    } catch {
      $verificationExitCode = 1
      $verificationResult = "FAIL $($_.Exception.Message)"
    }
  } else {
    $testScript = Join-Path $mainRoot "scripts\run_all_tests.mjs"
    if (Test-Path -LiteralPath $testScript) {
      Assert-AgentCommand -Name node
      $verificationCommand = "node scripts\run_all_tests.mjs"
      Push-Location $mainRoot
      try {
        & node scripts\run_all_tests.mjs
        if ($LASTEXITCODE -ne 0) {
          $verificationExitCode = $LASTEXITCODE
          $verificationResult = "FAIL exit code $LASTEXITCODE"
        } else {
          $verificationResult = "PASS"
        }
      } catch {
        $verificationExitCode = 1
        $verificationResult = "FAIL $($_.Exception.Message)"
      } finally {
        Pop-Location
      }
    } else {
      $verificationCommand = "powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root ."
      try {
        & (Join-Path $PSScriptRoot "fast_verify.ps1") -Root $mainRoot
        if ($LASTEXITCODE -ne 0) {
          $verificationExitCode = $LASTEXITCODE
          $verificationResult = "FAIL exit code $LASTEXITCODE"
        } else {
          $verificationResult = "PASS"
        }
      } catch {
        $verificationExitCode = 1
        $verificationResult = "FAIL $($_.Exception.Message)"
      }
    }
  }
}

$finalStatus = @(Invoke-AgentGit -RepoPath $mainRoot -Arguments @("status", "--short", "--branch"))

Write-Host ""
Write-Host "MERGE WORKER BRANCH RESULT"
Write-Host "Worker input: $workerInput"
Write-Host "Worker branch: $WorkerBranch"
Write-Host "Worker worktree: $workerPath"
Write-Host "Worker commit SHA: $workerSha"
Write-Host "Merge commit SHA: $mergeSha"
Write-Host "Verification command: $verificationCommand"
Write-Host "Verification result: $verificationResult"
Write-Host ""
Write-Host "Changed files from merge:"
if ($changedByMerge.Count -gt 0) {
  $changedByMerge | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host " - none"
}

Write-Host ""
if ($backendChanged.Count -gt 0) {
  Write-Host "Backend files changed: yes"
  $backendChanged | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host "Backend files changed: no"
}

Write-Host ""
Write-Host "Final git status:"
$finalStatus | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "Pre-existing main changes left untouched:"
if ($initialMainDirty.Count -gt 0) {
  $initialMainDirty | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host " - none"
}

if ($dbSqlPaths.Count -gt 0) {
  Write-Host ""
  Write-Host "New DB migration/schema SQL changed by merge:"
  $dbSqlPaths | ForEach-Object { Write-Host " - $_" }
  Write-Host ""
  Write-Host "PowerShell psql script to run from backend:"
  Write-PsqlScript -SqlPaths @($dbSqlPaths)
}

if ($verificationExitCode -ne 0) {
  exit $verificationExitCode
}
