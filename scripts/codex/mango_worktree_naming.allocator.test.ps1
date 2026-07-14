. (Join-Path $PSScriptRoot 'mango_worktree_naming_test_helpers.ps1')

try {
  New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
  . $commonPath

  $worktreeRepo = Join-Path $TestRoot 'worktree-scan\MangoRTSDev'
  New-Item -ItemType Directory -Force -Path $worktreeRepo | Out-Null
  Invoke-TestGit -RepoPath $worktreeRepo -Arguments @('init', '-b', 'main') | Out-Null
  Invoke-TestGit -RepoPath $worktreeRepo -Arguments @('config', 'user.name', 'MangoRTS Test') | Out-Null
  Invoke-TestGit -RepoPath $worktreeRepo -Arguments @('config', 'user.email', 'mangorts-test@example.invalid') | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $worktreeRepo 'README.md'), "allocator worktree scan`n")
  Invoke-TestGit -RepoPath $worktreeRepo -Arguments @('add', 'README.md') | Out-Null
  Invoke-TestGit -RepoPath $worktreeRepo -Arguments @('commit', '-m', 'test: initialize worktree scan') | Out-Null
  $suffixWorktree = Join-Path $TestRoot 'allocator-worker0000075'
  Invoke-TestGit -RepoPath $worktreeRepo -Arguments @('worktree', 'add', '--detach', $suffixWorktree, 'main') | Out-Null
  Assert-Equal -Expected 76 -Actual (Get-MangoNextCodexSuffixNumber -RepoPath $worktreeRepo) -Message 'allocator should scan terminal suffixes from worktree directory names'

  $gapRepo = Join-Path $TestRoot 'large-gap\MangoRTSDev'
  New-Item -ItemType Directory -Force -Path $gapRepo | Out-Null
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('init', '-b', 'main') | Out-Null
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('config', 'user.name', 'MangoRTS Test') | Out-Null
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('config', 'user.email', 'mangorts-test@example.invalid') | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $gapRepo 'README.md'), "allocator gap rule`n")
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('add', 'README.md') | Out-Null
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('commit', '-m', 'test: initialize gap scan') | Out-Null
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('branch', 'codex/nearby-worker0000010') | Out-Null
  Invoke-TestGit -RepoPath $gapRepo -Arguments @('branch', 'codex/imported-worker9999999') | Out-Null
  Assert-Equal -Expected 11 -Actual (Get-MangoNextCodexSuffixNumber -RepoPath $gapRepo) -Message 'allocator should preserve the existing large imported-gap rule'

  Write-Host "PASS mango_worktree_naming.allocator.test.ps1 ($script:assertionCount assertions)"
} finally {
  Remove-TestRootSafely -Path $TestRoot
}
