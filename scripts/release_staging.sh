#!/usr/bin/env bash
set -euo pipefail

echo "Legacy staging release script disabled. Use infra/aws-dev plus .github/workflows/deploy-dev.yml for MangoRTS dev hosting. The old infra/terraform staging flow is historical." >&2
exit 1
