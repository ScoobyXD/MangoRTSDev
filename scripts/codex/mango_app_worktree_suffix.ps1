Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'mango_worktree_naming_common.ps1')

function Write-HookContext {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  [ordered]@{
    continue = $true
    hookSpecificOutput = [ordered]@{
      hookEventName = 'UserPromptSubmit'
      additionalContext = $Message
    }
  } | ConvertTo-Json -Depth 4 -Compress
}

function Write-HookBlock {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Reason
  )

  [ordered]@{
    continue = $false
    stopReason = $Reason
    systemMessage = $Reason
  } | ConvertTo-Json -Depth 3 -Compress
}

function Normalize-PathValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Test-BranchExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string]$BranchName
  )

  $safeDirectory = (Normalize-PathValue -Path $RepoPath).Replace('\', '/')
  & git -c "safe.directory=$safeDirectory" -C $RepoPath show-ref --verify --quiet "refs/heads/$BranchName"
  return ($LASTEXITCODE -eq 0)
}

try {
  $rawInput = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($rawInput)) {
    exit 0
  }

  $hookInput = $rawInput | ConvertFrom-Json
  if ([string]$hookInput.hook_event_name -ne 'UserPromptSubmit') {
    exit 0
  }

  $cwd = Normalize-PathValue -Path ([string]$hookInput.cwd)
  if (-not (Test-Path -LiteralPath $cwd -PathType Container)) {
    exit 0
  }

  if ($null -eq (Get-Command git -ErrorAction SilentlyContinue)) {
    exit 0
  }

  $safeCwd = $cwd.Replace('\', '/')
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $null = @(& git -c "safe.directory=$safeCwd" -C $cwd rev-parse --is-inside-work-tree 2>&1)
    $repoProbeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($repoProbeExitCode -ne 0) {
    exit 0
  }

  $repoRoot = (Invoke-MangoNamingGitCapture -RepoPath $cwd -Arguments @('rev-parse', '--show-toplevel') | Select-Object -First 1)
  $repoRoot = Normalize-PathValue -Path $repoRoot
  if ((Split-Path -Leaf $repoRoot) -ine 'MangoRTSDev') {
    exit 0
  }

  $worktreeLines = Invoke-MangoNamingGitCapture -RepoPath $repoRoot -Arguments @('worktree', 'list', '--porcelain')
  $primaryLine = $worktreeLines | Where-Object { $_.StartsWith('worktree ') } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($primaryLine)) {
    exit 0
  }
  $primaryRoot = Normalize-PathValue -Path $primaryLine.Substring('worktree '.Length)
  if ($repoRoot.Equals($primaryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    exit 0
  }

  $currentBranch = [string](Invoke-MangoNamingGitCapture -RepoPath $repoRoot -Arguments @('branch', '--show-current') | Select-Object -First 1)
  if (Test-MangoCodexWorkerBranchName -BranchName $currentBranch) {
    exit 0
  }
  if (-not [string]::IsNullOrWhiteSpace($currentBranch) -and $currentBranch -notmatch '^codex/') {
    exit 0
  }

  $baseSlug = Get-MangoWorktreePurposeSlug -CurrentBranch $currentBranch -Prompt ([string]$hookInput.prompt)
  $existingSuffixMatch = [regex]::Match($currentBranch, '(?<suffix>\d{7})$')

  $runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
  )
  $mutexName = if ($runningOnWindows) {
    'Local\MangoRTSDevCodexWorktreeSuffixV1'
  } else {
    'MangoRTSDevCodexWorktreeSuffixV1'
  }
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  $mutexAcquired = $false
  try {
    try {
      $mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(25))
    } catch [System.Threading.AbandonedMutexException] {
      $mutexAcquired = $true
    }
    if (-not $mutexAcquired) {
      throw 'Timed out waiting for the MangoRTS worktree suffix allocator.'
    }

    $branchName = $null
    if ($existingSuffixMatch.Success) {
      $preservedBranchName = "codex/$baseSlug$($existingSuffixMatch.Groups['suffix'].Value)"
      if (-not (Test-BranchExists -RepoPath $repoRoot -BranchName $preservedBranchName)) {
        $branchName = $preservedBranchName
      }
    }

    if ([string]::IsNullOrWhiteSpace($branchName)) {
      $suffixNumber = Get-MangoNextCodexSuffixNumber -RepoPath $repoRoot
      while ($suffixNumber -le 9999999) {
        $suffix = '{0:D7}' -f $suffixNumber
        $candidateBranchName = "codex/$baseSlug$suffix"
        if (-not (Test-BranchExists -RepoPath $repoRoot -BranchName $candidateBranchName)) {
          $branchName = $candidateBranchName
          break
        }
        $suffixNumber += 1
      }

      if ([string]::IsNullOrWhiteSpace($branchName)) {
        throw 'Could not find an available seven-digit worktree suffix.'
      }
    }

    if ([string]::IsNullOrWhiteSpace($currentBranch)) {
      Invoke-MangoNamingGitCapture -RepoPath $repoRoot -Arguments @('switch', '-c', $branchName) | Out-Null
    } else {
      Invoke-MangoNamingGitCapture -RepoPath $repoRoot -Arguments @('branch', '-m', $branchName) | Out-Null
    }
  } finally {
    if ($mutexAcquired) {
      $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
  }

  Write-HookContext -Message "MangoRTS Codex app worktree identity assigned before agent work: branch '$branchName'. The app-owned checkout directory remains internal; use this descriptive seven-digit branch as the canonical worker identity. Do not launch a separate Codex CLI."
} catch {
  Write-HookBlock -Reason "Could not enforce the MangoRTS descriptive seven-digit app-worktree convention: $($_.Exception.Message)"
}
