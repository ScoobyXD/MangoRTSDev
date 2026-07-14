. (Join-Path $PSScriptRoot 'mango_worktree_naming_test_helpers.ps1')

try {
  New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
  . $commonPath
  $codexHome = Join-Path $TestRoot 'CodexHome'
  New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
  $manifestPath = Join-Path $codexHome 'hooks.json'
  $originalManifest = [ordered]@{
    version = 17
    unrelatedTopLevel = [ordered]@{ keep = 'unchanged' }
    hooks = [ordered]@{
      PreToolUse = @(
        [ordered]@{
          matcher = 'Shell'
          hooks = @([ordered]@{ type = 'command'; command = 'unrelated-pre-tool-hook.ps1'; timeout = 9 })
        }
      )
      UserPromptSubmit = @(
        [ordered]@{
          matcher = 'all-prompts'
          hooks = @([ordered]@{ type = 'command'; command = 'unrelated-user-prompt-hook.ps1'; timeout = 11 })
        },
        [ordered]@{
          hooks = @(
            [ordered]@{ type = 'command'; command = 'powershell -File stale/mango_app_worktree_suffix.ps1'; timeout = 1 }
            [ordered]@{ type = 'command'; commandWindows = 'powershell -File duplicate/mango_app_worktree_suffix.ps1'; timeout = 2 }
          )
        }
      )
    }
  }
  [System.IO.File]::WriteAllText($manifestPath, (($originalManifest | ConvertTo-Json -Depth 12) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))

  $firstInstall = Invoke-TestPowerShellScript -ScriptPath $installerPath -Arguments @('-CodexHome', $codexHome)
  Assert-Equal -Expected 0 -Actual $firstInstall.ExitCode -Message "first installer run should succeed (stderr: $($firstInstall.Stderr))"
  Assert-True -Condition (Test-Path -LiteralPath "$manifestPath.bak" -PathType Leaf) -Message 'installer should retain a backup when replacing an existing manifest'

  $installedHook = Join-Path $codexHome 'hooks\mango_app_worktree_suffix.ps1'
  $installedCommon = Join-Path $codexHome 'hooks\mango_worktree_naming_common.ps1'
  Assert-Equal -Expected (Get-TestFileSha256 -Path $script:hookPath) -Actual (Get-TestFileSha256 -Path $installedHook) -Message 'installed hook must exactly match committed source'
  Assert-Equal -Expected (Get-TestFileSha256 -Path $commonPath) -Actual (Get-TestFileSha256 -Path $installedCommon) -Message 'installed common library must exactly match committed source'

  $installedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  Assert-Equal -Expected 17 -Actual $installedManifest.version -Message 'installer should preserve unrelated top-level manifest values'
  Assert-Equal -Expected 'unchanged' -Actual $installedManifest.unrelatedTopLevel.keep -Message 'installer should preserve unrelated top-level objects'
  Assert-Equal -Expected 'unrelated-pre-tool-hook.ps1' -Actual $installedManifest.hooks.PreToolUse[0].hooks[0].command -Message 'installer should preserve hooks for unrelated events'
  Assert-Equal -Expected 'all-prompts' -Actual $installedManifest.hooks.UserPromptSubmit[0].matcher -Message 'installer should preserve unrelated UserPromptSubmit groups'
  Assert-Equal -Expected 'unrelated-user-prompt-hook.ps1' -Actual $installedManifest.hooks.UserPromptSubmit[0].hooks[0].command -Message 'installer should preserve unrelated UserPromptSubmit hooks'
  $mangoRegistrations = @(Get-MangoHookRegistrations -Manifest $installedManifest)
  Assert-Equal -Expected 1 -Actual $mangoRegistrations.Count -Message 'installer should replace stale registrations and collapse duplicates'
  Assert-Match -Value ([string]$mangoRegistrations[0].command) -Pattern '^pwsh .*mango_app_worktree_suffix\.ps1' -Message 'portable hook command should use pwsh'
  Assert-Equal -Expected 30 -Actual $mangoRegistrations[0].timeout -Message 'stale hook timeout should be replaced with the canonical value'

  $manifestAfterFirstInstall = [System.IO.File]::ReadAllText($manifestPath)
  $secondInstall = Invoke-TestPowerShellScript -ScriptPath $installerPath -Arguments @('-CodexHome', $codexHome)
  Assert-Equal -Expected 0 -Actual $secondInstall.ExitCode -Message "second installer run should succeed (stderr: $($secondInstall.Stderr))"
  Assert-Equal -Expected $manifestAfterFirstInstall -Actual ([System.IO.File]::ReadAllText($manifestPath)) -Message 'second installer run should leave an already-current manifest byte-for-byte unchanged'
  $manifestAfterSecondInstall = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  Assert-Equal -Expected 1 -Actual @(Get-MangoHookRegistrations -Manifest $manifestAfterSecondInstall).Count -Message 'idempotent installer run should not duplicate registration'

  $checkResult = Invoke-TestPowerShellScript -ScriptPath $installerPath -Arguments @('-CodexHome', $codexHome, '-Check')
  Assert-Equal -Expected 0 -Actual $checkResult.ExitCode -Message "installer -Check should succeed (stderr: $($checkResult.Stderr))"
  Assert-Match -Value $checkResult.Stdout -Pattern 'hook is current' -Message 'installer -Check should report current state'

  [System.IO.File]::AppendAllText($installedHook, "# stale`n")
  $staleFileCheck = Invoke-TestPowerShellScript -ScriptPath $installerPath -Arguments @('-CodexHome', $codexHome, '-Check')
  Assert-True -Condition ($staleFileCheck.ExitCode -ne 0) -Message 'installer -Check should reject stale installed files'
  Assert-Match -Value "$($staleFileCheck.Stdout)`n$($staleFileCheck.Stderr)" -Pattern 'do not match committed source' -Message 'stale-file check should explain the mismatch'

  Copy-Item -LiteralPath $script:hookPath -Destination $installedHook -Force
  $staleManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $staleRegistrations = @(Get-MangoHookRegistrations -Manifest $staleManifest)
  $staleRegistrations[0].timeout = 1
  [System.IO.File]::WriteAllText($manifestPath, (($staleManifest | ConvertTo-Json -Depth 12) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
  $staleRegistrationCheck = Invoke-TestPowerShellScript -ScriptPath $installerPath -Arguments @('-CodexHome', $codexHome, '-Check')
  Assert-True -Condition ($staleRegistrationCheck.ExitCode -ne 0) -Message 'installer -Check should reject a stale registration'
  Assert-Match -Value "$($staleRegistrationCheck.Stdout)`n$($staleRegistrationCheck.Stderr)" -Pattern 'missing or stale' -Message 'stale-registration check should explain the mismatch'

  Write-Host "PASS mango_worktree_naming.installer.test.ps1 ($script:assertionCount assertions)"
} finally {
  Remove-TestRootSafely -Path $TestRoot
}
