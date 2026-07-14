. (Join-Path $PSScriptRoot 'mango_worktree_naming_test_helpers.ps1')

try {
  New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
  . $commonPath
  $opaqueUuid = '019f5fe2-8311-7fc0-a304-664ba730941e'
  $script:temporaryRepo = Join-Path $TestRoot 'MangoRTSDev'
  New-Item -ItemType Directory -Force -Path $script:temporaryRepo | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('init', '-b', 'main') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('config', 'user.name', 'MangoRTS Test') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('config', 'user.email', 'mangorts-test@example.invalid') | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $script:temporaryRepo 'README.md'), "temporary test repository`n")
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('add', 'README.md') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('commit', '-m', 'test: initialize repository') | Out-Null
  Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('branch', 'codex/existing-worker0000041') | Out-Null

  $primaryResult = Invoke-NamingHook -WorktreePath $script:temporaryRepo -Prompt "MANGORTS_WORKTREE_PURPOSE: rename primary checkout"
  Assert-Equal -Expected '' -Actual $primaryResult.Stdout -Message 'primary checkout should be a silent no-op'
  Assert-Equal -Expected 'main' -Actual (Get-CurrentBranch -RepoPath $script:temporaryRepo) -Message 'primary checkout branch should remain main'

  $delegationPrompt = @"
<codex_delegation>
  <source_thread_id>$opaqueUuid</source_thread_id>
  <input>Fix worktree names</input>
</codex_delegation>
"@
  $detachedOne = New-SecondaryWorktree -Name 'detached-one'
  $detachedOneResult = Invoke-NamingHook -WorktreePath $detachedOne -Prompt $delegationPrompt
  Assert-Equal -Expected 'codex/fix-worktree-names0000042' -Actual (Get-CurrentBranch -RepoPath $detachedOne) -Message 'detached delegation should allocate the next seven-digit suffix'
  Assert-Match -Value $detachedOneResult.Stdout -Pattern 'codex/fix-worktree-names0000042' -Message 'hook context should report the assigned canonical branch'
  Assert-True -Condition ($detachedOneResult.Stdout -notmatch [regex]::Escape($opaqueUuid)) -Message 'hook result should not retain source thread UUID'

  $detachedTwo = New-SecondaryWorktree -Name 'detached-two'
  Invoke-NamingHook -WorktreePath $detachedTwo -Prompt $delegationPrompt | Out-Null
  Assert-Equal -Expected 'codex/fix-worktree-names0000043' -Actual (Get-CurrentBranch -RepoPath $detachedTwo) -Message 'sequential allocation should increment past the existing collision'

  $uuidBranch = "codex/$opaqueUuid-repair-worktree-names0000314"
  $uuidWorktree = New-SecondaryWorktree -Name 'uuid-prefixed' -BranchName $uuidBranch
  Invoke-NamingHook -WorktreePath $uuidWorktree -Prompt 'repair these worktree names' | Out-Null
  Assert-Equal -Expected 'codex/repair-worktree-names0000314' -Actual (Get-CurrentBranch -RepoPath $uuidWorktree) -Message 'UUID-prefixed named branch should retain its existing seven-digit suffix'
  $oldUuidRef = @(Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('for-each-ref', '--format=%(refname:short)', "refs/heads/$uuidBranch"))
  Assert-Equal -Expected 0 -Actual $oldUuidRef.Count -Message 'normalization should remove the old UUID-prefixed ref'

  $compliantWorktree = New-SecondaryWorktree -Name 'compliant' -BranchName 'codex/already-compliant0000315'
  $compliantResult = Invoke-NamingHook -WorktreePath $compliantWorktree -Prompt 'MANGORTS_WORKTREE_PURPOSE: different words'
  Assert-Equal -Expected '' -Actual $compliantResult.Stdout -Message 'compliant branch should be a silent no-op'
  Assert-Equal -Expected 'codex/already-compliant0000315' -Actual (Get-CurrentBranch -RepoPath $compliantWorktree) -Message 'compliant branch should not be renamed'

  $nonCodexWorktree = New-SecondaryWorktree -Name 'non-codex' -BranchName 'feature/leave-me-alone'
  $nonCodexResult = Invoke-NamingHook -WorktreePath $nonCodexWorktree -Prompt 'MANGORTS_WORKTREE_PURPOSE: should not apply'
  Assert-Equal -Expected '' -Actual $nonCodexResult.Stdout -Message 'non-Codex branch should be a silent no-op'
  Assert-Equal -Expected 'feature/leave-me-alone' -Actual (Get-CurrentBranch -RepoPath $nonCodexWorktree) -Message 'non-Codex branch should not be renamed'

  $normalRepo = $script:temporaryRepo
  $exhaustionRepo = Join-Path $TestRoot 'exhaustion-primary\MangoRTSDev'
  New-Item -ItemType Directory -Force -Path $exhaustionRepo | Out-Null
  Invoke-TestGit -RepoPath $exhaustionRepo -Arguments @('init', '-b', 'main') | Out-Null
  Invoke-TestGit -RepoPath $exhaustionRepo -Arguments @('config', 'user.name', 'MangoRTS Test') | Out-Null
  Invoke-TestGit -RepoPath $exhaustionRepo -Arguments @('config', 'user.email', 'mangorts-test@example.invalid') | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $exhaustionRepo 'README.md'), "temporary exhaustion repository`n")
  Invoke-TestGit -RepoPath $exhaustionRepo -Arguments @('add', 'README.md') | Out-Null
  Invoke-TestGit -RepoPath $exhaustionRepo -Arguments @('commit', '-m', 'test: initialize exhaustion repository') | Out-Null
  Invoke-TestGit -RepoPath $exhaustionRepo -Arguments @('branch', 'codex/maximum-worker9999999') | Out-Null
  $script:temporaryRepo = $exhaustionRepo
  try {
    $exhaustedWorktree = New-SecondaryWorktree -Name 'exhausted'
    $exhaustedResult = Invoke-NamingHook -WorktreePath $exhaustedWorktree -Prompt 'MANGORTS_WORKTREE_PURPOSE: exhausted worker'
    $exhaustedOutput = $exhaustedResult.Stdout | ConvertFrom-Json
    Assert-True -Condition (-not [bool]$exhaustedOutput.continue) -Message 'allocator exhaustion should stop prompt processing'
    Assert-Match -Value ([string]$exhaustedOutput.stopReason) -Pattern 'seven-digit' -Message 'allocator exhaustion should explain why naming could not continue'
    Assert-Match -Value ([string]$exhaustedOutput.systemMessage) -Pattern 'MangoRTS' -Message 'allocator exhaustion should provide visible project context'
    Assert-Equal -Expected '' -Actual (Get-CurrentBranch -RepoPath $exhaustedWorktree) -Message 'failed allocation should leave the worktree detached'
  } finally {
    $script:temporaryRepo = $normalRepo
  }

  Write-Host "PASS mango_worktree_naming.hook.test.ps1 ($script:assertionCount assertions)"
} finally {
  Remove-TestRootSafely -Path $TestRoot
}
