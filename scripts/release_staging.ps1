param(
  [ValidateSet("plan", "apply")]
  [string]$Action = "plan"
)

$ErrorActionPreference = "Stop"

throw "Legacy staging release script disabled. Use infra/aws-dev plus .github/workflows/deploy-dev.yml for MangoRTS dev hosting. The old infra/terraform staging flow is historical."
