Set-StrictMode -Version Latest

$script:MangoCanonicalUuidPattern = '(?i)(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])'
$script:MangoCompactOpaqueHexPattern = '(?i)(?<![0-9a-f])[0-9a-f]{24,64}(?![0-9a-f])'

function Remove-MangoWorktreeOpaqueIdentifiers {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $cleaned = [regex]::Replace($Value, $script:MangoCanonicalUuidPattern, ' ')
  return [regex]::Replace($cleaned, $script:MangoCompactOpaqueHexPattern, ' ')
}

function ConvertTo-MangoWorktreePurposeSlug {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [ValidateRange(1, 120)]
    [int]$MaxLength = 56
  )

  $slug = Remove-MangoWorktreeOpaqueIdentifiers -Value $Name
  $slug = $slug.ToLowerInvariant()
  $slug = $slug -replace '[^a-z]+', '-'
  $slug = $slug -replace '-+', '-'
  $slug = $slug.Trim('-')

  if ($slug.Length -gt $MaxLength) {
    $slug = $slug.Substring(0, $MaxLength).TrimEnd('-')
  }

  if ([string]::IsNullOrWhiteSpace($slug)) {
    throw "Could not create a descriptive English worktree slug from '$Name'."
  }

  return $slug
}

function Get-MangoPromptPurposeCandidate {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt
  )

  $purposeMatch = [regex]::Match(
    $Prompt,
    '(?im)^\s*MANGORTS_WORKTREE_PURPOSE\s*:\s*(?<purpose>[^\r\n]+)'
  )
  if ($purposeMatch.Success) {
    return $purposeMatch.Groups['purpose'].Value
  }

  $inputMatch = [regex]::Match(
    $Prompt,
    '(?is)<input(?:\s[^>]*)?>(?<purpose>.*?)</input>'
  )
  if ($inputMatch.Success) {
    $candidate = $inputMatch.Groups['purpose'].Value
  } else {
    $candidate = $Prompt
  }

  $candidate = [regex]::Replace(
    $candidate,
    '(?is)<source_thread_id(?:\s[^>]*)?>.*?</source_thread_id>',
    ' '
  )
  $candidate = [regex]::Replace($candidate, '<[^>]+>', ' ')
  $candidate = [regex]::Replace($candidate, 'https?://\S+', ' ')
  $candidate = [regex]::Replace(
    $candidate,
    '(?i)^\s*implement\s+this\s+mangortsdev\s+change\s+in\s+your\s+own\s+codex(?:-managed)?\s+git\s+worktree\s*:?',
    ' '
  )
  $candidate = [regex]::Replace(
    $candidate,
    '(?i)\b(hey|hello|hi|please|i|me|my|you|your|we|our|need|want|wants|would|could|should|can|go|ahead|and|the|this|that|a|an|to|for|of|on|in|with|from|do|make|create|new|git|codex|task|user)\b',
    ' '
  )

  return $candidate
}

function Get-MangoWorktreePurposeSlug {
  param(
    [AllowEmptyString()]
    [string]$CurrentBranch = '',

    [AllowEmptyString()]
    [string]$Prompt = ''
  )

  $explicitPurpose = [regex]::Match(
    $Prompt,
    '(?im)^\s*MANGORTS_WORKTREE_PURPOSE\s*:\s*(?<purpose>[^\r\n]+)'
  )
  if ($explicitPurpose.Success) {
    return ConvertTo-MangoWorktreePurposeSlug -Name $explicitPurpose.Groups['purpose'].Value
  }

  if ($CurrentBranch -match '^codex/(?<slug>.+)$') {
    $branchCandidate = $Matches['slug'] -replace '\d{7}$', ''
    try {
      return ConvertTo-MangoWorktreePurposeSlug -Name $branchCandidate
    } catch {
      # A fully opaque app branch should fall back to the submitted purpose.
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($Prompt)) {
    $promptCandidate = Get-MangoPromptPurposeCandidate -Prompt $Prompt
    try {
      return ConvertTo-MangoWorktreePurposeSlug -Name $promptCandidate
    } catch {
      # Keep a stable English fallback when the prompt contains only opaque IDs.
    }
  }

  return 'app-worktree'
}

function Test-MangoCodexWorkerBranchName {
  param(
    [AllowEmptyString()]
    [string]$BranchName = ''
  )

  return ($BranchName -match '^codex/[a-z]+(?:-[a-z]+)*\d{7}$')
}

function Invoke-MangoNamingGitCapture {
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

function Get-MangoNextCodexSuffixNumber {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  $numbers = New-Object 'System.Collections.Generic.List[int]'

  $worktreeLines = Invoke-MangoNamingGitCapture -RepoPath $RepoPath -Arguments @('worktree', 'list', '--porcelain')
  foreach ($line in $worktreeLines) {
    if (-not $line.StartsWith('worktree ')) {
      continue
    }

    $name = Split-Path -Leaf $line.Substring('worktree '.Length)
    $match = [regex]::Match($name, '(\d{7})$')
    if ($match.Success) {
      $numbers.Add([int]$match.Groups[1].Value)
    }
  }

  $branches = Invoke-MangoNamingGitCapture -RepoPath $RepoPath -Arguments @('for-each-ref', '--format=%(refname:short)', 'refs/heads')
  foreach ($branch in $branches) {
    $match = [regex]::Match($branch, '(\d{7})$')
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
