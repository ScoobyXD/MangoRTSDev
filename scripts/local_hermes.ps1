# Used by start_local_cognito_backend.ps1. This file does not start anything when loaded.

function Resolve-LocalHermesScope {
  param([string]$Email, [string]$CompanyID)

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
  $sql = @"
BEGIN READ ONLY;
SELECT coalesce(json_agg(account ORDER BY account.company_name, account.company_id), '[]'::json)
FROM (
  SELECT u.user_id::text, u.email, c.company_id::text, c.name AS company_name
  FROM public.users u
  LEFT JOIN public.company_memberships membership ON membership.user_id = u.user_id
  LEFT JOIN public.companies c ON c.company_id = membership.company_id
  WHERE lower(btrim(u.email)) = '$emailLiteral'
) account;
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
    $accounts = ConvertFrom-Json -InputObject ($raw -join "`n") -ErrorAction Stop
    $accounts = @($accounts)
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
  return [pscustomobject]@{
    CompanyID = ([guid]$selected.company_id).ToString()
    UserID = ([guid]$selected.user_id).ToString()
    CompanyName = $selected.company_name
    Email = $emailValue
  }
}

function Get-LocalHermesDocker {
  $docker = Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $docker) {
    throw "Hermes needs Docker Desktop running with Linux containers. See docs/setup/hermes-local.md."
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
  $imageExists = & {
    $ErrorActionPreference = 'Continue'
    & $docker.Source image inspect --format '{{.Id}}' $image *> $null
    $LASTEXITCODE -eq 0
  }
  if (-not $imageExists) {
    throw "Build Hermes once from the repo root: docker build -t $image hermes"
  }
  return $docker.Source
}

function Get-LocalHermesSettings {
  param([string]$CompanyID, [string]$UserID, [string]$Docker)

  $company = [guid]::Empty
  $user = [guid]::Empty
  if (-not [guid]::TryParse($CompanyID, [ref]$company) -or $company -eq [guid]::Empty -or
      -not [guid]::TryParse($UserID, [ref]$user) -or $user -eq [guid]::Empty) {
    throw "Hermes needs an existing Mango company ID and Mango user ID."
  }
  if ([string]::IsNullOrWhiteSpace($Docker)) { throw "Check local Docker before configuring Hermes." }
  return [pscustomobject]@{
    CompanyID = $company.ToString()
    UserID = $user.ToString()
    Docker = $Docker
    Image = 'mangorts-hermes:693641aa'
    Name = "mangorts-hermes-$company-$user"
  }
}

function Start-LocalHermes {
  param([object]$Settings, [string]$OpenAIKey, [switch]$StopExisting)

  if ([string]::IsNullOrWhiteSpace($OpenAIKey) -or $OpenAIKey.Trim().StartsWith('{')) {
    throw "The authorized dev OpenAI secret must contain a raw key or a recognized API key property."
  }
  $existingLabels = & {
    $ErrorActionPreference = 'Continue'
    $value = & $Settings.Docker container inspect --format '{{json .Config.Labels}}' $Settings.Name 2>$null
    if ($LASTEXITCODE -eq 0) { $value }
  }
  if ($null -ne $existingLabels) {
    $labels = $existingLabels | ConvertFrom-Json
    if ($labels.'mangorts.local-hermes' -ne 'true' -or
        $labels.'mangorts.company' -ne $Settings.CompanyID -or $labels.'mangorts.user' -ne $Settings.UserID) {
      throw "A container with the Hermes name exists but is not owned by this local launcher."
    }
    if (-not $StopExisting) { throw "Local Hermes already exists. Rerun with -StopExisting to restart it." }
    & $Settings.Docker container stop --time 10 $Settings.Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to stop the existing local Hermes container." }
    # A previous interrupted Docker client may leave a stopped --rm container.
    $containerRemains = & {
      $ErrorActionPreference = 'Continue'
      & $Settings.Docker container inspect --format '{{.Id}}' $Settings.Name *> $null
      $LASTEXITCODE -eq 0
    }
    if ($containerRemains) {
      & $Settings.Docker container rm $Settings.Name | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Unable to remove the stopped Hermes container; its data volume was retained." }
    }
  }

  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $apiKey = [Convert]::ToBase64String($bytes)
    $rng.GetBytes($bytes)
    $callbackKey = [Convert]::ToBase64String($bytes)
  } finally { $rng.Dispose() }

  # Arguments contain only fixed settings and validated UUIDs, never credentials.
  $dockerArgs = @(
    'run', '--rm', '--interactive', '--name', $Settings.Name,
    '--label', 'mangorts.local-hermes=true',
    '--label', "mangorts.company=$($Settings.CompanyID)", '--label', "mangorts.user=$($Settings.UserID)",
    '--publish', '127.0.0.1:8642:8642', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true', '--tmpfs', '/tmp:rw,nosuid,size=256m',
    '--mount', "type=volume,source=$($Settings.Name),target=/data",
    '--env', "MANGO_COMPANY_ID=$($Settings.CompanyID)", '--env', "MANGO_USER_ID=$($Settings.UserID)",
    '--env', 'MANGO_CALLBACK_URL=http://host.docker.internal:8080/internal/hermes/actions',
    $Settings.Image, '--runtime-stdin'
  )
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Settings.Docker
  $start.Arguments = $dockerArgs -join ' '
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  $runtime = [pscustomobject]@{ Settings = $Settings; Process = $process }
  try {
    if (-not $process.Start()) { throw "Unable to start Docker for Hermes." }
    # Private stdin avoids env files, CLI secret values, and Docker Config.Env secrets.
    $credentialJSON = @{
      OPENAI_API_KEY = $OpenAIKey.Trim(); API_SERVER_KEY = $apiKey; MANGO_CALLBACK_KEY = $callbackKey
    } | ConvertTo-Json -Compress
    # Send UTF-8 independently of the PowerShell console's text encoding.
    $credentialBytes = [Text.Encoding]::UTF8.GetBytes($credentialJSON + "`n")
    $process.StandardInput.BaseStream.Write($credentialBytes, 0, $credentialBytes.Length)
    $process.StandardInput.BaseStream.Close()

    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $apiKey)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $ready = $false
    try {
      # One bounded startup wait; the app does not poll running AI jobs.
      do {
        if ($process.HasExited) { throw "Hermes exited during startup. Check its startup output above." }
        try {
          $response = $client.GetAsync('http://127.0.0.1:8642/v1/capabilities').GetAwaiter().GetResult()
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

    $env:MANGORTS_LOCAL_HERMES_API_KEY = $apiKey
    $env:MANGORTS_LOCAL_HERMES_CALLBACK_KEY = $callbackKey
    $env:MANGORTS_HERMES_ROUTES = ConvertTo-Json -Compress -InputObject @(@{
      company_id = $Settings.CompanyID; user_id = $Settings.UserID; url = 'http://127.0.0.1:8642'
      api_key_env = 'MANGORTS_LOCAL_HERMES_API_KEY'; callback_key_env = 'MANGORTS_LOCAL_HERMES_CALLBACK_KEY'
    })
    Write-Host "Hermes is ready for company $($Settings.CompanyID), user $($Settings.UserID)."
    return $runtime
  } catch {
    Stop-LocalHermes -Runtime $runtime
    throw
  }
}

function Stop-LocalHermes {
  param([object]$Runtime)
  if ($null -eq $Runtime) { return }
  try {
    $stopped = & {
      $ErrorActionPreference = 'Continue'
      & $Runtime.Settings.Docker container stop --time 10 $Runtime.Settings.Name *> $null
      $LASTEXITCODE -eq 0
    }
    if (-not $stopped -and -not $Runtime.Process.HasExited) {
      Write-Warning "Docker could not stop local Hermes. Stop container $($Runtime.Settings.Name) in Docker Desktop."
    }
  } finally { $Runtime.Process.Dispose() }
  # The named /data volume is deliberately retained across backend restarts.
}
