# Used by start_local_cognito_backend.ps1. This file does not start anything when loaded.

function Get-LocalHermesSettings {
  param([string]$CompanyID, [string]$UserID)

  $company = [guid]::Empty
  $user = [guid]::Empty
  if (-not [guid]::TryParse($CompanyID, [ref]$company) -or $company -eq [guid]::Empty -or
      -not [guid]::TryParse($UserID, [ref]$user) -or $user -eq [guid]::Empty) {
    throw "Hermes needs both the Mango company ID and Mango user ID. See docs/setup/hermes-local.md."
  }
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
  return [pscustomobject]@{
    CompanyID = $company.ToString()
    UserID = $user.ToString()
    Docker = $docker.Source
    Image = $image
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
