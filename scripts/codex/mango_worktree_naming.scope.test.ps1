. (Join-Path $PSScriptRoot 'mango_worktree_naming_test_helpers.ps1')

try {
  New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
  . $commonPath

  $script:temporaryRepo = Join-Path $TestRoot 'MangoRTSDev'
  New-Item -ItemType Directory -Force -Path $script:temporaryRepo | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('init', '-b', 'main') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('config', 'user.name', 'MangoRTS Test') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('config', 'user.email', 'mangorts-test@example.invalid') | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $script:temporaryRepo 'README.md'), "scope test`n")
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('add', 'README.md') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('commit', '-m', 'test: initialize scope repository') | Out-Null

  $wrongEventWorktree = New-SecondaryWorktree -Name 'wrong-event'
  $wrongEventResult = Invoke-NamingHook -WorktreePath $wrongEventWorktree -Prompt 'MANGORTS_WORKTREE_PURPOSE: should not apply' -EventName 'PostToolUse'
  Assert-Equal -Expected '' -Actual $wrongEventResult.Stdout -Message 'non-UserPromptSubmit events should be silent no-ops'
  Assert-Equal -Expected '' -Actual (Get-CurrentBranch -RepoPath $wrongEventWorktree) -Message 'non-UserPromptSubmit events should leave worktrees detached'

  $otherRepo = Join-Path $TestRoot 'other-primary\OtherProject'
  New-Item -ItemType Directory -Force -Path $otherRepo | Out-Null
  Invoke-TestGit -RepoPath $otherRepo -Arguments @('init', '-b', 'main') | Out-Null
  Invoke-TestGit -RepoPath $otherRepo -Arguments @('config', 'user.name', 'MangoRTS Test') | Out-Null
  Invoke-TestGit -RepoPath $otherRepo -Arguments @('config', 'user.email', 'mangorts-test@example.invalid') | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $otherRepo 'README.md'), "other project`n")
  Invoke-TestGit -RepoPath $otherRepo -Arguments @('add', 'README.md') | Out-Null
  Invoke-TestGit -RepoPath $otherRepo -Arguments @('commit', '-m', 'test: initialize other project') | Out-Null
  $otherWorktree = Join-Path $TestRoot 'other-worker\OtherProject'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $otherWorktree) | Out-Null
  Invoke-TestGit -RepoPath $otherRepo -Arguments @('worktree', 'add', '--detach', $otherWorktree, 'main') | Out-Null
  $otherResult = Invoke-NamingHook -WorktreePath $otherWorktree -Prompt 'MANGORTS_WORKTREE_PURPOSE: should not apply'
  Assert-Equal -Expected '' -Actual $otherResult.Stdout -Message 'non-MangoRTS repositories should be silent no-ops'
  Assert-Equal -Expected '' -Actual (Get-CurrentBranch -RepoPath $otherWorktree) -Message 'non-MangoRTS repositories should remain detached'

  $nonGitPath = Join-Path $TestRoot 'non-git\MangoRTSDev'
  New-Item -ItemType Directory -Force -Path $nonGitPath | Out-Null
  $previousGitCeiling = $env:GIT_CEILING_DIRECTORIES
  try {
    $env:GIT_CEILING_DIRECTORIES = $TestRoot
    $nonGitResult = Invoke-NamingHook -WorktreePath $nonGitPath -Prompt 'MANGORTS_WORKTREE_PURPOSE: should not apply'
  } finally {
    if ($null -eq $previousGitCeiling) {
      Remove-Item Env:GIT_CEILING_DIRECTORIES -ErrorAction SilentlyContinue
    } else {
      $env:GIT_CEILING_DIRECTORIES = $previousGitCeiling
    }
  }
  Assert-Equal -Expected '' -Actual $nonGitResult.Stdout -Message 'non-Git directories should be silent no-ops'

  Write-Host "PASS mango_worktree_naming.scope.test.ps1 ($script:assertionCount assertions)"
} finally {
  Remove-TestRootSafely -Path $TestRoot
}
