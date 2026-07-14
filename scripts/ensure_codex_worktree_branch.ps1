param(
  [Parameter(Mandatory = $true)]
  [string]$Purpose
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& git @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return $output
}

$repoRoot = [string](Invoke-Git -Arguments @("rev-parse", "--show-toplevel") | Select-Object -First 1)
if ((Split-Path -Leaf $repoRoot) -ine "MangoRTSDev") {
  throw "This script only names MangoRTSDev worktrees."
}

$currentBranch = [string](Invoke-Git -Arguments @("branch", "--show-current") | Select-Object -First 1)
if ($currentBranch -match '^codex/[a-z]+(?:-[a-z]+)*\d{7}$') {
  Write-Output $currentBranch
  exit 0
}
if ($currentBranch -and $currentBranch -notmatch '^codex/') {
  throw "Refusing to rename non-Codex branch '$currentBranch'."
}

$slug = $Purpose.ToLowerInvariant() -replace '[^a-z]+', '-'
$slug = $slug.Trim('-')
if (-not $slug) {
  throw "Purpose must contain descriptive English letters."
}
if ($slug.Length -gt 56) {
  $slug = $slug.Substring(0, 56).TrimEnd('-')
}

$numbers = New-Object "System.Collections.Generic.List[int]"
foreach ($line in (Invoke-Git -Arguments @("worktree", "list", "--porcelain"))) {
  if ($line.StartsWith("worktree ")) {
    $leaf = Split-Path -Leaf $line.Substring("worktree ".Length)
    if ($leaf -match '(\d{7})$') { $numbers.Add([int]$Matches[1]) }
  }
}
foreach ($branch in (Invoke-Git -Arguments @("for-each-ref", "--format=%(refname:short)", "refs/heads"))) {
  if ($branch -match '(\d{7})$') { $numbers.Add([int]$Matches[1]) }
}

$suffixNumber = if ($currentBranch -match '(\d{7})$') {
  [int]$Matches[1]
} elseif ($numbers.Count) {
  [int](($numbers | Measure-Object -Maximum).Maximum) + 1
} else {
  1
}

while ($suffixNumber -le 9999999) {
  $branchName = "codex/$slug$('{0:D7}' -f $suffixNumber)"
  & git show-ref --verify --quiet "refs/heads/$branchName"
  if ($LASTEXITCODE -eq 0) {
    $suffixNumber += 1
    continue
  }

  $arguments = if ($currentBranch) { @("branch", "-m", $branchName) } else { @("switch", "--quiet", "-c", $branchName) }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& git @arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -eq 0) {
    Write-Output $branchName
    exit 0
  }

  & git show-ref --verify --quiet "refs/heads/$branchName"
  if ($LASTEXITCODE -ne 0) {
    throw "git $($arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  $suffixNumber += 1
}

throw "No seven-digit Codex worktree suffix is available."
