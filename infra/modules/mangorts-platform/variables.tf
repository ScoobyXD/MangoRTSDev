variable "aws_region" {
  description = "AWS region for regional resources."
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
}

variable "stack_name" {
  description = "Stack tag value. Defaults to aws-<environment> when empty."
  type        = string
  default     = ""
}

variable "root_domain_name" {
  description = "Route 53 hosted-zone root domain, for example mangorts.com."
  type        = string
}

variable "app_subdomain" {
  description = "Frontend subdomain below root_domain_name."
  type        = string
}

variable "api_subdomain" {
  description = "API subdomain below root_domain_name."
  type        = string
}

variable "origin_subdomain" {
  description = "ALB origin hostname below root_domain_name."
  type        = string
}

variable "vpc_id" {
  description = "Existing VPC ID that can reach the application database."
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
  description = "NAT gateway mode for Terraform-managed ECS private subnets. Use single for lower cost or per_az for AZ-local egress."
  type        = string
  default     = "single"

  validation {
    condition     = contains(["single", "per_az"], var.ecs_nat_gateway_mode)
    error_message = "ecs_nat_gateway_mode must be single or per_az."
  }
}

variable "database_connection_mode" {
  description = "Database connection source. existing reuses existing_db_* inputs; managed uses managed_db_* inputs for a future or externally managed database."
  type        = string
  default     = "existing"

  validation {
    condition     = contains(["existing", "managed"], var.database_connection_mode)
    error_message = "database_connection_mode must be existing or managed."
  }
}

variable "existing_db_host" {
  description = "Existing database writer endpoint."
  type        = string
  default     = ""
}

variable "existing_db_port" {
  description = "Existing database port."
  type        = number
  default     = 5432
}

variable "existing_db_name" {
  description = "Existing database name."
  type        = string
  default     = ""
}

variable "existing_db_user" {
  description = "Existing database application user."
  type        = string
  default     = ""
}

variable "existing_db_password_secret_arn" {
  description = "Secrets Manager ARN containing the existing database password."
  type        = string
  default     = ""
}

variable "existing_db_security_group_id" {
  description = "Security group attached to the existing database. Terraform will allow ECS ingress from this stack."
  type        = string
  default     = ""
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
  default     = 512
}

variable "backend_memory" {
  description = "Fargate task memory MiB."
  type        = number
  default     = 1024
}

variable "backend_desired_count" {
  description = "Number of backend tasks."
  type        = number
  default     = 1
}

variable "realtime_valkey_enabled" {
  description = "Create the development-only ElastiCache Serverless Valkey realtime backplane."
  type        = bool
  default     = false
}

variable "realtime_valkey_channel" {
  description = "Exact Valkey Pub/Sub channel used for compact committed realtime events."
  type        = string
  default     = "mangorts:realtime:v1"

  validation {
    condition     = can(regex("^[A-Za-z0-9:_-]{1,128}$", var.realtime_valkey_channel))
    error_message = "realtime_valkey_channel must be 1-128 characters using letters, numbers, colon, underscore, or hyphen."
  }
}

variable "realtime_valkey_major_engine_version" {
  description = "Development Valkey major engine version. IAM authentication requires Valkey 7.2 or newer."
  type        = string
  default     = "7"
}

variable "realtime_valkey_max_data_storage_gb" {
  description = "Maximum development serverless-cache data storage in GB."
  type        = number
  default     = 1

  validation {
    condition     = var.realtime_valkey_max_data_storage_gb >= 1 && var.realtime_valkey_max_data_storage_gb <= 5000
    error_message = "realtime_valkey_max_data_storage_gb must be between 1 and 5000."
  }
}

variable "realtime_valkey_max_ecpu_per_second" {
  description = "Maximum development serverless-cache processing units per second."
  type        = number
  default     = 1000

  validation {
    condition     = var.realtime_valkey_max_ecpu_per_second >= 1000 && var.realtime_valkey_max_ecpu_per_second <= 15000000
    error_message = "realtime_valkey_max_ecpu_per_second must be between 1000 and 15000000."
  }
}

variable "realtime_valkey_alarm_action_arns" {
  description = "Optional SNS or incident-response actions for development Valkey CloudWatch alarms."
  type        = list(string)
  default     = []
}

variable "attachment_s3_bucket" {
  description = "Private S3 bucket used by the Mango attachment system. Leave empty to disable attachment object storage."
  type        = string
  default     = ""
}

variable "attachment_direct_upload_enabled" {
  description = "Enable browser-to-S3 attachment uploads when attachment_s3_bucket is configured."
  type        = bool
  default     = true
}

variable "attachment_max_browser_upload_bytes" {
  description = "Authoritative maximum size in bytes for one browser-originated attachment."
  type        = number
  default     = 1073741824

  validation {
    condition     = var.attachment_max_browser_upload_bytes > 0 && floor(var.attachment_max_browser_upload_bytes) == var.attachment_max_browser_upload_bytes
    error_message = "attachment_max_browser_upload_bytes must be a positive whole number."
  }
}

variable "attachment_upload_intent_ttl_seconds" {
  description = "Lifetime in seconds for a durable browser upload intent."
  type        = number
  default     = 86400

  validation {
    condition     = var.attachment_upload_intent_ttl_seconds > 0 && floor(var.attachment_upload_intent_ttl_seconds) == var.attachment_upload_intent_ttl_seconds
    error_message = "attachment_upload_intent_ttl_seconds must be a positive whole number."
  }
}

variable "attachment_single_put_url_ttl_seconds" {
  description = "Lifetime in seconds for one presigned single-PUT URL; V1 permits at most 60 minutes."
  type        = number
  default     = 3600

  validation {
    condition     = var.attachment_single_put_url_ttl_seconds > 0 && var.attachment_single_put_url_ttl_seconds <= 3600 && floor(var.attachment_single_put_url_ttl_seconds) == var.attachment_single_put_url_ttl_seconds
    error_message = "attachment_single_put_url_ttl_seconds must be a whole number from 1 through 3600."
  }
}

variable "attachment_multipart_part_url_ttl_seconds" {
  description = "Lifetime in seconds for a presigned multipart-part URL; V1 permits at most 15 minutes."
  type        = number
  default     = 900

  validation {
    condition     = var.attachment_multipart_part_url_ttl_seconds > 0 && var.attachment_multipart_part_url_ttl_seconds <= 900 && floor(var.attachment_multipart_part_url_ttl_seconds) == var.attachment_multipart_part_url_ttl_seconds
    error_message = "attachment_multipart_part_url_ttl_seconds must be a whole number from 1 through 900."
  }
}

variable "attachment_s3_presign_endpoint" {
  description = "Optional browser-reachable S3 endpoint used only when generated presigned URLs must differ from the backend S3 endpoint."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.attachment_s3_presign_endpoint) == "" || can(regex("^https?://[^[:space:]]+$", trimspace(var.attachment_s3_presign_endpoint)))
    error_message = "attachment_s3_presign_endpoint must be empty or an http(s) URL."
  }
}

variable "attachment_additional_browser_origins" {
  description = "Additional exact browser origins allowed to PUT to the attachment bucket. The app origin is automatic; dev also includes http://localhost:5173."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([
      for origin in var.attachment_additional_browser_origins :
      can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", trimspace(origin)))
    ])
    error_message = "attachment_additional_browser_origins must contain exact HTTPS origins without paths or wildcards. The documented dev loopback origin is added automatically."
  }
}

variable "attachment_multipart_abort_days" {
  description = "Days after initiation when S3 lifecycle aborts an incomplete multipart attachment upload as a cleanup backstop."
  type        = number
  default     = 2

  validation {
    condition     = var.attachment_multipart_abort_days >= 1 && floor(var.attachment_multipart_abort_days) == var.attachment_multipart_abort_days
    error_message = "attachment_multipart_abort_days must be a positive whole number."
  }
}

variable "default_company_id" {
  description = "Default company UUID used by the frontend until tenant selection exists."
  type        = string
}

variable "email_from_address" {
  description = "Verified SES sender address for MangoRTS auth emails. Leave empty to disable backend-sent auth emails."
  type        = string
  default     = ""
}

variable "bootstrap_admin_emails" {
  description = "Comma- or space-separated Cognito emails that may be auto-granted dev_admin on first backend login. Leave empty after bootstrap."
  type        = string
  default     = ""
}

variable "bootstrap_company_name" {
  description = "Company name used when bootstrap_admin_emails creates the first dev_admin membership."
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
  description = "GitHub owner or organization allowed to assume the deploy role."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository name allowed to assume the deploy role."
  type        = string
}

variable "github_branch" {
  description = "GitHub branch allowed to deploy when github_oidc_subjects is empty."
  type        = string
  default     = "main"
}

variable "github_oidc_subjects" {
  description = "Explicit GitHub OIDC subject claims allowed to assume the deploy role. Leave empty to allow the configured branch ref subject."
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
