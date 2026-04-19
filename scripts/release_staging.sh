#!/usr/bin/env bash
set -euo pipefail

# One-command helper for staging deploy flow:
# 1) build image
# 2) push to ECR
# 3) run terraform (plan/apply)
#
# Usage:
#   ./scripts/release_staging.sh plan
#   ./scripts/release_staging.sh apply

ACTION="${1:-plan}"
if [[ "${ACTION}" != "plan" && "${ACTION}" != "apply" ]]; then
  echo "Usage: $0 [plan|apply]"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
TF_DIR="${ROOT_DIR}/infra/terraform"

AWS_REGION="${AWS_REGION:-us-west-1}"
PROJECT_NAME="${PROJECT_NAME:-mangoos}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "==> Checking required tools..."
command -v aws >/dev/null
command -v docker >/dev/null
command -v terraform >/dev/null

echo "==> Resolving AWS account id..."
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_HOST="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
CASE_REPO="${PROJECT_NAME}-${ENVIRONMENT}-case-api"
SEARCH_REPO="${PROJECT_NAME}-${ENVIRONMENT}-search-api"
CASE_IMAGE="${ECR_HOST}/${CASE_REPO}:${IMAGE_TAG}"
SEARCH_IMAGE="${ECR_HOST}/${SEARCH_REPO}:${IMAGE_TAG}"

echo "==> Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_HOST}"

echo "==> Ensuring ECR repos exist..."
aws ecr create-repository --repository-name "${CASE_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1 || true
aws ecr create-repository --repository-name "${SEARCH_REPO}" --region "${AWS_REGION}" >/dev/null 2>&1 || true

echo "==> Building backend image..."
cd "${BACKEND_DIR}"
docker build -t "${CASE_IMAGE}" -f - . <<'DOCKERFILE'
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/miraeopus-api ./cmd/miraeopus-api

FROM gcr.io/distroless/base-debian12
COPY --from=build /out/miraeopus-api /miraeopus-api
ENTRYPOINT ["/miraeopus-api"]
DOCKERFILE

echo "==> Pushing case-api image..."
docker push "${CASE_IMAGE}"

echo "==> Tagging same image for search-api (temporary)..."
docker tag "${CASE_IMAGE}" "${SEARCH_IMAGE}"
docker push "${SEARCH_IMAGE}"

echo "==> Preparing terraform vars..."
cd "${TF_DIR}"
if [[ ! -f terraform.tfvars ]]; then
  cp terraform.tfvars.example terraform.tfvars
  cat <<'EOF'
terraform.tfvars was created from terraform.tfvars.example.
Please edit infra/terraform/terraform.tfvars first, then run this command again.
EOF
  exit 1
fi

echo "==> Updating image URIs in terraform.tfvars..."
if command -v python3 >/dev/null; then
  python3 - "${CASE_IMAGE}" "${SEARCH_IMAGE}" <<'PY'
import re
import sys
from pathlib import Path

case = sys.argv[1]
search = sys.argv[2]
path = Path("terraform.tfvars")
text = path.read_text()
text = re.sub(r'case_api_image\s*=\s*".*"', f'case_api_image         = "{case}"', text)
text = re.sub(r'search_api_image\s*=\s*".*"', f'search_api_image       = "{search}"', text)
path.write_text(text)
print("Updated case_api_image and search_api_image in terraform.tfvars")
PY
else
  echo "python3 not found; update case_api_image/search_api_image in terraform.tfvars manually:"
  echo "  ${CASE_IMAGE}"
  echo "  ${SEARCH_IMAGE}"
fi

echo "==> Running terraform init..."
terraform init

echo "==> Running terraform plan..."
terraform plan -out=tfplan

if [[ "${ACTION}" == "apply" ]]; then
  echo "==> Applying terraform plan..."
  terraform apply tfplan
fi

echo "==> Done."
if [[ "${ACTION}" == "plan" ]]; then
  echo "Next step: run ./scripts/release_staging.sh apply"
fi
