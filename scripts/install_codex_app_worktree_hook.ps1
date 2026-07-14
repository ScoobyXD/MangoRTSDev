param(
  [string]$CodexHome = '',

  [switch]$Check
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Set-InstallerProperty {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$InputObject,

    [Parameter(Mandatory = $true)]
    [string]$Name,

    [AllowNull()]
    [object]$Value
  )

  if ($null -ne $InputObject.PSObject.Properties[$Name]) {
    $InputObject.$Name = $Value
  } else {
    $InputObject | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
  }
}

function Test-SameFileHash {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
    return $false
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $sourceStream = [System.IO.File]::OpenRead($Source)
    try {
      $sourceHash = [System.BitConverter]::ToString($sha256.ComputeHash($sourceStream)).Replace('-', '')
    } finally {
      $sourceStream.Dispose()
    }

    $destinationStream = [System.IO.File]::OpenRead($Destination)
    try {
      $destinationHash = [System.BitConverter]::ToString($sha256.ComputeHash($destinationStream)).Replace('-', '')
    } finally {
      $destinationStream.Dispose()
    }
  } finally {
    $sha256.Dispose()
  }
  return ($sourceHash -eq $destinationHash)
}

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    $CodexHome = $env:CODEX_HOME
  } else {
    $CodexHome = Join-Path $HOME '.codex'
  }
}

$sourceHook = Join-Path $PSScriptRoot 'codex\mango_app_worktree_suffix.ps1'
$sourceCommon = Join-Path $PSScriptRoot 'codex\mango_worktree_naming_common.ps1'
foreach ($source in @($sourceHook, $sourceCommon)) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Required committed hook source was not found: $source"
  }
}

$resolvedCodexHome = [System.IO.Path]::GetFullPath($CodexHome).TrimEnd([char[]]@('\', '/'))
$hooksDirectory = Join-Path $resolvedCodexHome 'hooks'
$destinationHook = Join-Path $hooksDirectory 'mango_app_worktree_suffix.ps1'
$destinationCommon = Join-Path $hooksDirectory 'mango_worktree_naming_common.ps1'
$manifestPath = Join-Path $resolvedCodexHome 'hooks.json'

$defaultCodexHome = [System.IO.Path]::GetFullPath((Join-Path $HOME '.codex')).TrimEnd([char[]]@('\', '/'))
$genericHookPath = if ($resolvedCodexHome.Equals($defaultCodexHome, [System.StringComparison]::OrdinalIgnoreCase)) {
  '$HOME/.codex/hooks/mango_app_worktree_suffix.ps1'
} else {
  $destinationHook.Replace('\', '/')
}

$desiredHook = [pscustomobject][ordered]@{
  type = 'command'
  command = "pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$genericHookPath`""
  timeout = 30
  statusMessage = 'Applying MangoRTS seven-digit worktree identity'
}

$runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [System.Runtime.InteropServices.OSPlatform]::Windows
)
if ($runningOnWindows) {
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $windowsCommand = "$windowsPowerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$destinationHook`""
  $desiredHook = [pscustomobject][ordered]@{
    type = $desiredHook.type
    command = $desiredHook.command
    commandWindows = $windowsCommand
    timeout = $desiredHook.timeout
    statusMessage = $desiredHook.statusMessage
  }
}

if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
  $rawManifest = Get-Content -LiteralPath $manifestPath -Raw
  $manifest = if ([string]::IsNullOrWhiteSpace($rawManifest)) {
    [pscustomobject][ordered]@{}
  } else {
    $rawManifest | ConvertFrom-Json
  }
} else {
  $manifest = [pscustomobject][ordered]@{}
}

if ($null -eq $manifest.PSObject.Properties['hooks']) {
  Set-InstallerProperty -InputObject $manifest -Name 'hooks' -Value ([pscustomobject][ordered]@{})
}
if ($null -eq $manifest.hooks.PSObject.Properties['UserPromptSubmit']) {
  Set-InstallerProperty -InputObject $manifest.hooks -Name 'UserPromptSubmit' -Value @()
}

$groups = @($manifest.hooks.UserPromptSubmit)
$manifestChanged = $false
$foundMangoHook = $false
$desiredJson = $desiredHook | ConvertTo-Json -Depth 8 -Compress
for ($groupIndex = 0; $groupIndex -lt $groups.Count; $groupIndex += 1) {
  $group = $groups[$groupIndex]
  if ($null -eq $group.PSObject.Properties['hooks']) {
    continue
  }

  $groupHooks = @($group.hooks)
  $normalizedHooks = @()
  $groupChanged = $false
  for ($hookIndex = 0; $hookIndex -lt $groupHooks.Count; $hookIndex += 1) {
    $candidate = $groupHooks[$hookIndex]
    $commands = @()
    if ($null -ne $candidate.PSObject.Properties['command']) {
      $commands += [string]$candidate.command
    }
    if ($null -ne $candidate.PSObject.Properties['commandWindows']) {
      $commands += [string]$candidate.commandWindows
    }

    $isMangoHook = [bool]($commands -match 'mango_app_worktree_suffix\.ps1')
    if (-not $isMangoHook) {
      $normalizedHooks += ,$candidate
      continue
    }

    if (-not $foundMangoHook) {
      $existingJson = $candidate | ConvertTo-Json -Depth 8 -Compress
      if ($existingJson -ne $desiredJson) {
        $groupChanged = $true
      }
      $normalizedHooks += ,$desiredHook
      $foundMangoHook = $true
    } else {
      $groupChanged = $true
    }
  }

  if ($groupChanged) {
    Set-InstallerProperty -InputObject $group -Name 'hooks' -Value ([object[]]$normalizedHooks)
    $manifestChanged = $true
  }
}

if (-not $foundMangoHook) {
  $groups += [pscustomobject][ordered]@{ hooks = @($desiredHook) }
  $manifestChanged = $true
}
Set-InstallerProperty -InputObject $manifest.hooks -Name 'UserPromptSubmit' -Value $groups

$filesCurrent = (
  (Test-SameFileHash -Source $sourceHook -Destination $destinationHook) -and
  (Test-SameFileHash -Source $sourceCommon -Destination $destinationCommon)
)

if ($Check) {
  if (-not $filesCurrent) {
    throw "Installed MangoRTS Codex hook files do not match committed source under '$PSScriptRoot'."
  }
  if ($manifestChanged) {
    throw "The UserPromptSubmit registration in '$manifestPath' is missing or stale."
  }

  Write-Host "MangoRTS Codex app worktree hook is current: $destinationHook"
  exit 0
}

New-Item -ItemType Directory -Force -Path $hooksDirectory | Out-Null
Copy-Item -LiteralPath $sourceHook -Destination $destinationHook -Force
Copy-Item -LiteralPath $sourceCommon -Destination $destinationCommon -Force

if ($manifestChanged -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  New-Item -ItemType Directory -Force -Path $resolvedCodexHome | Out-Null
  $json = ($manifest | ConvertTo-Json -Depth 16) + [Environment]::NewLine
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $temporaryManifestPath = "$manifestPath.tmp.$PID.$([guid]::NewGuid().ToString('N'))"
  try {
    [System.IO.File]::WriteAllText($temporaryManifestPath, $json, $utf8NoBom)
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      $backupManifestPath = "$manifestPath.bak"
      if ($runningOnWindows) {
        [System.IO.File]::Replace($temporaryManifestPath, $manifestPath, $backupManifestPath, $true)
      } else {
        Copy-Item -LiteralPath $manifestPath -Destination $backupManifestPath -Force
        Move-Item -LiteralPath $temporaryManifestPath -Destination $manifestPath -Force
      }
    } else {
      Move-Item -LiteralPath $temporaryManifestPath -Destination $manifestPath
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryManifestPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryManifestPath -Force
    }
  }
}

Write-Host 'Installed MangoRTS Codex app worktree hook from committed project source.'
Write-Host "  Hook:     $destinationHook"
Write-Host "  Manifest: $manifestPath"
Write-Host 'Restart/reopen Codex if needed and approve the hook trust prompt if its registration changed.'
