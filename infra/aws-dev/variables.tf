variable "aws_region" {
  description = "AWS region for regional dev resources. Use the same region as the existing dev database."
  type        = string
  default     = "us-west-1"
}

variable "project_name" {
  description = "Canonical project slug used in AWS resource names."
  type        = string
  default     = "mangorts"
}

variable "environment" {
  description = "Environment slug."
  type        = string
  default     = "dev"
}

variable "root_domain_name" {
  description = "Route 53 hosted-zone root domain, for example mangorts.com."
  type        = string
}

variable "app_subdomain" {
  description = "Frontend subdomain below root_domain_name."
  type        = string
  default     = "dev"
}

variable "api_subdomain" {
  description = "API subdomain below root_domain_name."
  type        = string
  default     = "api.dev"
}

variable "origin_subdomain" {
  description = "Private-ish ALB origin hostname below root_domain_name."
  type        = string
  default     = "origin.dev"
}

variable "vpc_id" {
  description = "Existing VPC ID that can reach the existing dev database."
  type        = string
}

variable "public_subnet_ids" {
  description = "Existing public subnet IDs for the Application Load Balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs for ECS Fargate tasks. Leave empty when create_private_ecs_subnets is true."
  type        = list(string)
  default     = []
}

variable "create_private_ecs_subnets" {
  description = "Create private subnets and NAT egress for ECS tasks inside the existing VPC."
  type        = bool
  default     = false
}

variable "ecs_private_subnet_cidrs" {
  description = "CIDR blocks for Terraform-managed ECS private subnets. Required when create_private_ecs_subnets is true."
  type        = list(string)
  default     = []
}

variable "ecs_nat_gateway_mode" {
  description = "NAT gateway mode for Terraform-managed ECS private subnets. Use single for lower dev cost or per_az for AZ-local egress."
  type        = string
  default     = "single"

  validation {
    condition     = contains(["single", "per_az"], var.ecs_nat_gateway_mode)
    error_message = "ecs_nat_gateway_mode must be single or per_az."
  }
}

variable "existing_db_host" {
  description = "Existing dev database writer endpoint."
  type        = string
}

variable "existing_db_port" {
  description = "Existing dev database port."
  type        = number
  default     = 5432
}

variable "existing_db_name" {
  description = "Existing dev database name."
  type        = string
}

variable "existing_db_user" {
  description = "Existing dev database application user."
  type        = string
}

variable "existing_db_password_secret_arn" {
  description = "Secrets Manager ARN containing the existing dev DB password."
  type        = string
}

variable "existing_db_security_group_id" {
  description = "Security group attached to the existing dev DB. Terraform will allow ECS ingress from this stack."
  type        = string
}

variable "backend_image_uri" {
  description = "Backend image URI. Leave empty for phase-1 bootstrap before ECR contains an image."
  type        = string
  default     = ""
}

variable "container_port" {
  description = "Backend container port."
  type        = number
  default     = 8080
}

variable "backend_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Fargate task memory MiB."
  type        = number
  default     = 1024
}

variable "backend_desired_count" {
  description = "Number of backend tasks for dev."
  type        = number
  default     = 1
}

variable "dev_company_id" {
  description = "Default dev company UUID used by the frontend until tenant selection exists."
  type        = string
}

variable "email_from_address" {
  description = "Verified SES sender address for MangoRTS auth emails. Leave empty to disable backend-sent auth emails."
  type        = string
  default     = ""
}

variable "cognito_domain_prefix" {
  description = "Deprecated from the Hosted UI flow. Kept temporarily so older tfvars files continue to load."
  type        = string
}

variable "dev_basic_auth_username" {
  description = "Dev edge basic-auth username."
  type        = string
  default     = "mangorts-dev"
}

variable "dev_basic_auth_password" {
  description = "Dev edge basic-auth password. Stored in Terraform state; use only for temporary dev gating."
  type        = string
  sensitive   = true
}

variable "github_owner" {
  description = "GitHub owner or organization allowed to assume the dev deploy role."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository name allowed to assume the dev deploy role."
  type        = string
}

variable "github_branch" {
  description = "GitHub branch allowed to deploy dev."
  type        = string
  default     = "main"
}

variable "extra_tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
