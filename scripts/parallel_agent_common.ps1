Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AgentPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return (Resolve-Path -LiteralPath $Path).Path
}

function ConvertTo-AgentSafeDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return (Resolve-AgentPath -Path $Path).Replace("\", "/")
}

function Assert-AgentCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-AgentGit {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $safeDirectory = ConvertTo-AgentSafeDirectory -Path $RepoPath
  & git -c "safe.directory=$safeDirectory" -C $RepoPath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE in $RepoPath"
  }
}

function Invoke-AgentGitExitCode {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $safeDirectory = ConvertTo-AgentSafeDirectory -Path $RepoPath
  & git -c "safe.directory=$safeDirectory" -C $RepoPath @Arguments 1>$null
  return $LASTEXITCODE
}

function Get-AgentBranch {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  $branch = Invoke-AgentGit -RepoPath $RepoPath -Arguments @("branch", "--show-current")
  return ($branch | Select-Object -First 1)
}

function Assert-AgentMainWorktree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  $branch = Get-AgentBranch -RepoPath $RepoPath
  if ($branch -ne "main") {
    throw "MainPath must point to a worktree on branch 'main'. Current branch is '$branch'."
  }
}

function Assert-AgentCleanStatus {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [string]$Context = "worktree"
  )

  $status = Invoke-AgentGit -RepoPath $RepoPath -Arguments @("status", "--porcelain")
  if ($status) {
    Write-Host "$Context is not clean:"
    $status | ForEach-Object { Write-Host $_ }
    throw "$Context must be clean before continuing."
  }
}

function ConvertTo-AgentSlug {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $slug = $Name.ToLowerInvariant()
  $slug = $slug -replace "\s+", "-"
  $slug = $slug -replace "[^a-z0-9-]", "-"
  $slug = $slug -replace "-+", "-"
  $slug = $slug.Trim("-")

  if ([string]::IsNullOrWhiteSpace($slug)) {
    throw "Could not create a safe slug from '$Name'."
  }

  return $slug
}

function Test-AgentBranchExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string]$BranchName
  )

  $code = Invoke-AgentGitExitCode -RepoPath $RepoPath -Arguments @("show-ref", "--verify", "--quiet", "refs/heads/$BranchName")
  return ($code -eq 0)
}

function Get-AgentSiblingPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$MainPath,

    [Parameter(Mandatory = $true)]
    [string]$LeafName
  )

  $mainRoot = Resolve-AgentPath -Path $MainPath
  $parent = Split-Path -Parent $mainRoot
  return (Join-Path $parent $LeafName)
}

function Get-AgentWorktreePathForBranch {
  param(
    [Parameter(Mandatory = $true)]
    [string]$MainPath,

    [Parameter(Mandatory = $true)]
    [string]$BranchName
  )

  $lines = Invoke-AgentGit -RepoPath $MainPath -Arguments @("worktree", "list", "--porcelain")
  $currentPath = $null
  foreach ($line in $lines) {
    if ($line.StartsWith("worktree ")) {
      $currentPath = $line.Substring("worktree ".Length)
      continue
    }

    if ($line -eq "branch refs/heads/$BranchName") {
      return $currentPath
    }
  }

  return $null
}

function Invoke-AgentConflictScan {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $scanScript = Join-Path $PSScriptRoot "check_conflict_markers.ps1"
  & $scanScript -Root $Root
  if ($LASTEXITCODE -ne 0) {
    throw "Conflict marker scan failed for $Root."
  }
}

function Invoke-AgentPowerShellSyntaxCheck {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Paths
  )

  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }

    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count -gt 0) {
      $parseErrors | ForEach-Object { Write-Error "${path}: $($_.Message)" }
      throw "PowerShell syntax check failed for $path."
    }
  }
}
