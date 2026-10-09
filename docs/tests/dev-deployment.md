# DEV Deployment Laws

1. The DEV API task defaults to 256 CPU units (0.25 vCPU) and 512 MiB (0.5 GiB) of memory.
2. The DEV private email-worker task defaults to 256 CPU units (0.25 vCPU) and 512 MiB (0.5 GiB) of memory.
3. Normal DEV deployment runs one API task and keeps the email worker paused at zero tasks without removing its resources.
4. The daily DEV attachment-maintenance task inherits the API CPU and memory settings.
5. The DEV deployment workflow uses the CPU and memory defaults in `infra/aws-dev/variables.tf` without sizing overrides.
6. DEV sizing changes must leave QA and production sizing unchanged.
7. The existing DEV Aurora cluster `miraerts-northerncalifornia-devcluster` in `us-west-1` must use minimum 0 ACU, maximum 1 ACU, and auto-pause after 900 idle seconds.
8. DEV Container Insights stays disabled while existing CloudWatch alarms and their settings remain unchanged.
9. DEV NAT mode defaults to `none`, and the GitHub NAT input and local Terraform input must also use `none`.
10. NAT mode `none` places ECS services and daily attachment maintenance in public subnets with public IPs and unchanged security groups.
11. Valkey retains its private subnets, route tables, and subnet associations when NAT mode is `none`.
12. NAT mode `none` removes only managed NAT gateways, their EIPs, and their private default routes.
13. DEV tasks allow 60 seconds for database connections, and the backend allows 180 seconds before load-balancer health checks can stop it.

## Process Story

An authorized run of `.github/workflows/deploy-dev.yml` from `main` writes task count and worker enablement to `ci.auto.tfvars` and uses the DEV root CPU and memory defaults. `infra/aws-dev/main.tf` passes these values to the shared module, which updates the API, email-worker, and daily maintenance task definitions while preserving task counts. Keep the GitHub NAT input at `none`. Explicit local sizing inputs must match the same targets. An authorized RDS capacity change configures the Aurora range directly on the existing DEV cluster. The ECS Terraform deployment references its database endpoint without managing Aurora capacity.
