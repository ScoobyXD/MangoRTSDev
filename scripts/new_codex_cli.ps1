param(
  [Parameter(Position = 0)]
  [string]$Purpose,

  [string]$MainPath = ".",

  [string]$WorkerParent = (Join-Path "C:\tmp" "MangoRTSDev-workers"),

  [ValidateSet("read-only", "workspace-write", "danger-full-access")]
  [string]$CodexSandbox = "workspace-write",

  [ValidateSet("untrusted", "on-failure", "on-request", "never")]
  [string]$CodexApproval = "never",

  [ValidateSet("elevated", "unelevated")]
  [string]$WindowsSandbox = "elevated",

  [switch]$NoStart
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

function Get-NewestVsCodeCodexExe {
  $extensionsRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
  if (-not (Test-Path -LiteralPath $extensionsRoot)) {
    throw "VS Code extensions directory was not found: $extensionsRoot"
  }

  $extensions = Get-ChildItem -LiteralPath $extensionsRoot -Directory -Filter "openai.chatgpt-*-win32-x64" |
    Sort-Object `
      @{ Expression = {
          $match = [regex]::Match($_.Name, "^openai\.chatgpt-(?<version>[0-9.]+)-win32-x64$")
          if ($match.Success) { [version]$match.Groups["version"].Value } else { [version]"0.0" }
        }; Descending = $true },
      @{ Expression = { $_.LastWriteTime }; Descending = $true }

  foreach ($extension in $extensions) {
    $candidate = Join-Path $extension.FullName "bin\windows-x86_64\codex.exe"
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "VS Code Codex binary was not found under $extensionsRoot"
}

Assert-AgentCommand -Name git
$powerShell7 = Get-AgentPowerShell7Exe

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
$pidValue = ""
$codexExe = ""

if (-not $NoStart) {
  $codexExe = Get-NewestVsCodeCodexExe
  $escapedCodexExe = $codexExe.Replace("'", "''")
  $escapedWindowsSandboxConfig = "windows.sandbox=`"$WindowsSandbox`""
  $codexCommand = @(
    "Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue"
    "Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue"
    "`$env:CLICOLOR = '1'"
    "`$env:TERM = 'xterm-256color'"
    "`$env:COLORTERM = 'truecolor'"
    "`$codexArgs = @('--sandbox', '$CodexSandbox', '--ask-for-approval', '$CodexApproval', '-c', '$escapedWindowsSandboxConfig')"
    "& '$escapedCodexExe' @codexArgs"
  ) -join "; "
  $process = Start-Process -FilePath $powerShell7 -WorkingDirectory $workerPath -ArgumentList @(
    "-NoExit",
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $codexCommand
  ) -PassThru
  $pidValue = $process.Id
}

$mergeScript = Join-Path $mainRoot "scripts\merge_worker_branch.ps1"
$powerShellInvocation = ConvertTo-AgentPowerShellInvocation -Path $powerShell7
$mergeCommand = "$powerShellInvocation -File `"$mergeScript`" -MainPath `"$mainRoot`" -WorkerPath `"$workerPath`" -CommitWorkerChanges -WorkerCommitMessage `"worker: $slug changes`" -Verification Full"

Write-Host "Created Codex worker:"
Write-Host "  Branch: $branchName"
Write-Host "  Path:   $workerPath"
Write-Host "  Parent: $workerParentRoot"
Write-Host "  Base:   local main @ $baseSha"
if ($codexExe) {
  Write-Host "  Codex:  $codexExe"
  Write-Host "  Shell:  $powerShell7"
  Write-Host "  Mode:   sandbox=$CodexSandbox approval=$CodexApproval windowsSandbox=$WindowsSandbox"
}
if ($pidValue) {
  Write-Host "  PID:    $pidValue"
}
Write-Host "  Merge:  $mergeCommand"
