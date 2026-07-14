param(
  [string]$TestRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd([char[]]@('\', '/'))
$allowedTestParent = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'tmp')).TrimEnd([char[]]@('\', '/'))
$testLeafPrefix = 'codex-worktree-naming-test-'

if ([string]::IsNullOrWhiteSpace($TestRoot)) {
  $TestRoot = Join-Path $allowedTestParent ($testLeafPrefix + [guid]::NewGuid().ToString('N'))
}
$TestRoot = [System.IO.Path]::GetFullPath($TestRoot).TrimEnd([char[]]@('\', '/'))

function Assert-True {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $script:assertionCount += 1
  if (-not $Condition) {
    throw "Assertion failed: $Message"
  }
}

function Assert-Equal {
  param(
    [AllowNull()]
    [object]$Expected,

    [AllowNull()]
    [object]$Actual,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $script:assertionCount += 1
  if ([string]$Expected -cne [string]$Actual) {
    throw "Assertion failed: $Message`nExpected: '$Expected'`nActual:   '$Actual'"
  }
}

function Assert-Match {
  param(
    [AllowEmptyString()]
    [string]$Value = '',

    [Parameter(Mandatory = $true)]
    [string]$Pattern,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $script:assertionCount += 1
  if ($Value -notmatch $Pattern) {
    throw "Assertion failed: $Message`nValue:   '$Value'`nPattern: '$Pattern'"
  }
}

function Invoke-TestGit {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $fullPath = [System.IO.Path]::GetFullPath($RepoPath).TrimEnd([char[]]@('\', '/'))
  $safeDirectory = $fullPath.Replace('\', '/')
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& git -c "safe.directory=$safeDirectory" -C $fullPath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    $detail = ($output | ForEach-Object { "$_" }) -join "`n"
    throw "git $($Arguments -join ' ') failed in '$fullPath': $detail"
  }

  return $output | ForEach-Object { "$_" }
}

function Invoke-TestPowerShellScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [string[]]$Arguments = @(),

    [AllowEmptyString()]
    [string]$StandardInput = ''
  )

  $escapedScriptPath = $ScriptPath.Replace('"', '\"')
  $argumentParts = New-Object 'System.Collections.Generic.List[string]'
  $argumentParts.Add('-NoLogo')
  $argumentParts.Add('-NoProfile')
  $argumentParts.Add('-ExecutionPolicy')
  $argumentParts.Add('Bypass')
  $argumentParts.Add('-File')
  $argumentParts.Add("`"$escapedScriptPath`"")
  foreach ($argument in $Arguments) {
    $escapedArgument = ([string]$argument).Replace('"', '\"')
    $argumentParts.Add("`"$escapedArgument`"")
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $script:powerShellExe
  $startInfo.Arguments = $argumentParts -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      throw "Could not start PowerShell for '$ScriptPath'."
    }
    if (-not [string]::IsNullOrEmpty($StandardInput)) {
      $process.StandardInput.Write($StandardInput)
    }
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Stdout = $stdout.Trim()
    Stderr = $stderr.Trim()
  }
}
