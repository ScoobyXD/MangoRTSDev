# DEV Deployment Laws

1. The DEV API task defaults to 1024 CPU units (1 vCPU) and 2048 MiB (2 GiB) of memory.
2. The DEV private email-worker task defaults to 512 CPU units (0.5 vCPU) and 1024 MiB (1 GiB) of memory.
3. Normal DEV deployment runs one API task and one email-worker task.
4. The daily DEV attachment-maintenance task inherits the API CPU and memory settings.
5. The DEV deployment workflow uses the CPU and memory defaults in `infra/aws-dev/variables.tf` without sizing overrides.
6. DEV sizing changes must leave QA and production sizing unchanged.

## Process Story

After the change reaches `main`, a separately authorized run of `.github/workflows/deploy-dev.yml` writes `ci.auto.tfvars` with the existing task count and worker enablement, but no CPU or memory values. Terraform takes those defaults from the DEV root, passes them through `infra/aws-dev/main.tf` to the shared module, and registers new API, email-worker, and attachment-maintenance task definitions. The services roll out at the same task counts, and the daily maintenance schedule targets its new task definition. No GitHub variable changes are needed. Local Terraform runs with explicit sizing inputs must use the same targets because explicit inputs override defaults.
