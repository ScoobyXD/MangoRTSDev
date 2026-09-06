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

variable "database_connection_mode" {
  description = "Database connection source. existing reuses existing_db_* inputs; managed uses managed_db_* inputs reserved for future managed DB work."
  type        = string
  default     = "existing"

  validation {
    condition     = contains(["existing", "managed"], var.database_connection_mode)
    error_message = "database_connection_mode must be existing or managed."
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

variable "managed_db_host" {
  description = "Managed database writer endpoint. Reserved for future managed DB work or an externally managed DB module."
  type        = string
  default     = ""
}

variable "managed_db_port" {
  description = "Managed database port. Reserved for future managed DB work or an externally managed DB module."
  type        = number
  default     = 5432
}

variable "managed_db_name" {
  description = "Managed database name. Reserved for future managed DB work or an externally managed DB module."
  type        = string
  default     = ""
}

variable "managed_db_user" {
  description = "Managed database application user. Reserved for future managed DB work or an externally managed DB module."
  type        = string
  default     = ""
}

variable "managed_db_password_secret_arn" {
  description = "Secrets Manager ARN containing the managed database password. Reserved for future managed DB work or an externally managed DB module."
  type        = string
  default     = ""
}

variable "managed_db_security_group_id" {
  description = "Security group attached to the managed database. Reserved for future managed DB work or an externally managed DB module."
  type        = string
  default     = ""
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
  description = "Number of backend tasks for dev."
  type        = number
  default     = 1

  validation {
    condition     = var.backend_desired_count >= 0 && floor(var.backend_desired_count) == var.backend_desired_count
    error_message = "backend_desired_count must be a whole number of zero or more."
  }
}

variable "email_sqs_enabled" {
  description = "Create the DEV email SQS queues and API send permission."
  type        = bool
  default     = true
}

variable "email_worker_enabled" {
  description = "Run the single private DEV email worker during normal deployments."
  type        = bool
  default     = true
}

variable "email_sqs_database_migration_complete" {
  description = "Whether the DEV database has the final email SQS schema."
  type        = bool
  default     = true
}

variable "email_reconciliation_schedule_enabled" {
  description = "Enable rare DEV email reconciliation separately from normal deployments."
  type        = bool
  default     = false
}

variable "email_worker_concurrency" {
  description = "Bounded concurrency inside the single DEV email worker task."
  type        = number
  default     = 3

  validation {
    condition     = var.email_worker_concurrency >= 1 && var.email_worker_concurrency <= 8 && floor(var.email_worker_concurrency) == var.email_worker_concurrency
    error_message = "email_worker_concurrency must be a whole number from 1 through 8."
  }
}

variable "email_worker_cpu" {
  description = "Fargate CPU units for the private DEV email worker."
  type        = number
  default     = 512
}

variable "email_worker_memory" {
  description = "Fargate memory MiB for the private DEV email worker."
  type        = number
  default     = 1024
}

variable "email_worker_alarm_action_arns" {
  description = "Optional alarm action ARNs for DEV email queue, worker, and Scheduler alerts."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for arn in var.email_worker_alarm_action_arns : can(regex("^arn:[^:]+:[^:]+:[^:]*:[^:]*:.+$", arn))])
    error_message = "email_worker_alarm_action_arns must contain only AWS ARNs."
  }
}

variable "realtime_valkey_enabled" {
  description = "Create the private development ElastiCache Serverless Valkey realtime backplane."
  type        = bool
  default     = true
}

variable "realtime_valkey_channel" {
  description = "Exact Pub/Sub channel used for compact committed realtime events."
  type        = string
  default     = "mangorts:realtime:v1"
}

variable "realtime_valkey_major_engine_version" {
  description = "Development Valkey major engine version."
  type        = string
  default     = "7"
}

variable "realtime_valkey_max_data_storage_gb" {
  description = "Maximum development Valkey serverless storage in GB."
  type        = number
  default     = 1
}

variable "realtime_valkey_max_ecpu_per_second" {
  description = "Maximum development Valkey serverless ECPUs per second."
  type        = number
  default     = 1000
}

variable "realtime_valkey_alarm_action_arns" {
  description = "Optional alarm action ARNs for development Valkey alerts."
  type        = list(string)
  default     = []
}

variable "attachment_s3_bucket" {
  description = "Private S3 bucket used by the Mango attachment system in dev."
  type        = string
  default     = "mangorts-dev-attachments"
}

variable "attachment_direct_upload_enabled" {
  description = "Enable browser-to-S3 attachment uploads in dev when attachment storage is configured."
  type        = bool
  default     = true
}

variable "attachment_max_browser_upload_bytes" {
  description = "Authoritative maximum size in bytes for one browser-originated attachment."
  type        = number
  default     = 1073741824
}

variable "attachment_upload_intent_ttl_seconds" {
  description = "Lifetime in seconds for a durable browser upload intent."
  type        = number
  default     = 86400
}

variable "attachment_single_put_url_ttl_seconds" {
  description = "Lifetime in seconds for a presigned single-PUT URL."
  type        = number
  default     = 3600
}

variable "attachment_multipart_part_url_ttl_seconds" {
  description = "Lifetime in seconds for a presigned multipart-part URL."
  type        = number
  default     = 900
}

variable "attachment_s3_presign_endpoint" {
  description = "Optional browser-reachable S3 endpoint for dev custom/local object storage."
  type        = string
  default     = ""
}

variable "attachment_additional_browser_origins" {
  description = "Additional exact browser origins allowed by attachment-bucket CORS; the dev app origin and http://localhost:5173 are automatic."
  type        = set(string)
  default     = []
}

variable "attachment_multipart_abort_days" {
  description = "Days after initiation when S3 lifecycle aborts an incomplete multipart attachment upload."
  type        = number
  default     = 2
}

variable "default_company_id" {
  description = "Default company UUID used by the frontend until tenant selection exists. Prefer this over dev_company_id for new config."
  type        = string
  default     = ""
}

variable "dev_company_id" {
  description = "Deprecated compatibility alias for default_company_id."
  type        = string
  default     = ""
}

variable "email_from_address" {
  description = "Verified SES sender address for MangoRTS auth emails. Leave empty to disable backend-sent auth emails."
  type        = string
  default     = ""
}

variable "bootstrap_admin_emails" {
  description = "Comma- or space-separated Cognito emails that may be auto-granted dev_admin on first backend login. Prefer this over bootstrap_dev_admin_emails for new config."
  type        = string
  default     = ""
}

variable "bootstrap_dev_admin_emails" {
  description = "Deprecated compatibility alias for bootstrap_admin_emails."
  type        = string
  default     = ""
}

variable "bootstrap_company_name" {
  description = "Company name used when bootstrap_admin_emails creates the first dev_admin membership. Prefer this over bootstrap_dev_company_name for new config."
  type        = string
  default     = ""
}

variable "bootstrap_dev_company_name" {
  description = "Deprecated compatibility alias for bootstrap_company_name."
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

variable "cognito_domain_prefix" {
  description = "Deprecated from the Hosted UI flow. Kept temporarily so older tfvars files continue to load."
  type        = string
  default     = ""
}

variable "origin_verify_secret" {
  description = "Secret material used to derive the CloudFront-to-ALB origin verification header. Prefer setting this instead of deprecated dev_basic_auth_password."
  type        = string
  default     = ""
  sensitive   = true
}

variable "dev_basic_auth_username" {
  description = "Deprecated. Dev CloudFront Basic Auth has been removed; this is kept temporarily so older tfvars files continue to load."
  type        = string
  default     = ""
}

variable "dev_basic_auth_password" {
  description = "Deprecated. No longer gates dev traffic; kept temporarily so older tfvars can still derive the origin verification header."
  type        = string
  default     = ""
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
  description = "GitHub branch allowed to deploy dev when github_oidc_subjects is empty."
  type        = string
  default     = "main"
}

variable "github_oidc_subjects" {
  description = "Explicit GitHub OIDC subject claims allowed to assume the deploy role. Leave empty to preserve the existing branch-ref subject."
  type        = list(string)
  default     = []
}

variable "create_github_oidc_provider" {
  description = "Create the account-level GitHub OIDC provider. Set false when the account already has one and pass github_oidc_provider_arn."
  type        = bool
  default     = true
}

variable "github_oidc_provider_arn" {
  description = "Existing GitHub OIDC provider ARN to use when create_github_oidc_provider is false."
  type        = string
  default     = ""
}

variable "extra_tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
variable "attachment_maintenance_alarm_action_arns" {
  description = "Existing notification targets for daily attachment recovery failures; empty means visible CloudWatch alarms only."
  type        = list(string)
  default     = []
}
