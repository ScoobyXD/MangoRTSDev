$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$databaseHost = "miraerts-northerncalifornia-devcluster.cluster-c3mk8yoeah0y.us-west-1.rds.amazonaws.com"
$databasePort = "5432"
$databaseName = "MiraeRTSDevDatabase"
$databaseUser = "mangorts_readonly"
$securePassword = $null
$plainPassword = $null
try {
    $securePassword = Read-Host "Enter the literal mangorts_readonly database password" -AsSecureString
    $plainPassword = [System.Net.NetworkCredential]::new("", $securePassword).Password
    $env:MANGORTS_V3_PREFLIGHT_DATABASE_URL = "postgresql://$([Uri]::EscapeDataString($databaseUser)):$([Uri]::EscapeDataString($plainPassword))@${databaseHost}:${databasePort}/$([Uri]::EscapeDataString($databaseName))?uselibpqcompat=true&sslmode=require"
    Push-Location -LiteralPath (Join-Path $PSScriptRoot "..\frontend")
    try { & npm.cmd run v3:cutover-preflight; $exitCode = $LASTEXITCODE } finally { Pop-Location }
    if ($exitCode -eq 2) { throw "V3 preflight found blockers. Review the JSON above; nothing was written." }
    if ($exitCode -ne 0) { throw "V3 preflight could not complete." }
}
finally {
    Remove-Item Env:MANGORTS_V3_PREFLIGHT_DATABASE_URL -ErrorAction SilentlyContinue
    $plainPassword = $null
    if ($null -ne $securePassword) { $securePassword.Dispose() }
}
