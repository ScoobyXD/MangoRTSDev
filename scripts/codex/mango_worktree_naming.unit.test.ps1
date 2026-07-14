. (Join-Path $PSScriptRoot 'mango_worktree_naming_test_helpers.ps1')

try {
  New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
  . $commonPath
  $opaqueUuid = '019f5fe2-8311-7fc0-a304-664ba730941e'
  $slug = ConvertTo-MangoWorktreePurposeSlug -Name "$opaqueUuid Fix Worktree Names 98765"
  Assert-Equal -Expected 'fix-worktree-names' -Actual $slug -Message 'slugging should strip UUIDs and every numeric token'
  Assert-Match -Value $slug -Pattern '^[a-z]+(?:-[a-z]+)*$' -Message 'descriptive slug should contain English letters and word separators only'
  Assert-Equal -Expected 'repair-worktree-names' -Actual (Get-MangoWorktreePurposeSlug -CurrentBranch "codex/$opaqueUuid-repair-worktree-names0000314") -Message 'branch-derived purpose should strip UUID and final suffix'
  Assert-Equal -Expected 'fix-worktree-names' -Actual (Get-MangoWorktreePurposeSlug -Prompt "MANGORTS_WORKTREE_PURPOSE: Fix Worktree Names 123") -Message 'explicit purpose line should win and remove internal digits'
  $compactOpaqueHex = '019f5fe283117fc0a304664ba730941e'
  Assert-Equal -Expected 'fix-worktree-names' -Actual (ConvertTo-MangoWorktreePurposeSlug -Name "$compactOpaqueHex Fix Worktree Names") -Message 'slugging should strip compact opaque hexadecimal identifiers'
  Assert-True -Condition (Test-MangoCodexWorkerBranchName -BranchName 'codex/fix-worktree-names0000123') -Message 'compliant descriptive branch should be recognized'
  Assert-True -Condition (-not (Test-MangoCodexWorkerBranchName -BranchName "codex/$opaqueUuid-fix-worktree-names0000123")) -Message 'UUID-prefixed branch should not be recognized as compliant'

  Write-Host "PASS mango_worktree_naming.unit.test.ps1 ($script:assertionCount assertions)"
} finally {
  Remove-TestRootSafely -Path $TestRoot
}
