# DEV Deployment Laws

1. The DEV API task defaults to 1024 CPU units (1 vCPU) and 2048 MiB (2 GiB) of memory.
2. The DEV private email-worker task defaults to 512 CPU units (0.5 vCPU) and 1024 MiB (1 GiB) of memory.
3. Normal DEV deployment runs one API task and one email-worker task.
4. The daily DEV attachment-maintenance task inherits the API CPU and memory settings.
5. The DEV deployment workflow uses the CPU and memory defaults in `infra/aws-dev/variables.tf` without sizing overrides.
6. DEV sizing changes must leave QA and production sizing unchanged.
7. The existing DEV Aurora cluster `miraerts-northerncalifornia-devcluster` in `us-west-1` must use a minimum of 0.5 ACU and a maximum of 1 ACU.

## Process Story

An authorized run of `.github/workflows/deploy-dev.yml` from `main` writes task count and worker enablement to `ci.auto.tfvars` and uses the DEV root CPU and memory defaults. `infra/aws-dev/main.tf` passes these values to the shared module, which updates the API, email-worker, and daily maintenance task definitions while preserving task counts. No GitHub variable changes are needed; explicit local sizing inputs must match the same targets. An authorized RDS capacity change configures the Aurora range directly on the existing DEV cluster. The ECS Terraform deployment references its database endpoint without managing Aurora capacity.
