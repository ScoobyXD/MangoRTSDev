# Used by start_local_cognito_backend.ps1. This file does not start anything when loaded.

function Resolve-LocalHermesScope {
  param([string]$Email, [string]$CompanyID, [switch]$RepairHermesHistory)

  if ([string]::IsNullOrWhiteSpace($Email) -or $Email -match '[\x00\r\n]') {
    throw "Enter the email address you use to sign into Mango."
  }
  $emailValue = $Email.Trim().ToLowerInvariant()
  $company = [guid]::Empty
  if (-not [string]::IsNullOrWhiteSpace($CompanyID) -and
      (-not [guid]::TryParse($CompanyID, [ref]$company) -or $company -eq [guid]::Empty)) {
    throw "HermesCompanyID must be an existing Mango company UUID."
  }
  $psql = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $psql) { throw "Mango account lookup needs PostgreSQL's psql on PATH." }
  if ([string]::IsNullOrWhiteSpace($env:DB_HOST) -or [string]::IsNullOrWhiteSpace($env:DB_PORT) -or
      [string]::IsNullOrWhiteSpace($env:DB_NAME) -or [string]::IsNullOrWhiteSpace($env:DB_USER)) {
    throw "Set the local backend database environment before looking up the Mango account."
  }

  # Keep all matching users until ambiguity is checked, including users with no membership.
  $emailLiteral = $emailValue.Replace("'", "''")
  $repairQuery = 'NULL::json'
  if ($RepairHermesHistory) {
    # Exact admitted terminal executions only; never recover by chat alone.
    $repairQuery = @"
(SELECT coalesce(json_agg(json_build_object(
    'company_id', run.company_id::text, 'user_id', run.user_id::text,
    'run_id', run.hermes_run_id, 'session_id', run.chat_id)
    ORDER BY run.created_timestamp, run.run_id), '[]'::json)
 FROM public.ai_runs run
 JOIN public.company_memberships membership ON membership.company_id = run.company_id AND membership.user_id = run.user_id
 WHERE run.status IN ('completed', 'failed', 'cancelled', 'interrupted')
   AND run.hermes_run_id IS NOT NULL AND btrim(run.hermes_run_id) <> ''
   AND run.chat_id IS NOT NULL AND btrim(run.chat_id) <> ''
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(run.history) event
                   WHERE event->>'event' IN ('run.finished', 'history.recovered')))
"@
  }
  $sql = @"
BEGIN READ ONLY;
WITH accounts AS (
  SELECT u.user_id::text, u.email, c.company_id::text, c.name AS company_name
  FROM public.users u
  LEFT JOIN public.company_memberships membership ON membership.user_id = u.user_id
  LEFT JOIN public.companies c ON c.company_id = membership.company_id
  WHERE lower(btrim(u.email)) = '$emailLiteral'
)
SELECT json_build_object(
  'accounts', (SELECT coalesce(json_agg(accounts ORDER BY company_name, company_id), '[]'::json) FROM accounts),
  'profiles', (SELECT coalesce(json_agg(json_build_object('company_id', company_id::text, 'user_id', user_id::text)
                  ORDER BY company_id, user_id), '[]'::json) FROM public.company_memberships),
  'active_runs', (SELECT count(*) FROM public.ai_runs WHERE status IN ('pending', 'running', 'stopping')),
  'history_repairs', $repairQuery
);
ROLLBACK;
"@
  $previousConnectTimeout = $env:PGCONNECT_TIMEOUT
  $previousOptions = $env:PGOPTIONS
  $previousClientEncoding = $env:PGCLIENTENCODING
  $previousOutputEncoding = $OutputEncoding
  $previousConsoleEncoding = [Console]::OutputEncoding
  try {
    $env:PGCONNECT_TIMEOUT = '5'
    $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=10000 -c standard_conforming_strings=on'
    $env:PGCLIENTENCODING = 'UTF8'
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $OutputEncoding
    $raw = & {
      $ErrorActionPreference = 'Continue'
      $value = $sql | & $psql.Source -X -A -t -q -w -v ON_ERROR_STOP=1 `
        -h $env:DB_HOST -p $env:DB_PORT -d $env:DB_NAME -U $env:DB_USER -f - 2>$null
      if ($LASTEXITCODE -eq 0) { $value }
    }
    if ([string]::IsNullOrWhiteSpace(($raw -join "`n"))) { throw "lookup failed" }
    $lookup = ConvertFrom-Json -InputObject ($raw -join "`n") -ErrorAction Stop
    $accounts = @($lookup.accounts)
  } catch {
    throw "Unable to look up the Mango account. Check the local backend database connection and psql access."
  } finally {
    $env:PGCONNECT_TIMEOUT = $previousConnectTimeout
    $env:PGOPTIONS = $previousOptions
    $env:PGCLIENTENCODING = $previousClientEncoding
    $OutputEncoding = $previousOutputEncoding
    [Console]::OutputEncoding = $previousConsoleEncoding
  }
  if ($accounts.Count -eq 0) { throw "No Mango account matches that email. Sign into Mango once or check the email." }
  foreach ($account in $accounts) {
    $accountUser = [guid]::Empty
    $accountCompany = [guid]::Empty
    if (-not [guid]::TryParse($account.user_id, [ref]$accountUser) -or $accountUser -eq [guid]::Empty -or
        ($account.company_id -and (-not [guid]::TryParse($account.company_id, [ref]$accountCompany) -or $accountCompany -eq [guid]::Empty))) {
      throw "The Mango account lookup returned an invalid identity; no account was selected."
    }
  }
  if (@($accounts.user_id | Select-Object -Unique).Count -ne 1) {
    throw "Multiple Mango users have that email; no account was selected. Resolve the duplicate accounts first."
  }
  $memberships = @($accounts | Where-Object { $_.company_id -and ($company -eq [guid]::Empty -or [guid]$_.company_id -eq $company) })
  if ($memberships.Count -eq 0) { throw "That Mango account has no membership in the requested company. Sign into Mango and select an existing company first." }
  $selected = $memberships[0]
  if ($memberships.Count -gt 1) {
    Write-Host 'Choose the company you will use in Mango:'
    for ($index = 0; $index -lt $memberships.Count; $index++) {
      Write-Host ("{0}. {1} ({2})" -f ($index + 1), $memberships[$index].company_name, $memberships[$index].company_id)
    }
    $choice = 0
    if (-not [int]::TryParse((Read-Host 'Company number'), [ref]$choice) -or $choice -lt 1 -or $choice -gt $memberships.Count) {
      throw "Invalid company number. Run the launcher again and choose one of the listed companies."
    }
    $selected = $memberships[$choice - 1]
  }
  $historyRepairs = @(if ($RepairHermesHistory) { $lookup.history_repairs })
  if ($historyRepairs.Count -gt 0) {
    $repairJSON = ConvertTo-Json -Compress -Depth 4 -InputObject $historyRepairs
    if ([Text.Encoding]::UTF8.GetByteCount($repairJSON) -gt 262144) {
      throw "The requested Hermes history-repair set exceeds 262144 UTF-8 bytes. Nothing was truncated or repaired."
    }
  }
  return [pscustomobject]@{
    CompanyID = ([guid]$selected.company_id).ToString()
    UserID = ([guid]$selected.user_id).ToString()
    CompanyName = $selected.company_name
    Email = $emailValue
    Profiles = @($lookup.profiles)
    ActiveRunCount = [long]$lookup.active_runs
    HistoryRepairs = $historyRepairs
  }
}

function Get-LocalHermesDocker {
  $candidates = @('docker.exe')
  if ($env:LOCALAPPDATA) {
    $candidates += Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
  }
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
  }
  $docker = Get-Command -Name $candidates -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $docker) {
    throw "Docker Desktop's docker.exe was not found on PATH or in its standard install folders. See docs/setup/hermes-local.md."
  }
  $dockerBin = Split-Path -Parent $docker.Source
  if (($env:Path -split [IO.Path]::PathSeparator) -notcontains $dockerBin) {
    $env:Path = $dockerBin + [IO.Path]::PathSeparator + $env:Path
  }
  $endpoint = $env:DOCKER_HOST
  if ([string]::IsNullOrWhiteSpace($endpoint)) {
    $endpoint = & {
      $ErrorActionPreference = 'Continue'
      $value = & $docker.Source context inspect --format '{{.Endpoints.docker.Host}}' 2>$null
      if ($LASTEXITCODE -eq 0) { $value }
    }
    if (-not $endpoint) { throw "Unable to read the local Docker context. Start Docker Desktop." }
  }
  if ($endpoint -notmatch '^(npipe|unix)://') {
    throw "Local Hermes requires a local Docker socket, not a remote Docker engine."
  }
  $osType = & {
    $ErrorActionPreference = 'Continue'
    $value = & $docker.Source info --format '{{.OSType}}' 2>$null
    if ($LASTEXITCODE -eq 0) { $value }
  }
  if ($osType -ne 'linux') {
    throw "Start Docker Desktop with Linux containers, then run this command again."
  }
  $image = 'mangorts-hermes:693641aa'
  $buildContext = Join-Path (Split-Path -Parent $PSScriptRoot) 'hermes'
  Write-Host 'Preparing the Hermes image from this checkout (using the Docker build cache).'
  $imageBuilt = & {
    $ErrorActionPreference = 'Continue'
    & $docker.Source build --tag $image $buildContext | Out-Host
    $LASTEXITCODE -eq 0
  }
  if (-not $imageBuilt) {
    throw 'The Hermes image build failed. Resolve the Docker build error above and rerun the launcher.'
  }
  return $docker.Source
}

function Get-LocalHermesSettings {
  param([string]$CompanyID, [string]$UserID, [object[]]$Profiles, [long]$ActiveRunCount, [object[]]$HistoryRepairs = @(), [string]$Docker)

  $company = [guid]::Empty
  $user = [guid]::Empty
  if (-not [guid]::TryParse($CompanyID, [ref]$company) -or $company -eq [guid]::Empty -or
      -not [guid]::TryParse($UserID, [ref]$user) -or $user -eq [guid]::Empty) {
    throw "Hermes needs an existing Mango company ID and Mango user ID."
  }
  if ([string]::IsNullOrWhiteSpace($Docker)) { throw "Check local Docker before configuring Hermes." }
  if (-not $Profiles -or $Profiles.Count -eq 0) { throw "The shared Hermes gateway needs existing Mango memberships." }
  $profileNames = @{}
  $scopes = @(foreach ($scope in $Profiles) {
    $scopeCompany = [guid]::Empty
    $scopeUser = [guid]::Empty
    if (-not [guid]::TryParse($scope.company_id, [ref]$scopeCompany) -or $scopeCompany -eq [guid]::Empty -or
        -not [guid]::TryParse($scope.user_id, [ref]$scopeUser) -or $scopeUser -eq [guid]::Empty) {
      throw "The Mango membership lookup returned an invalid Hermes profile identity."
    }
    # Native profile names permit 64 characters: preserve both UUIDs without hashing.
    $profile = $scopeCompany.ToString('N') + $scopeUser.ToString('N')
    if ($profileNames.ContainsKey($profile)) { throw "The Mango membership lookup returned a duplicate Hermes profile." }
    $profileNames[$profile] = $true
    [pscustomobject]@{ company_id = $scopeCompany.ToString(); user_id = $scopeUser.ToString(); Profile = $profile }
  })
  $selectedProfile = $company.ToString('N') + $user.ToString('N')
  if (-not $profileNames.ContainsKey($selectedProfile)) { throw "The selected Mango account is not a member of the shared gateway's profiles." }
  $volumes = @(& $Docker volume ls --format '{{.Name}}')
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect persistent local Hermes volumes." }
  $sharedVolumeExists = $volumes -contains 'mangorts-hermes'
  $sharedContainerExists = & {
    $ErrorActionPreference = 'Continue'
    & $Docker container inspect --format '{{.Id}}' mangorts-hermes *> $null
    $LASTEXITCODE -eq 0
  }
  if (-not $sharedVolumeExists -and $ActiveRunCount -gt 0) {
    throw "Finish or Stop every active Mango AI run in the current app before the first shared-gateway startup. Existing runs cannot transfer native ownership during this one-time cutover."
  }
  $profileVolumes = @{}
  foreach ($scope in $scopes) {
    $oldVolume = "mangorts-hermes-$($scope.company_id)-$($scope.user_id)"
    $profileVolumes[$scope.Profile] = if ($volumes -contains $oldVolume) { $oldVolume } else { $null }
  }
  return [pscustomobject]@{
    CompanyID = $company.ToString()
    UserID = $user.ToString()
    Docker = $Docker
    Image = 'mangorts-hermes:693641aa'
    Name = 'mangorts-hermes'
    PreviousName = "mangorts-hermes-$company-$user"
    Profile = $selectedProfile
    Profiles = $scopes
    ProfileVolumes = $profileVolumes
    SharedVolumeExists = $sharedVolumeExists
    RequireExistingCredentials = $sharedVolumeExists -or $sharedContainerExists
    CredentialsPath = Join-Path $env:LOCALAPPDATA 'MangoRTS\Hermes\service-seeds.dpapi'
    HistoryRepairs = $HistoryRepairs
  }
}

function Get-LocalHermesServiceCredentials {
  param([string]$Path, [switch]$RequireExisting)

  Add-Type -AssemblyName System.Security
  if (-not [IO.File]::Exists($Path)) {
    if ($RequireExisting) {
      throw "The shared Hermes container or volume exists but its encrypted service credentials are missing. Restore the matching service-seeds.dpapi backup for this Windows user; do not generate replacement credentials."
    }
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $bytes = New-Object byte[] 32
      $rng.GetBytes($bytes)
      $apiKey = [Convert]::ToBase64String($bytes)
      $rng.GetBytes($bytes)
      $callbackKey = [Convert]::ToBase64String($bytes)
    } finally { $rng.Dispose() }
    $json = @{ API_SERVER_KEY = $apiKey; MANGO_CALLBACK_KEY = $callbackKey } | ConvertTo-Json -Compress
    $encrypted = [Security.Cryptography.ProtectedData]::Protect(
      [Text.Encoding]::UTF8.GetBytes($json), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
      [IO.File]::WriteAllBytes($temporary, $encrypted)
      try { [IO.File]::Move($temporary, $Path) }
      catch [IO.IOException] {
        # Another launcher may have created the shared credentials first.
        if (-not [IO.File]::Exists($Path)) { throw }
      }
    } finally {
      if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
  }
  try {
    $cleartext = [Security.Cryptography.ProtectedData]::Unprotect(
      [IO.File]::ReadAllBytes($Path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $credentials = [Text.Encoding]::UTF8.GetString($cleartext) | ConvertFrom-Json -ErrorAction Stop
    $names = @($credentials.PSObject.Properties.Name)
    if ($names.Count -ne 2 -or $names -notcontains 'API_SERVER_KEY' -or $names -notcontains 'MANGO_CALLBACK_KEY') {
      throw "Invalid saved credential fields."
    }
    foreach ($name in $names) {
      $value = $credentials.$name
      if ($value -isnot [string] -or $value.Length -lt 32 -or $value -match '[^\x21-\x7e]') {
        throw "Invalid saved credential value."
      }
    }
    if ($credentials.API_SERVER_KEY -eq $credentials.MANGO_CALLBACK_KEY) { throw "Service credentials must differ." }
    return $credentials
  } catch {
    throw "Unable to read the encrypted local Hermes service credentials. Restore the matching service-seeds.dpapi backup for this Windows user; existing credentials must not be replaced."
  }
}

function Remove-StoppedLocalHermesContainer {
  param([string]$Docker, [string]$ContainerID)

  if ($ContainerID -notmatch '^[0-9a-f]{64}$') { throw "Invalid inspected Hermes container identity." }
  & $Docker container stop --time 10 $ContainerID | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to stop the existing local Hermes container." }
  # Remove only the stopped container; its named data volumes remain intact.
  $containerRemains = & {
    $ErrorActionPreference = 'Continue'
    & $Docker container inspect --format '{{.Id}}' $ContainerID *> $null
    $LASTEXITCODE -eq 0
  }
  if ($containerRemains) {
    & $Docker container rm $ContainerID | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to remove the stopped Hermes container; its data volume was retained." }
  }
}

function Start-LocalHermes {
  param([object]$Settings, [object]$ServiceCredentials, [string]$OpenAIKey, [switch]$StopExisting)

  if ([string]::IsNullOrWhiteSpace($OpenAIKey) -or $OpenAIKey.Trim().StartsWith('{')) {
    throw "The authorized dev OpenAI secret must contain a raw key or a recognized API key property."
  }
  $running = @(& $Settings.Docker container ls --filter 'label=mangorts.local-hermes=true' --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect running local Hermes containers." }
  $otherContainers = @($running | Where-Object { $_ -ne $Settings.Name -and $_ -ne $Settings.PreviousName })
  if ($otherContainers.Count -gt 0) {
    throw "Stop the other local Hermes containers before starting the shared gateway: $($otherContainers -join ', '). Their volumes must be retained."
  }
  # The launcher decrypted these before stopping the API. Native run ownership
  # includes the API key, so these values must stay stable across restarts.
  $apiKey = $ServiceCredentials.API_SERVER_KEY
  $callbackKey = $ServiceCredentials.MANGO_CALLBACK_KEY
  if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($callbackKey)) {
    throw "Load the saved encrypted Hermes service credentials before startup."
  }
  # Validate the complete private payload before stopping a working container.
  $credentialPayload = @{
    OPENAI_API_KEY = $OpenAIKey.Trim(); API_SERVER_KEY = $apiKey; MANGO_CALLBACK_KEY = $callbackKey
  }
  if (-not [string]::IsNullOrWhiteSpace($env:MANGO_INTEGRATION_SECRETS)) {
    $credentialPayload.MANGO_INTEGRATION_SECRETS = $env:MANGO_INTEGRATION_SECRETS
  }
  if ($Settings.HistoryRepairs.Count -gt 0) {
    $credentialPayload.MANGO_HERMES_HISTORY_REPAIRS = ConvertTo-Json -Compress -Depth 4 -InputObject @($Settings.HistoryRepairs)
  }
  $credentialJSON = $credentialPayload | ConvertTo-Json -Compress
  if ([Text.Encoding]::UTF8.GetByteCount($credentialJSON + "`n") -gt 262144) {
    $credentialJSON = $null
    $credentialPayload = $null
    throw "The Hermes runtime payload exceeds 262144 UTF-8 bytes. Reduce the requested history-repair or integration set; nothing was truncated."
  }
  $previousInspection = & {
    $ErrorActionPreference = 'Continue'
    $value = & $Settings.Docker container inspect --format '{{.Id}} {{json .Config.Labels}}' $Settings.PreviousName 2>$null
    if ($LASTEXITCODE -eq 0) { $value }
  }
  if ($null -ne $previousInspection) {
    $identity = $previousInspection -split ' ', 2
    if ($identity.Count -ne 2 -or $identity[0] -notmatch '^[0-9a-f]{64}$') { throw "Invalid inspected Hermes container identity." }
    $labels = $identity[1] | ConvertFrom-Json
    if ($labels.'mangorts.local-hermes' -ne 'true' -or
        $labels.'mangorts.company' -ne $Settings.CompanyID -or $labels.'mangorts.user' -ne $Settings.UserID) {
      throw "The selected account's previous Hermes container has an unexpected owner."
    }
    if (-not $StopExisting) { throw "Local Hermes already exists. Rerun with -StopExisting to start the shared gateway." }
    Remove-StoppedLocalHermesContainer -Docker $Settings.Docker -ContainerID $identity[0]
  }
  $existingInspection = & {
    $ErrorActionPreference = 'Continue'
    $value = & $Settings.Docker container inspect --format '{{.Id}} {{json .Config.Labels}}' $Settings.Name 2>$null
    if ($LASTEXITCODE -eq 0) { $value }
  }
  if ($null -ne $existingInspection) {
    $identity = $existingInspection -split ' ', 2
    if ($identity.Count -ne 2 -or $identity[0] -notmatch '^[0-9a-f]{64}$') { throw "Invalid inspected Hermes container identity." }
    $labels = $identity[1] | ConvertFrom-Json
    if ($labels.'mangorts.local-hermes' -ne 'true' -or $labels.'mangorts.hermes-gateway' -ne 'shared') {
      throw "A container with the Hermes name exists but is not owned by this local launcher."
    }
    if (-not $StopExisting) { throw "Local Hermes already exists. Rerun with -StopExisting to restart it." }
    Remove-StoppedLocalHermesContainer -Docker $Settings.Docker -ContainerID $identity[0]
  }

  # Arguments contain only fixed settings and validated UUIDs, never credentials.
  $launchID = [guid]::NewGuid().ToString('N')
  $dockerArgs = @(
    'run', '--interactive', '--sig-proxy=false', '--name', $Settings.Name,
    '--label', 'mangorts.local-hermes=true', '--label', 'mangorts.hermes-gateway=shared',
    '--label', "mangorts.hermes-launch=$launchID",
    '--publish', '127.0.0.1:8642:8642', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true', '--tmpfs', '/tmp:rw,nosuid,size=256m',
    '--mount', "type=volume,source=$($Settings.Name),target=/data",
    '--env', 'MANGO_HERMES_PROFILES', '--env', 'MANGO_HERMES_PROFILE_VOLUMES',
    '--env', 'MANGO_CALLBACK_URL=http://host.docker.internal:8080/internal/hermes/actions'
  )
  foreach ($profile in $Settings.ProfileVolumes.Keys) {
    $volume = $Settings.ProfileVolumes[$profile]
    if ($volume) { $dockerArgs += @('--mount', "type=volume,source=$volume,target=/data/profiles/$profile") }
  }
  $dockerArgs += @($Settings.Image, '--runtime-stdin')
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Settings.Docker
  $start.Arguments = $dockerArgs -join ' '
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  # Docker reads these nonsecret JSON values from its environment without shell quoting.
  $start.EnvironmentVariables['MANGO_HERMES_PROFILES'] = ConvertTo-Json -Compress -InputObject @(
    $Settings.Profiles | Select-Object company_id, user_id
  )
  $start.EnvironmentVariables['MANGO_HERMES_PROFILE_VOLUMES'] = ConvertTo-Json -Compress -InputObject $Settings.ProfileVolumes
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  $runtime = [pscustomobject]@{ Settings = $Settings; LaunchID = $launchID }
  try {
    # Private stdin avoids env files, CLI secret values, and Docker Config.Env secrets.
    # Send UTF-8 independently of the PowerShell console's text encoding.
    $credentialBytes = [Text.Encoding]::UTF8.GetBytes($credentialJSON + "`n")
    try {
      if (-not $process.Start()) { throw "Unable to start Docker for Hermes." }
      $process.StandardInput.BaseStream.Write($credentialBytes, 0, $credentialBytes.Length)
      $process.StandardInput.BaseStream.Close()
    } finally {
      [Array]::Clear($credentialBytes, 0, $credentialBytes.Length)
      $credentialBytes = $null
      $credentialJSON = $null
      $credentialPayload = $null
    }

    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    $hmac = New-Object Security.Cryptography.HMACSHA256
    try {
      $hmac.Key = [Text.Encoding]::UTF8.GetBytes($apiKey)
      $profileAPIKey = [BitConverter]::ToString($hmac.ComputeHash(
        [Text.Encoding]::UTF8.GetBytes('mango-hermes-api:' + $Settings.Profile)
      )).Replace('-', '').ToLowerInvariant()
    } finally { $hmac.Dispose() }
    $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $profileAPIKey)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $ready = $false
    try {
      # One bounded startup wait; the app does not poll running AI jobs.
      do {
        if ($process.HasExited) { throw "Hermes exited during startup (Docker exit code $($process.ExitCode))." }
        try {
          $response = $client.GetAsync("http://127.0.0.1:8642/p/$($Settings.Profile)/v1/capabilities").GetAwaiter().GetResult()
          try {
            if ($response.IsSuccessStatusCode) {
              $capabilities = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
              $ready = $capabilities.features.runs_idempotency.durable -eq $true
            }
          } finally { $response.Dispose() }
        } catch [Net.Http.HttpRequestException] { } catch [System.Threading.Tasks.TaskCanceledException] { }
        if (-not $ready) { Start-Sleep -Milliseconds 500 }
      } until ($ready -or [DateTime]::UtcNow -ge $deadline)
    } finally { $client.Dispose(); $handler.Dispose() }
    if (-not $ready) { throw "Hermes did not report durable run storage within 60 seconds. Check its startup output." }

    # Private stdin was only the bootstrap transport. Detach that Docker client,
    # not the healthy container, so a later Ctrl+C reaches Go alone.
    if ($process.HasExited) { throw "Hermes exited before startup detached (Docker exit code $($process.ExitCode))." }
    $process.Kill()
    if (-not $process.WaitForExit(5000)) { throw 'Unable to detach the Docker startup client within 5 seconds.' }

    $env:MANGORTS_LOCAL_HERMES_API_KEY = $apiKey
    $env:MANGORTS_LOCAL_HERMES_CALLBACK_KEY = $callbackKey
    $env:MANGORTS_HERMES_ROUTES = ConvertTo-Json -Compress -InputObject @(
      foreach ($scope in $Settings.Profiles) {
        @{
          company_id = $scope.company_id; user_id = $scope.user_id; url = 'http://127.0.0.1:8642'
          api_key_env = 'MANGORTS_LOCAL_HERMES_API_KEY'; callback_key_env = 'MANGORTS_LOCAL_HERMES_CALLBACK_KEY'
        }
      }
    )
    Write-Host "Shared Hermes gateway is ready for $($Settings.Profiles.Count) Mango membership profiles."
    return $runtime
  } catch {
    Stop-LocalHermes -Runtime $runtime -ShowStartupOutput
    throw
  } finally { $process.Dispose() }
}

function Stop-LocalHermes {
  param([object]$Runtime, [switch]$ShowStartupOutput)
  if ($null -eq $Runtime) { return }
  # A failed concurrent launch or an older launcher must not stop a replacement
  # container that happens to have the same shared name.
  if ([string]::IsNullOrWhiteSpace($Runtime.LaunchID)) { return }
  $inspection = & {
    $ErrorActionPreference = 'Continue'
    $value = & $Runtime.Settings.Docker container inspect --format '{{.Id}} {{json .Config.Labels}}' $Runtime.Settings.Name 2>$null
    if ($LASTEXITCODE -eq 0) { $value }
  }
  if ($null -eq $inspection) { return }
  $identity = $inspection -split ' ', 2
  if ($identity.Count -ne 2 -or $identity[0] -notmatch '^[0-9a-f]{64}$') { return }
  $labels = $identity[1] | ConvertFrom-Json
  if ($labels.'mangorts.hermes-launch' -cne $Runtime.LaunchID) { return }
  if ($ShowStartupOutput) {
    Write-Host 'Hermes startup output (last 30 lines):'
    & {
      $ErrorActionPreference = 'Continue'
      & $Runtime.Settings.Docker logs --tail 30 $identity[0] 2>&1 | ForEach-Object { Write-Host $_ }
    }
  }
  try {
    Remove-StoppedLocalHermesContainer -Docker $Runtime.Settings.Docker -ContainerID $identity[0]
  } catch {
    Write-Warning "Docker could not clean up local Hermes. Stop and remove container $($Runtime.Settings.Name) in Docker Desktop while retaining its volumes."
  }
  # The named /data volume is deliberately retained across backend restarts.
}
