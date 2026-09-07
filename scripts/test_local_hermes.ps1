# Isolated launcher checks: no Docker engine, database, provider or cloud calls.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local_hermes.ps1')

function Assert-True {
  param([bool]$Value, [string]$Message)
  if (-not $Value) { throw $Message }
}

function Assert-Rejected {
  param([scriptblock]$Action, [string]$Message)
  $rejected = $false
  try { & $Action | Out-Null } catch { $rejected = $_.Exception.Message.Contains($Message) }
  Assert-True $rejected "Expected rejection containing: $Message"
}

$companyA = '11111111-1111-4111-8111-111111111111'
$companyB = '33333333-3333-4333-8333-333333333333'
$userA = '22222222-2222-4222-8222-222222222222'
$userB = '44444444-4444-4444-8444-444444444444'
$profileA = $companyA.Replace('-', '') + $userA.Replace('-', '')
$profileB = $companyB.Replace('-', '') + $userB.Replace('-', '')
$oldVolume = "mangorts-hermes-$companyA-$userA"
$script:fixtureVolumes = @($oldVolume, 'unrelated-volume')
$script:fixtureDockerExit = 0
$script:fixtureSharedContainer = $false
function Invoke-FixtureDocker {
  if (($args -join ' ') -eq 'container inspect --format {{.Id}} mangorts-hermes') {
    $global:LASTEXITCODE = if ($script:fixtureSharedContainer) { 0 } else { 1 }
    return
  }
  Assert-True (($args -join ' ') -eq 'volume ls --format {{.Name}}') 'Unexpected Docker operation in fixture.'
  $script:fixtureVolumes
  $global:LASTEXITCODE = $script:fixtureDockerExit
}

$profiles = @(
  [pscustomobject]@{ company_id = $companyA; user_id = $userA },
  [pscustomobject]@{ company_id = $companyB; user_id = $userB }
)
$settings = Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles $profiles -Docker Invoke-FixtureDocker
Assert-True ($settings.Name -eq 'mangorts-hermes') 'Gateway container must have one shared name.'
Assert-True ($settings.Profiles.Count -eq 2) 'Both memberships must be configured.'
Assert-True ($settings.Profile -eq $profileA -and $settings.Profile.Length -eq 64) 'Profile must preserve the two complete UUIDs.'
Assert-True ($settings.ProfileVolumes[$profileA] -eq $oldVolume) 'Existing account volume must remain the source for its own profile.'
Assert-True ($settings.ProfileVolumes.ContainsKey($profileB) -and $null -eq $settings.ProfileVolumes[$profileB]) 'New account must use its own directory in the shared volume.'
Assert-True ($settings.PreviousName -eq $oldVolume) 'Only the selected account can authorize transition from its previous container.'
Assert-True (-not $settings.RequireExistingCredentials) 'A first gateway startup may create its encrypted credentials.'

Assert-Rejected { Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles @() -Docker Invoke-FixtureDocker } 'existing Mango memberships'
Assert-Rejected { Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles @($profiles[1]) -Docker Invoke-FixtureDocker } 'not a member'
Assert-Rejected { Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles @($profiles[0], $profiles[0]) -Docker Invoke-FixtureDocker } 'duplicate Hermes profile'
Assert-Rejected { Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles @([pscustomobject]@{ company_id = '../other'; user_id = $userA }) -Docker Invoke-FixtureDocker } 'invalid Hermes profile identity'
$script:fixtureDockerExit = 1
Assert-Rejected { Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles $profiles -Docker Invoke-FixtureDocker } 'Unable to inspect'
$script:fixtureDockerExit = 0
Assert-Rejected { Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles $profiles -ActiveRunCount 1 -Docker Invoke-FixtureDocker } 'Finish or Stop every active'
$script:fixtureVolumes += 'mangorts-hermes'
$restarting = Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles $profiles -ActiveRunCount 1 -Docker Invoke-FixtureDocker
Assert-True $restarting.SharedVolumeExists 'An established shared gateway must allow native active-run recovery on restart.'
Assert-True $restarting.RequireExistingCredentials 'An existing shared volume requires the original encrypted credentials.'
$script:fixtureVolumes = @($oldVolume)
$script:fixtureSharedContainer = $true
$existingContainer = Get-LocalHermesSettings -CompanyID $companyA -UserID $userA -Profiles $profiles -Docker Invoke-FixtureDocker
Assert-True $existingContainer.RequireExistingCredentials 'An existing shared container also requires its original encrypted credentials.'

# Cleanup must never stop a different launch sharing the fixed container name.
$script:fixtureLaunchID = 'a' * 32
$script:fixtureContainerID = 'b' * 64
$script:fixtureContainerFound = $true
$script:fixtureStoppedIDs = @()
$script:fixtureDisposed = 0
function Invoke-FixtureCleanupDocker {
  if (($args -join ' ') -eq 'container inspect --format {{.Id}} {{json .Config.Labels}} mangorts-hermes') {
    $global:LASTEXITCODE = if ($script:fixtureContainerFound) { 0 } else { 1 }
    if ($script:fixtureContainerFound) {
      $script:fixtureContainerID + ' ' + (@{ 'mangorts.hermes-launch' = $script:fixtureLaunchID } | ConvertTo-Json -Compress)
    }
    return
  }
  Assert-True (($args[0..3] -join ' ') -eq 'container stop --time 10') 'Unexpected cleanup Docker operation.'
  $script:fixtureStoppedIDs += $args[4]
  $global:LASTEXITCODE = 0
}
$fixtureProcess = [pscustomobject]@{ HasExited = $false }
$fixtureProcess | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $script:fixtureDisposed++ }
$fixtureRuntime = [pscustomobject]@{
  Settings = [pscustomobject]@{ Docker = 'Invoke-FixtureCleanupDocker'; Name = 'mangorts-hermes' }
  Process = $fixtureProcess
  LaunchID = 'a' * 32
}
Stop-LocalHermes -Runtime $fixtureRuntime
Assert-True ($script:fixtureStoppedIDs.Count -eq 1 -and $script:fixtureStoppedIDs[0] -eq $script:fixtureContainerID) 'Cleanup must stop the verified immutable container ID, never the shared name.'
$script:fixtureStoppedIDs = @()
$script:fixtureLaunchID = 'c' * 32
Stop-LocalHermes -Runtime $fixtureRuntime
Assert-True ($script:fixtureStoppedIDs.Count -eq 0) 'A failed or older launcher must leave the replacement container running.'
$script:fixtureContainerFound = $false
Stop-LocalHermes -Runtime $fixtureRuntime
Assert-True ($script:fixtureStoppedIDs.Count -eq 0 -and $script:fixtureDisposed -eq 3) 'Absent containers must be ignored while every process handle is disposed.'
$script:fixtureRestartCommands = @()
function Invoke-FixtureRestartDocker {
  Assert-True ($args[-1] -eq $script:fixtureContainerID) 'Explicit restart must target only the previously inspected immutable container ID.'
  $script:fixtureRestartCommands += $args -join ' '
  $global:LASTEXITCODE = 0
}
Remove-StoppedLocalHermesContainer -Docker Invoke-FixtureRestartDocker -ContainerID $script:fixtureContainerID
Assert-True ($script:fixtureRestartCommands.Count -eq 3 -and $script:fixtureRestartCommands[2] -eq ('container rm ' + $script:fixtureContainerID)) 'Explicit restart must stop, inspect and remove the same container without touching its volume.'
Assert-Rejected { Remove-StoppedLocalHermesContainer -Docker Invoke-FixtureRestartDocker -ContainerID 'mangorts-hermes' } 'Invalid inspected Hermes container identity'

# This fixture runner uses its own PowerShell process; discard an inherited
# integration payload without reading it before checking synthetic input only.
Remove-Item Env:\MANGO_INTEGRATION_SECRETS -ErrorAction SilentlyContinue
$script:fixturePayloadProbes = 0
function Invoke-FixturePayloadDocker {
  Assert-True (($args -join ' ') -eq 'container ls --filter label=mangorts.local-hermes=true --format {{.Names}}') 'Oversized input must be rejected before any container inspection, stop or start.'
  $script:fixturePayloadProbes++
  $global:LASTEXITCODE = 0
}
$oversizedSettings = [pscustomobject]@{
  Docker = 'Invoke-FixturePayloadDocker'; Name = 'mangorts-hermes'; PreviousName = $oldVolume
  HistoryRepairs = @([pscustomobject]@{ company_id = $companyA; user_id = $userA; run_id = ('run_' + ('d' * 32)); session_id = ('x' * 262144) })
}
$syntheticCredentials = [pscustomobject]@{ API_SERVER_KEY = ('fixture-api-' * 4); MANGO_CALLBACK_KEY = ('fixture-callback-' * 4) }
Assert-Rejected { Start-LocalHermes -Settings $oversizedSettings -ServiceCredentials $syntheticCredentials -OpenAIKey 'fixture-provider' -StopExisting } 'runtime payload exceeds 262144 UTF-8 bytes'
Assert-True ($script:fixturePayloadProbes -eq 1) 'Oversized payload preflight must perform only the read-only container listing.'

# DPAPI checks create only disposable fixture credentials, never read the real store.
$fixtureDirectory = Join-Path ([IO.Path]::GetTempPath()) ('mangorts-hermes-fixture-' + [guid]::NewGuid().ToString('N'))
$fixturePath = Join-Path $fixtureDirectory 'service-seeds.dpapi'
$missingPath = Join-Path $fixtureDirectory 'missing.dpapi'
$invalidPath = Join-Path $fixtureDirectory 'invalid.dpapi'
try {
  $firstCredentials = Get-LocalHermesServiceCredentials -Path $fixturePath
  $storedBytes = [IO.File]::ReadAllBytes($fixturePath)
  $storedText = [Text.Encoding]::UTF8.GetString($storedBytes)
  Assert-True (-not $storedText.Contains($firstCredentials.API_SERVER_KEY) -and -not $storedText.Contains($firstCredentials.MANGO_CALLBACK_KEY)) 'Stored fixture credentials must be encrypted.'
  $nextCredentials = Get-LocalHermesServiceCredentials -Path $fixturePath -RequireExisting
  Assert-True ($firstCredentials.API_SERVER_KEY -ceq $nextCredentials.API_SERVER_KEY -and $firstCredentials.MANGO_CALLBACK_KEY -ceq $nextCredentials.MANGO_CALLBACK_KEY) 'Restart must preserve both service credentials exactly.'
  Assert-Rejected { Get-LocalHermesServiceCredentials -Path $missingPath -RequireExisting } 'encrypted service credentials are missing'
  Assert-True (-not [IO.File]::Exists($missingPath)) 'Missing credentials for an existing gateway must never be regenerated.'
  [IO.File]::WriteAllBytes($invalidPath, [Text.Encoding]::UTF8.GetBytes('corrupt fixture'))
  Assert-Rejected { Get-LocalHermesServiceCredentials -Path $invalidPath } 'Unable to read the encrypted'
  Assert-True ([IO.File]::ReadAllText($invalidPath) -eq 'corrupt fixture') 'Unreadable saved credentials must remain unchanged.'
  $invalidJSON = @{ API_SERVER_KEY = ('a' * 32); MANGO_CALLBACK_KEY = ('a' * 32) } | ConvertTo-Json -Compress
  [IO.File]::WriteAllBytes($invalidPath, [Security.Cryptography.ProtectedData]::Protect(
    [Text.Encoding]::UTF8.GetBytes($invalidJSON), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
  ))
  Assert-Rejected { Get-LocalHermesServiceCredentials -Path $invalidPath } 'Unable to read the encrypted'
  $invalidJSON = @{ API_SERVER_KEY = ('a' * 32); MANGO_CALLBACK_KEY = ('b' * 32); OPENAI_API_KEY = 'forbidden-fixture-provider' } | ConvertTo-Json -Compress
  [IO.File]::WriteAllBytes($invalidPath, [Security.Cryptography.ProtectedData]::Protect(
    [Text.Encoding]::UTF8.GetBytes($invalidJSON), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
  ))
  Assert-Rejected { Get-LocalHermesServiceCredentials -Path $invalidPath } 'Unable to read the encrypted'
} finally {
  foreach ($path in @($fixturePath, $missingPath, $invalidPath)) {
    if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) }
  }
  if ([IO.Directory]::Exists($fixtureDirectory)) { [IO.Directory]::Delete($fixtureDirectory) }
}

# Exercise the read-only lookup without an actual psql process or database.
$script:fixtureLookup = @{
  accounts = @([pscustomobject]@{ user_id = $userA; company_id = $companyA; company_name = 'Fixture'; email = 'person@example.test' })
  profiles = $profiles
  active_runs = 3
  history_repairs = @([pscustomobject]@{ company_id = $companyA; user_id = $userA; run_id = ('run_' + ('d' * 32)); session_id = 'literal-native-session' })
}
function Get-Command {
  param([string]$Name, [string]$CommandType, [string]$ErrorAction)
  Assert-True ($Name -eq 'psql' -and $CommandType -eq 'Application') 'Unexpected account lookup executable.'
  [pscustomobject]@{ Source = 'Invoke-FixturePsql' }
}
function Invoke-FixturePsql {
  $script:capturedSQL = $input -join "`n"
  Assert-True (($args -join ' ').Contains('-X -A -t -q -w -v ON_ERROR_STOP=1')) 'Account lookup must disable startup files and password prompts.'
  $script:fixtureLookup | ConvertTo-Json -Depth 5 -Compress
  $global:LASTEXITCODE = 0
}
$savedEnvironment = @{}
try {
  foreach ($name in @('DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, 'fixture', 'Process')
  }
  $lookup = Resolve-LocalHermesScope -Email ' PERSON@EXAMPLE.TEST ' -CompanyID $companyA
  Assert-True ($lookup.CompanyID -eq $companyA -and $lookup.UserID -eq $userA) 'Lookup must retain the selected exact account.'
  Assert-True ($lookup.Profiles.Count -eq 2) 'One read-only lookup must retain all gateway memberships.'
  Assert-True ($lookup.ActiveRunCount -eq 3) 'One-time cutover must receive the active-run count.'
  Assert-True ($lookup.HistoryRepairs.Count -eq 0 -and -not $script:capturedSQL.Contains('history.recovered')) 'Normal startup must not select or request historical repair.'
  Assert-True ($script:capturedSQL.Contains('BEGIN READ ONLY;') -and $script:capturedSQL.Contains('ROLLBACK;')) 'Lookup must use a read-only transaction.'
  Assert-True ($script:capturedSQL.Contains("WHERE lower(btrim(u.email)) = 'person@example.test'")) 'Selected email must be normalized.'
  Assert-True ($script:capturedSQL.Contains('FROM public.company_memberships')) 'Gateway profiles must use existing membership identities.'
  Assert-True ($script:capturedSQL.Contains("FROM public.ai_runs WHERE status IN ('pending', 'running', 'stopping')")) 'Cutover check must include every nonterminal AI status.'
  $repairLookup = Resolve-LocalHermesScope -Email 'person@example.test' -CompanyID $companyA -RepairHermesHistory
  Assert-True ($repairLookup.HistoryRepairs.Count -eq 1 -and $repairLookup.HistoryRepairs[0].session_id -ceq 'literal-native-session') 'Explicit repair must preserve the exact admitted native tuple.'
  Assert-True ($script:capturedSQL.Contains("run.status IN ('completed', 'failed', 'cancelled', 'interrupted')")) 'Historical repair must select terminal runs only.'
  Assert-True ($script:capturedSQL.Contains("'run_id', run.hermes_run_id, 'session_id', run.chat_id")) 'Historical repair must use native run and stored chat IDs, without creating identities.'
  Assert-True ($script:capturedSQL.Contains("WHERE event->>'event' IN ('run.finished', 'history.recovered')")) 'Historical repair must exclude completed and previously recovered history.'
  Assert-True ($script:capturedSQL.Contains('membership.company_id = run.company_id AND membership.user_id = run.user_id')) 'Historical repair must retain exact current membership scope.'
  $script:fixtureLookup.history_repairs = @([pscustomobject]@{ company_id = $companyA; user_id = $userA; run_id = ('run_' + ('d' * 32)); session_id = ('x' * 262144) })
  Assert-Rejected { Resolve-LocalHermesScope -Email 'person@example.test' -CompanyID $companyA -RepairHermesHistory } 'exceeds 262144 UTF-8 bytes'
  $script:fixtureLookup.accounts += [pscustomobject]@{ user_id = $userB; company_id = $companyA; company_name = 'Fixture'; email = 'person@example.test' }
  Assert-Rejected { Resolve-LocalHermesScope -Email 'person@example.test' -CompanyID $companyA } 'Multiple Mango users'
} finally {
  foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}

$tokens = $null
$parseErrors = $null
[Management.Automation.Language.Parser]::ParseFile(
  (Join-Path $PSScriptRoot 'start_local_cognito_backend.ps1'), [ref]$tokens, [ref]$parseErrors
) | Out-Null
Assert-True ($parseErrors.Count -eq 0) 'Backend launcher must parse without executing credential setup.'

Write-Output 'LOCAL_HERMES_FIXTURES_OK'
