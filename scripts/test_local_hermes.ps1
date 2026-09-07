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

# An existing image tag may contain older Mango code. Always build this checkout
# before returning Docker to the launcher, and keep build output off its pipeline.
$script:fixtureImageBuildExit = 0
$script:fixtureImageBuildCalls = 0
function Get-Command {
  param([string[]]$Name, [string]$CommandType, [string]$ErrorAction)
  Assert-True ($Name[0] -eq 'docker.exe' -and $CommandType -eq 'Application') 'Unexpected Docker lookup executable.'
  [pscustomobject]@{ Source = 'Invoke-FixtureBuildDocker' }
}
function Invoke-FixtureBuildDocker {
  if (($args -join ' ') -eq 'info --format {{.OSType}}') {
    $global:LASTEXITCODE = 0
    return 'linux'
  }
  if (($args -join ' ') -eq 'image inspect --format {{.Id}} mangorts-hermes:693641aa') {
    $global:LASTEXITCODE = 0
    return 'sha256:existing-stale-image'
  }
  Assert-True ($args.Count -eq 4 -and ($args[0..2] -join ' ') -eq 'build --tag mangorts-hermes:693641aa') 'Unexpected image build operation.'
  Assert-True ($args[3] -eq (Join-Path (Split-Path -Parent $PSScriptRoot) 'hermes')) 'Build must use the launcher checkout, independent of the working directory.'
  $script:fixtureImageBuildCalls++
  'Fixture Docker build output'
  $global:LASTEXITCODE = $script:fixtureImageBuildExit
}
$savedDockerHost = $env:DOCKER_HOST
$savedDockerPath = $env:Path
try {
  $env:DOCKER_HOST = 'npipe://fixture'
  $resolvedDocker = @(Get-LocalHermesDocker)
  Assert-True ($script:fixtureImageBuildCalls -eq 1) 'An existing stale image must be rebuilt from current source.'
  Assert-True ($resolvedDocker.Count -eq 1 -and $resolvedDocker[0] -eq 'Invoke-FixtureBuildDocker') 'Build output must not replace the returned Docker executable.'
  $script:fixtureImageBuildExit = 1
  Assert-Rejected { Get-LocalHermesDocker } 'Hermes image build failed'
  Assert-True ($script:fixtureImageBuildCalls -eq 2) 'A failed build must abort prerequisite checks.'
} finally {
  $env:DOCKER_HOST = $savedDockerHost
  $env:Path = $savedDockerPath
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
$script:fixtureRemovedIDs = @()
$script:fixtureCleanupCommands = @()
$script:fixtureStartupLogRequests = 0
function Invoke-FixtureCleanupDocker {
  if (($args -join ' ') -eq 'container inspect --format {{.Id}} {{json .Config.Labels}} mangorts-hermes') {
    $global:LASTEXITCODE = if ($script:fixtureContainerFound) { 0 } else { 1 }
    if ($script:fixtureContainerFound) {
      $script:fixtureContainerID + ' ' + (@{ 'mangorts.hermes-launch' = $script:fixtureLaunchID } | ConvertTo-Json -Compress)
    }
    return
  }
  Assert-True ($args[-1] -eq $script:fixtureContainerID) 'Cleanup must use the inspected immutable container ID.'
  $script:fixtureCleanupCommands += $args -join ' '
  $global:LASTEXITCODE = 0
  if (($args[0..2] -join ' ') -eq 'logs --tail 30') {
    $script:fixtureStartupLogRequests++
    return 'Fixture Hermes startup failure'
  }
  if (($args[0..3] -join ' ') -eq 'container stop --time 10') {
    $script:fixtureStoppedIDs += $args[4]
    return
  }
  if (($args[0..3] -join ' ') -eq 'container inspect --format {{.Id}}') { return $script:fixtureContainerID }
  Assert-True (($args[0..1] -join ' ') -eq 'container rm') 'Unexpected cleanup Docker operation.'
  $script:fixtureRemovedIDs += $args[2]
}
$fixtureRuntime = [pscustomobject]@{
  Settings = [pscustomobject]@{ Docker = 'Invoke-FixtureCleanupDocker'; Name = 'mangorts-hermes' }
  LaunchID = 'a' * 32
}
Stop-LocalHermes -Runtime $fixtureRuntime
Assert-True ($script:fixtureStoppedIDs.Count -eq 1 -and $script:fixtureStoppedIDs[0] -eq $script:fixtureContainerID) 'Cleanup must stop the verified immutable container ID, never the shared name.'
Assert-True ($script:fixtureRemovedIDs.Count -eq 1 -and $script:fixtureRemovedIDs[0] -eq $script:fixtureContainerID -and $script:fixtureStartupLogRequests -eq 0) 'Normal cleanup must quietly remove only its container and retain every volume.'
$script:fixtureCleanupCommands = @()
$failureOutput = Stop-LocalHermes -Runtime $fixtureRuntime -ShowStartupOutput 6>&1 | Out-String
Assert-True ($failureOutput.Contains('Fixture Hermes startup failure')) 'Early container errors must reach the caller through the PowerShell host.'
Assert-True ($script:fixtureCleanupCommands.Count -eq 4 -and $script:fixtureCleanupCommands[0] -eq ('logs --tail 30 ' + $script:fixtureContainerID) -and $script:fixtureCleanupCommands[3] -eq ('container rm ' + $script:fixtureContainerID)) 'Failure cleanup must fetch bounded logs before stopping and removing the same owned container.'
$script:fixtureStoppedIDs = @()
$script:fixtureRemovedIDs = @()
$script:fixtureLaunchID = 'c' * 32
Stop-LocalHermes -Runtime $fixtureRuntime -ShowStartupOutput
Assert-True ($script:fixtureStoppedIDs.Count -eq 0 -and $script:fixtureRemovedIDs.Count -eq 0 -and $script:fixtureStartupLogRequests -eq 1) 'A failed or older launcher must not read logs, stop or remove the replacement container.'
$script:fixtureContainerFound = $false
Stop-LocalHermes -Runtime $fixtureRuntime -ShowStartupOutput
Assert-True ($script:fixtureStoppedIDs.Count -eq 0 -and $script:fixtureStartupLogRequests -eq 1) 'Absent containers must be ignored without reading logs or stopping a replacement.'
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

# Run the actual launcher tail with synthetic startup and Go functions. No cloud
# setup executes, and inherited service credentials are replaced before any read.
$launcherSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'start_local_cognito_backend.ps1'))
$tailMarker = '$hermesRuntime = $null'
$tailIndex = $launcherSource.IndexOf($tailMarker, [StringComparison]::Ordinal)
Assert-True ($tailIndex -ge 0 -and $tailIndex -eq $launcherSource.LastIndexOf($tailMarker, [StringComparison]::Ordinal)) 'Launcher lifecycle marker must be unique.'
$launcherTail = [scriptblock]::Create($launcherSource.Substring($tailIndex))
$fixtureEnvironmentNames = @('MANGORTS_HERMES_ROUTES', 'MANGORTS_LOCAL_HERMES_API_KEY', 'MANGORTS_LOCAL_HERMES_CALLBACK_KEY')
foreach ($name in $fixtureEnvironmentNames) { [Environment]::SetEnvironmentVariable($name, 'fixture-previous', 'Process') }
$repoRoot = Split-Path -Parent $PSScriptRoot
$hermesSettings = [pscustomobject]@{ Name = 'fixture-hermes' }
$hermesServiceCredentials = $syntheticCredentials
$StopExisting = $true
$script:fixtureStartFails = $false
$script:fixtureGoFails = $false
$script:fixtureGoCalls = 0
function Get-SecretStringValue { 'fixture-provider' }
function Start-LocalHermes {
  param([object]$Settings, [object]$ServiceCredentials, [string]$OpenAIKey, [switch]$StopExisting)
  Assert-True ($Settings.Name -eq 'fixture-hermes' -and $OpenAIKey -eq 'fixture-provider' -and $StopExisting) 'Launcher must pass its existing startup settings.'
  foreach ($name in $fixtureEnvironmentNames) { [Environment]::SetEnvironmentVariable($name, 'fixture-running', 'Process') }
  if ($script:fixtureStartFails) { throw 'Fixture startup failed' }
  [pscustomobject]@{ Settings = $Settings; LaunchID = 'a' * 32 }
}
function Stop-LocalHermes { throw 'Successful launcher must not stop Hermes when Go exits.' }
function go {
  Assert-True (($args -join ' ') -eq 'run ./cmd/miraeopus-api') 'Launcher must retain the normal Go command.'
  foreach ($name in $fixtureEnvironmentNames) {
    Assert-True ([Environment]::GetEnvironmentVariable($name, 'Process') -eq 'fixture-running') 'Go must receive the running Hermes environment.'
  }
  $script:fixtureGoCalls++
  if ($script:fixtureGoFails) { throw 'Fixture Go interrupted' }
}
& $launcherTail
Assert-True ($script:fixtureGoCalls -eq 1) 'Successful startup must run Go once.'
foreach ($name in $fixtureEnvironmentNames) {
  Assert-True ([Environment]::GetEnvironmentVariable($name, 'Process') -eq 'fixture-running') 'Normal Go exit must retain Hermes settings in this PowerShell.'
}
$script:fixtureGoFails = $true
Assert-Rejected { & $launcherTail } 'Fixture Go interrupted'
foreach ($name in $fixtureEnvironmentNames) {
  Assert-True ([Environment]::GetEnvironmentVariable($name, 'Process') -eq 'fixture-running') 'Unwinding Go must retain Hermes settings in this PowerShell.'
  [Environment]::SetEnvironmentVariable($name, 'fixture-previous', 'Process')
}
$script:fixtureStartFails = $true
Assert-Rejected { & $launcherTail } 'Fixture startup failed'
Assert-True ($script:fixtureGoCalls -eq 2) 'Failed Hermes startup must not run Go.'
foreach ($name in $fixtureEnvironmentNames) {
  Assert-True ([Environment]::GetEnvironmentVariable($name, 'Process') -eq 'fixture-previous') 'Failed Hermes startup must restore the previous environment.'
  [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}

Write-Output 'LOCAL_HERMES_FIXTURES_OK'
