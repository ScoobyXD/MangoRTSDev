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
  description = "Existing private subnet IDs for ECS Fargate tasks."
  type        = list(string)
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
  description = "Initial backend image URI. CI should update ECS task definitions to immutable git-SHA image tags."
  type        = string
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

variable "cognito_domain_prefix" {
  description = "Cognito hosted login domain prefix. Must be globally unique within the region."
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
