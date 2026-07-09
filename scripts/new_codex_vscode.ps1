param(
  [Parameter(Position = 0)]
  [string]$Purpose,

  [string]$MainPath = ".",

  [string]$WorkerParent = (Join-Path "C:\tmp" "MangoRTSDev-workers"),

  [switch]$NoStart,

  [switch]$SkipUpdaterCheck
)

. (Join-Path $PSScriptRoot "parallel_agent_common.ps1")

function Get-NextCodexSuffixNumber {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  $numbers = New-Object "System.Collections.Generic.List[int]"

  $worktreeLines = Invoke-AgentGit -RepoPath $RepoPath -Arguments @("worktree", "list", "--porcelain")
  foreach ($line in $worktreeLines) {
    if (-not $line.StartsWith("worktree ")) {
      continue
    }

    $name = Split-Path -Leaf $line.Substring("worktree ".Length)
    $match = [regex]::Match($name, "(\d{7})$")
    if ($match.Success) {
      $numbers.Add([int]$match.Groups[1].Value)
    }
  }

  $branches = Invoke-AgentGit -RepoPath $RepoPath -Arguments @("for-each-ref", "--format=%(refname:short)", "refs/heads")
  foreach ($branch in $branches) {
    $match = [regex]::Match($branch, "(\d{7})$")
    if ($match.Success) {
      $numbers.Add([int]$match.Groups[1].Value)
    }
  }

  if ($numbers.Count -eq 0) {
    return 1
  }

  $ordered = @($numbers | Sort-Object -Unique)
  for ($i = 1; $i -lt $ordered.Count; $i += 1) {
    $gap = $ordered[$i] - $ordered[$i - 1]
    if (($ordered[$i] -ge 100000) -and ($gap -gt 1000)) {
      return ([int]$ordered[$i - 1] + 1)
    }
  }

  return ([int]$ordered[-1] + 1)
}

function ConvertTo-PowerShellSingleQuotedLiteral {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  return "'" + $Value.Replace("'", "''") + "'"
}

function Set-JsonProperty {
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Object,

    [Parameter(Mandatory = $true)]
    [string]$Name,

    [AllowNull()]
    [object]$Value
  )

  $existing = $Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  if ($existing) {
    $existing.Value = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  }
}

function Get-VsCodeExe {
  $code = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"
  if (-not (Test-Path -LiteralPath $code)) {
    throw "Code.exe was not found at $code"
  }

  return $code
}

function Get-VsCodeUpdaterProcesses {
  try {
    return @(Get-CimInstance Win32_Process | Where-Object {
      ($_.Name -like "CodeSetup*") -or ($_.CommandLine -like "*vscode-stable-user-x64*")
    })
  } catch {
    Write-Host "VS Code updater check skipped: $($_.Exception.Message)"
    return @()
  }
}

function Get-ProcessAgeSeconds {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Process,

    [Parameter(Mandatory = $true)]
    [datetime]$Now
  )

  if (-not $Process.CreationDate) {
    return 0
  }

  return ($Now - $Process.CreationDate).TotalSeconds
}

function Get-VsCodeUpdaterCancelPath {
  param(
    [string]$CommandLine
  )

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $null
  }

  $match = [regex]::Match($CommandLine, '/cancel=(?:"([^"]+)"|(\S+))')
  if (-not $match.Success) {
    return $null
  }

  if ($match.Groups[1].Success) {
    return $match.Groups[1].Value
  }

  return $match.Groups[2].Value
}

function Request-VsCodeUpdaterCancel {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Updater
  )

  $cancelPath = Get-VsCodeUpdaterCancelPath -CommandLine $Updater.CommandLine
  if ([string]::IsNullOrWhiteSpace($cancelPath)) {
    return $false
  }

  try {
    New-Item -ItemType File -Path $cancelPath -Force | Out-Null
    Write-Host "Requested VS Code updater cancel via $cancelPath"
    return $true
  } catch {
    Write-Host "Could not request VS Code updater cancel via $cancelPath`: $($_.Exception.Message)"
    return $false
  }
}

function Wait-VsCodeUpdaterReady {
  param(
    [int]$TimeoutSeconds = 180,
    [int]$StaleSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $cancelRequested = New-Object "System.Collections.Generic.HashSet[string]"
  $nextStatusAt = Get-Date

  while ($true) {
    $updaters = @(Get-VsCodeUpdaterProcesses)
    if ($updaters.Count -eq 0) {
      return
    }

    $now = Get-Date
    $status = ($updaters | ForEach-Object {
      $ageSeconds = [int](Get-ProcessAgeSeconds -Process $_ -Now $now)
      "PID $($_.ProcessId) $($_.Name) age ${ageSeconds}s"
    }) -join "; "

    foreach ($updater in $updaters) {
      $ageSeconds = Get-ProcessAgeSeconds -Process $updater -Now $now
      if ($ageSeconds -lt $StaleSeconds) {
        continue
      }

      $cancelPath = Get-VsCodeUpdaterCancelPath -CommandLine $updater.CommandLine
      if ([string]::IsNullOrWhiteSpace($cancelPath) -or $cancelRequested.Contains($cancelPath)) {
        continue
      }

      if (Request-VsCodeUpdaterCancel -Updater $updater) {
        [void]$cancelRequested.Add($cancelPath)
      }
    }

    if ((Get-Date) -ge $deadline) {
      break
    }

    if ((Get-Date) -ge $nextStatusAt) {
      Write-Host "VS Code updater is active; waiting before launch: $status"
      $nextStatusAt = (Get-Date).AddSeconds(15)
    }

    Start-Sleep -Seconds 2
  }

  $remaining = @(Get-VsCodeUpdaterProcesses)
  if ($remaining.Count -eq 0) {
    return
  }

  $now = Get-Date
  foreach ($updater in $remaining) {
    $ageSeconds = Get-ProcessAgeSeconds -Process $updater -Now $now
    if (($updater.Name -like "CodeSetup*") -and ($ageSeconds -ge $StaleSeconds)) {
      Write-Host "Stopping stale VS Code updater process PID $($updater.ProcessId): $($updater.Name)"
      try {
        Stop-Process -Id $updater.ProcessId -Force -ErrorAction Stop
      } catch {
        Write-Host "Could not stop VS Code updater PID $($updater.ProcessId): $($_.Exception.Message)"
      }
      continue
    }

    Write-Host "VS Code updater-related process is still active after waiting: PID $($updater.ProcessId) $($updater.Name)"
  }

  Start-Sleep -Seconds 2
  $stillActive = @(Get-VsCodeUpdaterProcesses)
  if ($stillActive.Count -gt 0) {
    throw "VS Code updater is still active; aborting launch because Code.exe exits while the updater mutex is held."
  }
}

function New-VsCodeLauncherScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Slug,

    [Parameter(Mandatory = $true)]
    [string]$Worktree,

    [Parameter(Mandatory = $true)]
    [string]$UserData,

    [Parameter(Mandatory = $true)]
    [string]$Extensions,

    [Parameter(Mandatory = $true)]
    [string]$Code
  )

  $slugLiteral = ConvertTo-PowerShellSingleQuotedLiteral -Value $Slug
  $worktreeLiteral = ConvertTo-PowerShellSingleQuotedLiteral -Value $Worktree
  $userDataLiteral = ConvertTo-PowerShellSingleQuotedLiteral -Value $UserData
  $extensionsLiteral = ConvertTo-PowerShellSingleQuotedLiteral -Value $Extensions
  $codeLiteral = ConvertTo-PowerShellSingleQuotedLiteral -Value $Code

  return @"
`$ErrorActionPreference = 'Stop'
`$slug = $slugLiteral
`$worktree = $worktreeLiteral
`$userData = $userDataLiteral
`$extensions = $extensionsLiteral
`$code = $codeLiteral

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Get-ChildItem Env:VSCODE_* -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -LiteralPath ("Env:\" + `$_.Name) -ErrorAction SilentlyContinue
}

Write-Host "Launching isolated VS Code for `$slug..."
Write-Host "Worktree: `$worktree"
Write-Host "User data: `$userData"

`$args = @('--new-window', '--disable-workspace-trust', "--user-data-dir=`$userData", "--extensions-dir=`$extensions", '--command', 'chatgpt.openSidebar', `$worktree)
`$p = Start-Process -FilePath `$code -WorkingDirectory `$worktree -ArgumentList `$args -WindowStyle Normal -PassThru
Write-Host ("Started Code.exe PID {0}" -f `$p.Id)
"@
}

function Initialize-CodexVsCodeUserData {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserData
  )

  $userSettingsDir = Join-Path $UserData "User"
  $settingsPath = Join-Path $userSettingsDir "settings.json"

  New-Item -ItemType Directory -Path $userSettingsDir -Force | Out-Null

  $settings = [pscustomobject]@{}
  if (Test-Path -LiteralPath $settingsPath) {
    $rawSettings = Get-Content -LiteralPath $settingsPath -Raw
    if (-not [string]::IsNullOrWhiteSpace($rawSettings)) {
      $settings = $rawSettings | ConvertFrom-Json
      if (($null -eq $settings) -or ($settings -isnot [pscustomobject])) {
        throw "VS Code settings file is not a JSON object: $settingsPath"
      }
    }
  }

  Set-JsonProperty -Object $settings -Name "workbench.colorTheme" -Value "Dark 2026"
  Set-JsonProperty -Object $settings -Name "workbench.iconTheme" -Value "vs-seti"
  Set-JsonProperty -Object $settings -Name "chatgpt.openOnStartup" -Value $true
  Set-JsonProperty -Object $settings -Name "security.workspace.trust.enabled" -Value $false
  Set-JsonProperty -Object $settings -Name "security.workspace.trust.startupPrompt" -Value "never"

  $untrustedWorkspaceSupport = $settings.PSObject.Properties |
    Where-Object { $_.Name -eq "extensions.supportUntrustedWorkspaces" } |
    Select-Object -First 1 -ExpandProperty Value
  if (($null -eq $untrustedWorkspaceSupport) -or ($untrustedWorkspaceSupport -isnot [pscustomobject])) {
    $untrustedWorkspaceSupport = [pscustomobject]@{}
  }

  Set-JsonProperty -Object $untrustedWorkspaceSupport -Name "openai.chatgpt" -Value ([pscustomobject]@{
    supported = $true
  })
  Set-JsonProperty -Object $settings -Name "extensions.supportUntrustedWorkspaces" -Value $untrustedWorkspaceSupport

  $settings | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
}

function Get-VsCodeProcessForUserData {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserData
  )

  Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($UserData)
  }
}

function Wait-VsCodeProcessForUserData {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserData
  )

  for ($i = 0; $i -lt 20; $i += 1) {
    $process = Get-VsCodeProcessForUserData -UserData $UserData | Select-Object -First 1
    if ($process) {
      return $process
    }

    Start-Sleep -Milliseconds 250
  }

  return $null
}

function Get-VsCodeWindowForUserData {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserData
  )

  $processIds = @(Get-VsCodeProcessForUserData -UserData $UserData | Select-Object -ExpandProperty ProcessId)
  if ($processIds.Count -eq 0) {
    return $null
  }

  Get-Process Code -ErrorAction SilentlyContinue | Where-Object {
    ($processIds -contains $_.Id) -and ($_.MainWindowHandle -ne 0)
  } | Select-Object -First 1
}

function Wait-VsCodeWindowForUserData {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UserData
  )

  for ($i = 0; $i -lt 120; $i += 1) {
    $window = Get-VsCodeWindowForUserData -UserData $UserData
    if ($window) {
      return $window
    }

    Start-Sleep -Milliseconds 250
  }

  return $null
}

Assert-AgentCommand -Name git

$mainRoot = Resolve-AgentPath -Path $MainPath
Assert-AgentMainWorktree -RepoPath $mainRoot
$workerParentRoot = Initialize-AgentWorkerParent -Path $WorkerParent

if ([string]::IsNullOrWhiteSpace($Purpose)) {
  $Purpose = Read-Host "Purpose"
}

$baseSlug = ConvertTo-AgentSlug -Name $Purpose

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("fetch", "origin", "main")
$containsRemote = Invoke-AgentGitExitCode -RepoPath $mainRoot -Arguments @("merge-base", "--is-ancestor", "FETCH_HEAD", "main")
if ($containsRemote -ne 0) {
  throw "Local main does not contain the fetched origin/main. Run git pull --ff-only origin main from the main worktree, then retry."
}

if (-not $NoStart) {
  if (-not $SkipUpdaterCheck) {
    Wait-VsCodeUpdaterReady
  }
}

$suffixNumber = Get-NextCodexSuffixNumber -RepoPath $mainRoot
while ($suffixNumber -le 9999999) {
  $suffix = "{0:D7}" -f $suffixNumber
  $slug = "$baseSlug$suffix"
  $branchName = "codex/$slug"
  $workerPath = Join-Path $workerParentRoot "MangoRTSDev-$slug"

  if ((-not (Test-AgentBranchExists -RepoPath $mainRoot -BranchName $branchName)) -and (-not (Test-Path -LiteralPath $workerPath))) {
    break
  }

  $suffixNumber += 1
}

if ($suffixNumber -gt 9999999) {
  throw "Could not find an available 7-digit worker suffix."
}

Invoke-AgentGit -RepoPath $mainRoot -Arguments @("worktree", "add", "-b", $branchName, $workerPath, "main")

$baseSha = Invoke-AgentGit -RepoPath $workerPath -Arguments @("rev-parse", "--short", "HEAD") | Select-Object -First 1
$userData = Join-Path "C:\tmp" "vscode-codex-$slug-user"
$extensions = Join-Path $env:USERPROFILE ".vscode\extensions"
$code = Get-VsCodeExe
$launcherPid = ""
$codePid = ""

Initialize-CodexVsCodeUserData -UserData $userData

if (-not $NoStart) {
  $script = New-VsCodeLauncherScript -Slug $slug -Worktree $workerPath -UserData $userData -Extensions $extensions -Code $code
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $launcher = Start-Process powershell.exe -WorkingDirectory $workerPath -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    $encoded
  ) -WindowStyle Normal -PassThru
  $launcherPid = $launcher.Id

  $codeProcess = Wait-VsCodeProcessForUserData -UserData $userData
  if ($codeProcess) {
    $codePid = $codeProcess.ProcessId
  }

  $codeWindow = Wait-VsCodeWindowForUserData -UserData $userData
  if ($codeWindow) {
    $codePid = $codeWindow.Id
  }
}

$mergeScript = Join-Path $mainRoot "scripts\merge_worker_branch.ps1"
$mergeCommand = "powershell -ExecutionPolicy Bypass -File `"$mergeScript`" -MainPath `"$mainRoot`" -WorkerPath `"$workerPath`" -CommitWorkerChanges -WorkerCommitMessage `"worker: $slug changes`" -Verification Full"

Write-Host "Created Codex VS Code worker:"
Write-Host "  Branch:    $branchName"
Write-Host "  Path:      $workerPath"
Write-Host "  Parent:    $workerParentRoot"
Write-Host "  User data: $userData"
Write-Host "  Base:      local main @ $baseSha"
Write-Host "  Code:      $code"
if ($launcherPid) {
  Write-Host "  Launcher:  PowerShell PID $launcherPid"
}
if ($codePid) {
  Write-Host "  Code PID:  $codePid"
} elseif (-not $NoStart) {
  Write-Host "  Code PID:  not found by quick command-line check"
}
Write-Host "  Merge:     $mergeCommand"
