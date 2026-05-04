param(
  [string]$Root = "."
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

Assert-AgentCommand -Name git

$repoRoot = Resolve-AgentPath -Path $Root
$safeDirectory = ConvertTo-AgentSafeDirectory -Path $repoRoot

Write-Host "Repo path:"
Write-Host $repoRoot
Write-Host ""

Write-Host "safe.directory:"
Write-Host $safeDirectory
Write-Host ""

Write-Host "Current branch:"
Invoke-AgentGit -RepoPath $repoRoot -Arguments @("branch", "--show-current")
Write-Host ""

Write-Host "git status --short --branch:"
Invoke-AgentGit -RepoPath $repoRoot -Arguments @("status", "--short", "--branch")
Write-Host ""

Write-Host "git worktree list:"
Invoke-AgentGit -RepoPath $repoRoot -Arguments @("worktree", "list")
Write-Host ""

Write-Host "git remote -v:"
Invoke-AgentGit -RepoPath $repoRoot -Arguments @("remote", "-v")
Write-Host ""

Write-Host "Recent codex/* and integration/* branches:"
Invoke-AgentGit -RepoPath $repoRoot -Arguments @(
  "for-each-ref",
  "--format=%(committerdate:short) %(refname:short)",
  "--sort=-committerdate",
  "--count=40",
  "refs/heads/codex",
  "refs/heads/integration"
)
