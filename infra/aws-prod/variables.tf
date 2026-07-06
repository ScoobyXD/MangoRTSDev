variable "aws_region" {
  description = "AWS region for regional prod resources. Use the same region as the existing prod database."
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
  default     = "prod"
}

variable "root_domain_name" {
  description = "Route 53 hosted-zone root domain, for example mangorts.com."
  type        = string
}

variable "app_subdomain" {
  description = "Frontend subdomain below root_domain_name."
  type        = string
  default     = ""
}

variable "api_subdomain" {
  description = "API subdomain below root_domain_name."
  type        = string
  default     = "api"
}

variable "origin_subdomain" {
  description = "Private-ish ALB origin hostname below root_domain_name."
  type        = string
  default     = "origin"
}

variable "vpc_id" {
  description = "Existing VPC ID that can reach the existing prod database."
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
  description = "NAT gateway mode for Terraform-managed ECS private subnets. Use single for lower first-launch cost or per_az for AZ-local egress."
  type        = string
  default     = "single"

  validation {
    condition     = contains(["single", "per_az"], var.ecs_nat_gateway_mode)
    error_message = "ecs_nat_gateway_mode must be single or per_az."
  }
}

variable "existing_db_host" {
  description = "Existing prod database writer endpoint."
  type        = string
}

variable "existing_db_port" {
  description = "Existing prod database port."
  type        = number
  default     = 5432
}

variable "existing_db_name" {
  description = "Existing prod database name."
  type        = string
}

variable "existing_db_user" {
  description = "Existing prod database application user."
  type        = string
}

variable "existing_db_password_secret_arn" {
  description = "Secrets Manager ARN containing the existing prod DB password."
  type        = string
}

variable "existing_db_security_group_id" {
  description = "Security group attached to the existing prod DB. Terraform will allow ECS ingress from this stack."
  type        = string
}

variable "backend_image_uri" {
  description = "Backend image URI. Leave empty for phase-1 bootstrap before ECR contains an image."
  type        = string
  default     = ""
}

variable "deploy_revision" {
  description = "Source revision currently being deployed. Exposed through non-secret health metadata."
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
  default     = 1024
}

variable "backend_memory" {
  description = "Fargate task memory MiB."
  type        = number
  default     = 2048
}

variable "backend_desired_count" {
  description = "Number of backend tasks for prod."
  type        = number
  default     = 2
}

variable "default_company_id" {
  description = "Default production company UUID used by the frontend until tenant selection exists."
  type        = string
}

variable "email_from_address" {
  description = "Verified SES sender address for MangoRTS auth emails. Leave empty to disable backend-sent auth emails."
  type        = string
  default     = ""
}

variable "bootstrap_admin_emails" {
  description = "Comma- or space-separated Cognito emails that may be auto-granted prod_admin on first backend login. Leave empty after bootstrap."
  type        = string
  default     = ""
}

variable "bootstrap_company_name" {
  description = "Company name used when bootstrap_admin_emails creates the first prod_admin membership."
  type        = string
  default     = "MangoRTS Bootstrap"
}

variable "nylas_client_id" {
  description = "Nylas application client/application ID for Hosted OAuth. Leave empty to disable Communications email integration."
  type        = string
  default     = ""
}

variable "nylas_api_base_url" {
  description = "Nylas API base URL for the app's data residency."
  type        = string
  default     = "https://api.us.nylas.com"

  validation {
    condition     = contains(["https://api.us.nylas.com", "https://api.eu.nylas.com"], var.nylas_api_base_url)
    error_message = "nylas_api_base_url must be https://api.us.nylas.com or https://api.eu.nylas.com."
  }
}

variable "nylas_api_key_secret_arn" {
  description = "AWS Secrets Manager ARN containing the Nylas API key. Required when nylas_client_id is set."
  type        = string
  default     = ""
}

variable "nylas_state_secret_arn" {
  description = "AWS Secrets Manager ARN containing a long random secret for signing Nylas OAuth state. Required when nylas_client_id is set."
  type        = string
  default     = ""
}

variable "nylas_webhook_secret_arn" {
  description = "AWS Secrets Manager ARN containing the webhook_secret returned by the Nylas webhook destination. Enables realtime Communications updates."
  type        = string
  default     = ""
}

variable "nylas_google_scopes" {
  description = "Space-separated Google scopes requested through Nylas Hosted OAuth."
  type        = string
  default     = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.labels"
}

variable "nylas_microsoft_scopes" {
  description = "Space-separated Microsoft scopes requested through Nylas Hosted OAuth."
  type        = string
  default     = "offline_access User.Read Mail.ReadWrite Mail.Send"
}


variable "origin_verify_secret" {
  description = "Secret material used to derive the CloudFront-to-ALB origin verification header."
  type        = string
  default     = ""
  sensitive   = true
}



variable "github_owner" {
  description = "GitHub owner or organization allowed to assume the prod deploy role."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository name allowed to assume the prod deploy role."
  type        = string
}

variable "github_branch" {
  description = "GitHub branch allowed to deploy prod."
  type        = string
  default     = "main"
}

variable "extra_tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
