param(
  [string]$Root = "."
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command rg -ErrorAction SilentlyContinue)) {
  Write-Error "Required command 'rg' was not found on PATH."
  exit 2
}

$pattern = '^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|)( .*)?$|^=======$'
& rg -n $pattern $Root
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
  Write-Error "Conflict markers found. Resolve them before merging."
  exit 1
}

if ($exitCode -eq 1) {
  Write-Host "No conflict markers found."
  exit 0
}

exit $exitCode
