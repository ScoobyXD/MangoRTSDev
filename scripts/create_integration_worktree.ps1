param(
  [Parameter(Mandatory = $true)]
  [string]$Slug,

  [string]$MainPath = ".",

  [switch]$NoStart
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git

$mainRoot = Resolve-AgentPath -Path $MainPath
Assert-AgentMainWorktree -RepoPath $mainRoot
Assert-AgentCleanStatus -RepoPath $mainRoot -Context "main worktree"

$safeSlug = ConvertTo-AgentSlug -Name $Slug
$branchName = "integration/$safeSlug"
$integrationPath = Get-AgentSiblingPath -MainPath $mainRoot -LeafName "MangoOSDev-integration-$safeSlug"

if (Test-AgentBranchExists -RepoPath $mainRoot -BranchName $branchName) {
  throw "Branch '$branchName' already exists."
}

if (Test-Path -LiteralPath $integrationPath) {
  throw "Worktree path '$integrationPath' already exists."
}

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("fetch", "origin")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("merge", "--ff-only", "origin/main")
Invoke-AgentGit -RepoPath $mainRoot -Arguments @("worktree", "add", "-b", $branchName, $integrationPath, "main")

$safeIntegrationPath = ConvertTo-AgentSafeDirectory -Path $integrationPath

Write-Host "Created integration worktree:"
Write-Host "  Branch: $branchName"
Write-Host "  Path:   $integrationPath"
Write-Host ""
Invoke-AgentGit -RepoPath $integrationPath -Arguments @("status", "--short", "--branch")

if (-not $NoStart) {
  $escapedPath = $integrationPath.Replace("'", "''")
  $escapedSafePath = $safeIntegrationPath.Replace("'", "''")
  Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location -LiteralPath '$escapedPath'; git -c safe.directory='$escapedSafePath' status --short --branch"
  )
}
