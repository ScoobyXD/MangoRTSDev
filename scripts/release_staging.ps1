param(
  [ValidateSet("plan", "apply")]
  [string]$Action = "plan"
)

$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BackendDir = Join-Path $RootDir "backend"
$TfDir = Join-Path $RootDir "infra/terraform"

$AwsRegion = if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-west-1" }
$ProjectName = if ($env:PROJECT_NAME) { $env:PROJECT_NAME } else { "mangorts" }
$EnvironmentName = if ($env:ENVIRONMENT) { $env:ENVIRONMENT } else { "staging" }
$ImageTag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "latest" }

Write-Host "==> Checking required tools..."
Get-Command aws | Out-Null
Get-Command docker | Out-Null
Get-Command terraform | Out-Null

Write-Host "==> Resolving AWS account id..."
$AccountId = aws sts get-caller-identity --query Account --output text
$EcrHost = "$AccountId.dkr.ecr.$AwsRegion.amazonaws.com"
$CaseRepo = "$ProjectName-$EnvironmentName-case-api"
$SearchRepo = "$ProjectName-$EnvironmentName-search-api"
$CaseImage = "$EcrHost/$CaseRepo`:$ImageTag"
$SearchImage = "$EcrHost/$SearchRepo`:$ImageTag"

Write-Host "==> Logging in to ECR..."
aws ecr get-login-password --region $AwsRegion | docker login --username AWS --password-stdin $EcrHost

Write-Host "==> Ensuring ECR repos exist..."
try { aws ecr create-repository --repository-name $CaseRepo --region $AwsRegion | Out-Null } catch {}
try { aws ecr create-repository --repository-name $SearchRepo --region $AwsRegion | Out-Null } catch {}

Write-Host "==> Building backend image..."
Set-Location $BackendDir
@'
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/miraeopus-api ./cmd/miraeopus-api

FROM gcr.io/distroless/base-debian12
COPY --from=build /out/miraeopus-api /miraeopus-api
ENTRYPOINT ["/miraeopus-api"]
'@ | docker build -t $CaseImage -f - .

Write-Host "==> Pushing case-api image..."
docker push $CaseImage

Write-Host "==> Tagging same image for search-api (temporary)..."
docker tag $CaseImage $SearchImage
docker push $SearchImage

Write-Host "==> Preparing terraform vars..."
Set-Location $TfDir
$TfvarsPath = Join-Path $TfDir "terraform.tfvars"
if (-not (Test-Path $TfvarsPath)) {
  Copy-Item (Join-Path $TfDir "terraform.tfvars.example") $TfvarsPath
  Write-Host "terraform.tfvars was created from terraform.tfvars.example."
  Write-Host "Please edit infra/terraform/terraform.tfvars first, then run this command again."
  exit 1
}

Write-Host "==> Updating image URIs in terraform.tfvars..."
$Content = Get-Content $TfvarsPath -Raw
$Content = [regex]::Replace($Content, 'case_api_image\s*=\s*".*"', "case_api_image         = ""$CaseImage""")
$Content = [regex]::Replace($Content, 'search_api_image\s*=\s*".*"', "search_api_image       = ""$SearchImage""")
Set-Content -Path $TfvarsPath -Value $Content

Write-Host "==> Running terraform init..."
terraform init

Write-Host "==> Running terraform plan..."
terraform plan -out=tfplan

if ($Action -eq "apply") {
  Write-Host "==> Applying terraform plan..."
  terraform apply tfplan
}

Write-Host "==> Done."
if ($Action -eq "plan") {
  Write-Host "Next step: ./scripts/release_staging.ps1 -Action apply"
}
