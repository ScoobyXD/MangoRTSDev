. (Join-Path $PSScriptRoot 'mango_worktree_test_assertions.ps1')

function Invoke-NamingHook {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WorktreePath,

    [Parameter(Mandatory = $true)]
    [string]$Prompt,

    [string]$EventName = 'UserPromptSubmit'
  )

  $hookInput = [ordered]@{
    hook_event_name = $EventName
    cwd = $WorktreePath
    prompt = $Prompt
  } | ConvertTo-Json -Depth 4 -Compress

  $result = Invoke-TestPowerShellScript -ScriptPath $script:hookPath -StandardInput $hookInput
  Assert-Equal -Expected 0 -Actual $result.ExitCode -Message "hook process should succeed for '$WorktreePath' (stderr: $($result.Stderr))"
  return $result
}

function New-SecondaryWorktree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [AllowEmptyString()]
    [string]$BranchName = ''
  )

  $parent = Join-Path $TestRoot $Name
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $path = Join-Path $parent 'MangoRTSDev'
  if ([string]::IsNullOrWhiteSpace($BranchName)) {
    Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('worktree', 'add', '--detach', $path, 'main') | Out-Null
  } else {
    Invoke-TestGit -RepoPath $script:temporaryRepo -Arguments @('worktree', 'add', '-b', $BranchName, $path, 'main') | Out-Null
  }
  return $path
}

function Get-CurrentBranch {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  return (Invoke-TestGit -RepoPath $RepoPath -Arguments @('branch', '--show-current') | Select-Object -First 1)
}

function Get-MangoHookRegistrations {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Manifest
  )

  $registrations = @()
  foreach ($group in @($Manifest.hooks.UserPromptSubmit)) {
    if (-not ($group.PSObject.Properties.Name -contains 'hooks')) {
      continue
    }
    foreach ($hook in @($group.hooks)) {
      $commands = @()
      if ($hook.PSObject.Properties.Name -contains 'command') {
        $commands += [string]$hook.command
      }
      if ($hook.PSObject.Properties.Name -contains 'commandWindows') {
        $commands += [string]$hook.commandWindows
      }
      if (($commands -join "`n") -match 'mango_app_worktree_suffix\.ps1') {
        $registrations += ,$hook
      }
    }
  }
  return $registrations
}

function Get-TestFileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
  } finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

function Remove-TestRootSafely {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
  $parentWithSeparator = $allowedTestParent + [System.IO.Path]::DirectorySeparatorChar
  $leaf = Split-Path -Leaf $fullPath
  $insideAllowedParent = $fullPath.StartsWith($parentWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)
  $hasExpectedLeaf = $leaf -match ('^' + [regex]::Escape($testLeafPrefix) + '[0-9a-f]{32}$')
  if (-not $insideAllowedParent -or -not $hasExpectedLeaf) {
    throw "Refusing to recursively remove unexpected test root '$fullPath'."
  }

  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

$script:assertionCount = 0
$script:hookPath = Join-Path $repoRoot 'scripts\codex\mango_app_worktree_suffix.ps1'
$commonPath = Join-Path $repoRoot 'scripts\codex\mango_worktree_naming_common.ps1'
$installerPath = Join-Path $repoRoot 'scripts\install_codex_app_worktree_hook.ps1'
$script:powerShellExe = (Get-Process -Id $PID).Path
if ([string]::IsNullOrWhiteSpace($script:powerShellExe) -or -not (Test-Path -LiteralPath $script:powerShellExe -PathType Leaf)) {
  throw 'Could not resolve the current PowerShell host executable.'
}

$testParentWithSeparator = $allowedTestParent + [System.IO.Path]::DirectorySeparatorChar
Assert-True -Condition $TestRoot.StartsWith($testParentWithSeparator, [System.StringComparison]::OrdinalIgnoreCase) -Message 'test root must stay beneath the repository tmp directory'
Assert-Match -Value (Split-Path -Leaf $TestRoot) -Pattern ('^' + [regex]::Escape($testLeafPrefix) + '[0-9a-f]{32}$') -Message 'test root must use the guarded unique leaf format'
