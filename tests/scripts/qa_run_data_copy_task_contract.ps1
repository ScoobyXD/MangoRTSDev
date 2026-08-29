[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LauncherPath,
  [Parameter(Mandatory = $true)][string]$PythonExecutable,
  [Parameter(Mandatory = $true)][string]$AwsProbePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Assert-True {
  param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)

  if (-not $Condition) {
    throw $Message
  }
}

function Assert-ThrowsLike {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$Pattern
  )

  try {
    & $Action
  }
  catch {
    if ([string]$_.Exception.Message -notlike $Pattern) {
      throw "Expected error like '$Pattern' but received: $($_.Exception.Message)"
    }
    return
  }
  throw "Expected error like '$Pattern' but no error was thrown."
}

$tokens = $null
$parseErrors = $null
$launcherAst = [System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path -LiteralPath $LauncherPath).Path,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -ne 0) {
  throw "Launcher parse failed: $(@($parseErrors | ForEach-Object Message) -join '; ')"
}

$functionDefinitions = @($launcherAst.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true))
foreach ($functionName in @(
  "Get-AwsResponseList",
  "Get-OrCreateJonatQaCognitoSubject",
  "Get-RegisteredQaCopyTaskDefinitionArn",
  "Get-QaCopyContainerExitCode",
  "Get-SoleEcsTask",
  "Assert-QaCopyTaskSucceeded"
)) {
  $matches = @($functionDefinitions | Where-Object { $_.Name -ceq $functionName })
  if ($matches.Count -ne 1) {
    throw "Expected exactly one $functionName definition in the launcher."
  }
  Invoke-Expression $matches[0].Extent.Text
}

$missingList = '{}' | ConvertFrom-Json
$emptyList = '{"Items":[]}' | ConvertFrom-Json
$oneItemList = '{"Items":[{"id":"one"}]}' | ConvertFrom-Json
Assert-True -Condition (@(Get-AwsResponseList -Response $missingList -PropertyName "Items").Count -eq 0) -Message "Missing AWS list field was not empty."
Assert-True -Condition (@(Get-AwsResponseList -Response $emptyList -PropertyName "Items").Count -eq 0) -Message "Empty AWS list field was not empty."
$oneItem = @(Get-AwsResponseList -Response $oneItemList -PropertyName "Items")
Assert-True -Condition ($oneItem.Count -eq 1 -and [string]$oneItem[0].id -ceq "one") -Message "One-item AWS list field was unwrapped incorrectly."

$taskDefinitionArn = "arn:aws:ecs:us-west-1:686458136219:task-definition/mangorts-qa-database-copy-temp:9"
foreach ($registeredJson in @(
  "{`"taskDefinition`":{`"taskDefinitionArn`":`"$taskDefinitionArn`"}}",
  "{`"taskDefinition`":{`"taskDefinitionArn`":`"$taskDefinitionArn`",`"taskRoleArn`":null}}",
  "{`"taskDefinition`":{`"taskDefinitionArn`":`"$taskDefinitionArn`",`"taskRoleArn`":`"`"}}"
)) {
  $registeredArn = Get-RegisteredQaCopyTaskDefinitionArn -Registered ($registeredJson | ConvertFrom-Json)
  Assert-True -Condition ($registeredArn -ceq $taskDefinitionArn) -Message "Omitted, null, or empty taskRoleArn was not accepted safely."
}
Assert-ThrowsLike -Action {
  Get-RegisteredQaCopyTaskDefinitionArn -Registered ('{}' | ConvertFrom-Json)
} -Pattern "*did not return the registered QA copy task definition*"
Assert-ThrowsLike -Action {
  Get-RegisteredQaCopyTaskDefinitionArn -Registered ("{`"taskDefinition`":{`"taskDefinitionArn`":`"$taskDefinitionArn`",`"taskRoleArn`":`"arn:aws:iam::686458136219:role/unexpected`"}}" | ConvertFrom-Json)
} -Pattern "*no-task-role guard failed*"

$singleTaskResponse = '{"tasks":[{"taskArn":"one"}]}' | ConvertFrom-Json
$soleTask = Get-SoleEcsTask -Response $singleTaskResponse -FailureMessage "bad task response"
Assert-True -Condition ([string]$soleTask.taskArn -ceq "one") -Message "One ECS task was unwrapped incorrectly."
foreach ($invalidTaskResponse in @(
  '{}',
  '{"tasks":[]}',
  '{"failures":[],"tasks":[]}',
  '{"failures":[{"arn":"bad"}],"tasks":[{"taskArn":"one"}]}',
  '{"failures":[],"tasks":[{"taskArn":"one"},{"taskArn":"two"}]}'
)) {
  Assert-ThrowsLike -Action {
    Get-SoleEcsTask -Response ($invalidTaskResponse | ConvertFrom-Json) -FailureMessage "bad task response"
  } -Pattern "bad task response"
}

$script:qaCopyContainerName = "database-copy"
foreach ($missingExitCodeJson in @(
  '{"containers":[{"name":"database-copy"}],"stoppedReason":"task stopped"}',
  '{"containers":[{"name":"database-copy","exitCode":null,"reason":"container stopped"}]}'
)) {
  Assert-ThrowsLike -Action {
    Get-QaCopyContainerExitCode -TaskRecord ($missingExitCodeJson | ConvertFrom-Json)
  } -Pattern "*stopped before reporting an exit code*"
}
Assert-ThrowsLike -Action {
  Get-QaCopyContainerExitCode -TaskRecord ('{}' | ConvertFrom-Json)
} -Pattern "*without exactly one reviewed container*"
Assert-ThrowsLike -Action {
  Get-QaCopyContainerExitCode -TaskRecord ('{"containers":[{"name":"database-copy","exitCode":0},{"name":"database-copy","exitCode":0}]}' | ConvertFrom-Json)
} -Pattern "*without exactly one reviewed container*"
$zeroExitCode = Get-QaCopyContainerExitCode -TaskRecord ('{"containers":[{"name":"database-copy","exitCode":0}]}' | ConvertFrom-Json)
$nonzeroExitCode = Get-QaCopyContainerExitCode -TaskRecord ('{"containers":[{"name":"database-copy","exitCode":137}]}' | ConvertFrom-Json)
Assert-True -Condition ($null -ne $zeroExitCode -and [int]$zeroExitCode -eq 0) -Message "ECS exit code zero collapsed to null."
Assert-True -Condition ([int]$nonzeroExitCode -eq 137) -Message "Nonzero ECS exit code was not preserved."
Assert-QaCopyTaskSucceeded -ExitCode 0 -Messages @("QA_COPY_STATUS=success") -SnapshotID "snapshot"
Assert-ThrowsLike -Action {
  Assert-QaCopyTaskSucceeded -ExitCode 0 -Messages @() -SnapshotID "snapshot"
} -Pattern "*without one exact success attestation*"
Assert-ThrowsLike -Action {
  Assert-QaCopyTaskSucceeded -ExitCode 0 -Messages @("QA_COPY_STATUS=success", "QA_COPY_STATUS=success") -SnapshotID "snapshot"
} -Pattern "*without one exact success attestation*"
Assert-ThrowsLike -Action {
  Assert-QaCopyTaskSucceeded -ExitCode 137 -Messages @("QA_COPY_STATUS=success") -SnapshotID "snapshot"
} -Pattern "*failed with exit code 137*"

$script:jonatQaEmail = "jonathankim829@gmail.com"
$probeLogPath = [IO.Path]::GetTempFileName()
$previousProbeLog = $env:MANGORTS_QA_COPY_PROBE_LOG
$previousListShape = $env:MANGORTS_QA_COPY_LIST_SHAPE
$env:MANGORTS_QA_COPY_PROBE_LOG = $probeLogPath

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = & $PythonExecutable $AwsProbePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Fake AWS probe failed."
  }
  $raw = (@($output) -join "`n").Trim()
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

try {
  foreach ($shape in @("one", "empty", "missing")) {
    $env:MANGORTS_QA_COPY_LIST_SHAPE = $shape
    $subject = Get-OrCreateJonatQaCognitoSubject -UserPoolID "us-west-1_jFVZMkFdN"
    Assert-True -Condition ($subject -ceq "f939d90e-9061-70de-560f-661b450c2920") -Message "Unexpected Cognito subject for $shape list response."
  }

  $probeEntries = @(Get-Content -LiteralPath $probeLogPath | ForEach-Object { $_ | ConvertFrom-Json })
  $listEntries = @($probeEntries | Where-Object { [string]$_.command -ceq "list-users" })
  $createEntries = @($probeEntries | Where-Object { [string]$_.command -ceq "admin-create-user" })
  Assert-True -Condition ($listEntries.Count -eq 3) -Message "Expected three structured list-users probe calls."
  Assert-True -Condition ($createEntries.Count -eq 2) -Message "Expected create only for empty and missing Users fields."
  foreach ($entry in $listEntries) {
    Assert-True -Condition (-not (Test-Path -LiteralPath ([string]$entry.input_path))) -Message "Cognito structured-input temp file was not removed."
  }
}
finally {
  if ($null -eq $previousProbeLog) { Remove-Item Env:\MANGORTS_QA_COPY_PROBE_LOG -ErrorAction SilentlyContinue } else { $env:MANGORTS_QA_COPY_PROBE_LOG = $previousProbeLog }
  if ($null -eq $previousListShape) { Remove-Item Env:\MANGORTS_QA_COPY_LIST_SHAPE -ErrorAction SilentlyContinue } else { $env:MANGORTS_QA_COPY_LIST_SHAPE = $previousListShape }
  Remove-Item -LiteralPath $probeLogPath -Force -ErrorAction SilentlyContinue
}

Write-Output "QA copy launcher behavioral contract passed in PowerShell $($PSVersionTable.PSVersion)."
