param(
  [string]$Root = ".",
  [string]$BaseRef = "origin/main",
  [switch]$Full
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git
Assert-AgentCommand -Name rg

$repoRoot = Resolve-AgentPath -Path $Root
Invoke-AgentConflictScan -Root $repoRoot

$changed = New-Object System.Collections.Generic.List[string]

function Add-ChangedFiles {
  param([string[]]$Files)
  foreach ($file in $Files) {
    if (-not [string]::IsNullOrWhiteSpace($file) -and -not $changed.Contains($file)) {
      $changed.Add($file)
    }
  }
}

$baseCheckCode = Invoke-AgentGitExitCode -RepoPath $repoRoot -Arguments @("rev-parse", "--verify", "--quiet", $BaseRef)
if ($baseCheckCode -eq 0) {
  Add-ChangedFiles -Files (Invoke-AgentGit -RepoPath $repoRoot -Arguments @("diff", "--name-only", "$BaseRef...HEAD"))
}

Add-ChangedFiles -Files (Invoke-AgentGit -RepoPath $repoRoot -Arguments @("diff", "--name-only", "HEAD"))
Add-ChangedFiles -Files (Invoke-AgentGit -RepoPath $repoRoot -Arguments @("diff", "--cached", "--name-only"))
Add-ChangedFiles -Files (Invoke-AgentGit -RepoPath $repoRoot -Arguments @("ls-files", "--others", "--exclude-standard"))

$changedFiles = @($changed)
if ($changedFiles.Count -eq 0) {
  Write-Host "No changed files detected. Conflict scan passed."
} else {
  Write-Host "Changed files considered by fast verification:"
  $changedFiles | ForEach-Object { Write-Host " - $_" }
}

$scriptFiles = @(
  $changedFiles |
    Where-Object { $_ -like "scripts/*.ps1" } |
    ForEach-Object { Join-Path $repoRoot $_ }
)

if ($scriptFiles.Count -gt 0) {
  Invoke-AgentPowerShellSyntaxCheck -Paths $scriptFiles
  Write-Host "PowerShell syntax checks passed."
}

$frontendChanged = @($changedFiles | Where-Object { $_ -like "frontend/*" }).Count -gt 0
$backendChanged = @($changedFiles | Where-Object { $_ -like "backend/*" }).Count -gt 0

if ($frontendChanged) {
  $npmCommand = "npm"
  if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    $npmCommand = "npm.cmd"
  }

  Assert-AgentCommand -Name $npmCommand
  Push-Location (Join-Path $repoRoot "frontend")
  try {
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed."
    }
  } finally {
    Pop-Location
  }
}

if ($backendChanged) {
  Assert-AgentCommand -Name go
  $backendPath = Join-Path $repoRoot "backend"
  $goCache = Join-Path $backendPath "go-build-cache"
  Push-Location $backendPath
  try {
    $previousGoCache = $env:GOCACHE
    if ([string]::IsNullOrWhiteSpace($env:GOCACHE)) {
      $env:GOCACHE = $goCache
    }
    & go test ./...
    if ($LASTEXITCODE -ne 0) {
      throw "go test ./... failed."
    }
  } finally {
    $env:GOCACHE = $previousGoCache
    Pop-Location
  }
}

if ($Full) {
  Assert-AgentCommand -Name node
  Push-Location $repoRoot
  try {
    & node scripts\run_all_tests.mjs
    if ($LASTEXITCODE -ne 0) {
      throw "node scripts\run_all_tests.mjs failed."
    }
  } finally {
    Pop-Location
  }
}

Write-Host "Fast verification passed."
