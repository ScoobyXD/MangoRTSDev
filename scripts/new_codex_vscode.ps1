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

function Get-VsCodeExe {
  $code = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"
  if (-not (Test-Path -LiteralPath $code)) {
    throw "Code.exe was not found at $code"
  }

  return $code
}

function Stop-StaleVsCodeUpdaterProcesses {
  $updaters = @()
  try {
    $updaters = @(Get-CimInstance Win32_Process | Where-Object {
      ($_.Name -like "CodeSetup*") -or ($_.CommandLine -like "*vscode-stable-user-x64*")
    })
  } catch {
    Write-Host "VS Code updater check skipped: $($_.Exception.Message)"
    return
  }

  if ($updaters.Count -eq 0) {
    return
  }

  $now = Get-Date
  foreach ($updater in $updaters) {
    $ageSeconds = 0
    if ($updater.CreationDate) {
      $ageSeconds = ($now - $updater.CreationDate).TotalSeconds
    }

    if (($updater.Name -like "CodeSetup*") -and ($ageSeconds -ge 120)) {
      Write-Host "Stopping stale VS Code updater process PID $($updater.ProcessId): $($updater.Name)"
      try {
        Stop-Process -Id $updater.ProcessId -Force -ErrorAction Stop
      } catch {
        Write-Host "Could not stop VS Code updater PID $($updater.ProcessId): $($_.Exception.Message)"
      }
      continue
    }

    Write-Host "VS Code updater-related process present; leaving it alone: PID $($updater.ProcessId) $($updater.Name)"
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

`$args = @('--new-window', "--user-data-dir=`$userData", "--extensions-dir=`$extensions", `$worktree)
`$p = Start-Process -FilePath `$code -WorkingDirectory `$worktree -ArgumentList `$args -WindowStyle Normal -PassThru
Write-Host ("Started Code.exe PID {0}" -f `$p.Id)
"@
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

if (-not $NoStart) {
  if (-not $SkipUpdaterCheck) {
    Stop-StaleVsCodeUpdaterProcesses
  }

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
