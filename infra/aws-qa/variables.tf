variable "aws_region" {
  description = "AWS region for QA resources."
  type        = string
  default     = "us-west-1"
}

variable "terraform_state_bucket_name" {
  description = "Existing private S3 bucket that stores the hard-locked QA Terraform state object."
  type        = string

  validation {
    condition     = trimspace(var.terraform_state_bucket_name) != ""
    error_message = "terraform_state_bucket_name is required."
  }
}

variable "vpc_id" {
  description = "Existing VPC shared with the current MangoRTS environment."
  type        = string
}

variable "public_subnet_ids" {
  description = "Existing public subnet IDs for the QA Application Load Balancer."
  type        = list(string)

  validation {
    condition     = length(toset(var.public_subnet_ids)) >= 2
    error_message = "public_subnet_ids must contain at least two distinct existing subnets."
  }
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs with current NAT egress, reused by QA ECS, Valkey, and RDS."
  type        = list(string)

  validation {
    condition     = length(toset(var.private_subnet_ids)) >= 2
    error_message = "private_subnet_ids must contain at least two distinct existing subnets."
  }
}

variable "database_engine_version" {
  description = "PostgreSQL 17 engine version available in the selected AWS region."
  type        = string
  default     = "17.7"

  validation {
    condition     = can(regex("^17(?:\\.[0-9]+)?$", var.database_engine_version))
    error_message = "database_engine_version must remain on PostgreSQL 17.x."
  }
}

variable "database_instance_class" {
  description = "Small Single-AZ QA RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage_gb" {
  description = "Initial encrypted gp3 database storage in GiB."
  type        = number
  default     = 20

  validation {
    condition     = var.database_allocated_storage_gb >= 20
    error_message = "database_allocated_storage_gb must be at least 20 GiB for RDS PostgreSQL gp3."
  }
}

variable "database_max_allocated_storage_gb" {
  description = "Maximum RDS storage autoscaling limit in GiB; zero disables autoscaling for predictable QA cost."
  type        = number
  default     = 0
}

variable "database_name" {
  description = "Fresh QA PostgreSQL database name."
  type        = string
  default     = "mangorts_qa"
}

variable "database_user" {
  description = "QA PostgreSQL master/application user for the initial minimal environment."
  type        = string
  default     = "mangorts_app"
}

variable "database_backup_retention_days" {
  description = "Automated backup retention for the synthetic QA database."
  type        = number
  default     = 1

  validation {
    condition     = var.database_backup_retention_days >= 0 && var.database_backup_retention_days <= 35
    error_message = "database_backup_retention_days must be from 0 through 35."
  }
}

variable "database_deletion_protection" {
  description = "Protect the QA database from accidental deletion."
  type        = bool
  default     = true
}

variable "backend_image_uri" {
  description = "Immutable backend image URI. Leave empty during the first infrastructure-only apply."
  type        = string
  default     = ""
}

variable "migration_image_uri" {
  description = "Immutable image built from backend/Dockerfile.migrations for the human-triggered one-off schema task."
  type        = string
  default     = ""
}

variable "deploy_revision" {
  description = "Source revision exposed through health metadata."
  type        = string
  default     = ""
}

variable "backend_cpu" {
  description = "QA API Fargate CPU units."
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "QA API Fargate memory in MiB."
  type        = number
  default     = 1024
}

variable "backend_desired_count" {
  description = "Number of QA API tasks."
  type        = number
  default     = 1
}

variable "email_worker_enabled" {
  description = "Run the QA email worker only after QA Nylas and controlled mailboxes are configured."
  type        = bool
  default     = false
}

variable "email_sqs_database_migration_complete" {
  description = "Reviewed confirmation that the fresh QA database has the current canonical schema."
  type        = bool
  default     = false
}

variable "email_reconciliation_schedule_enabled" {
  description = "Enable the rare QA email reconciliation schedule."
  type        = bool
  default     = false
}

variable "email_worker_concurrency" {
  description = "Bounded concurrency inside the small QA email worker."
  type        = number
  default     = 1
}

variable "email_worker_cpu" {
  description = "QA email-worker Fargate CPU units."
  type        = number
  default     = 256
}

variable "email_worker_memory" {
  description = "QA email-worker Fargate memory in MiB."
  type        = number
  default     = 512
}

variable "email_worker_alarm_action_arns" {
  description = "Optional QA email alarm destinations."
  type        = list(string)
  default     = []
}

variable "realtime_valkey_enabled" {
  description = "Create the QA Valkey backplane for cross-task realtime and the email worker."
  type        = bool
  default     = true
}

variable "realtime_valkey_channel" {
  description = "QA realtime Pub/Sub channel."
  type        = string
  default     = "mangorts:realtime:v1"
}

variable "realtime_valkey_major_engine_version" {
  description = "QA Valkey major engine version."
  type        = string
  default     = "7"
}

variable "realtime_valkey_max_data_storage_gb" {
  description = "Maximum QA Valkey serverless storage."
  type        = number
  default     = 1
}

variable "realtime_valkey_max_ecpu_per_second" {
  description = "Maximum QA Valkey serverless ECPUs per second."
  type        = number
  default     = 1000
}

variable "realtime_valkey_alarm_action_arns" {
  description = "Optional QA Valkey alarm destinations."
  type        = list(string)
  default     = []
}

variable "attachment_s3_bucket" {
  description = "Optional globally unique QA attachment bucket name; empty derives one from the AWS account ID."
  type        = string
  default     = ""
}

variable "attachment_direct_upload_enabled" {
  description = "Enable QA browser-to-S3 attachment uploads."
  type        = bool
  default     = true
}

variable "attachment_max_browser_upload_bytes" {
  description = "Maximum size for one QA browser-originated attachment."
  type        = number
  default     = 1073741824
}

variable "attachment_upload_intent_ttl_seconds" {
  description = "QA browser upload-intent lifetime."
  type        = number
  default     = 86400
}

variable "attachment_single_put_url_ttl_seconds" {
  description = "QA single-PUT presigned URL lifetime."
  type        = number
  default     = 3600
}

variable "attachment_multipart_part_url_ttl_seconds" {
  description = "QA multipart-part presigned URL lifetime."
  type        = number
  default     = 900
}

variable "attachment_multipart_abort_days" {
  description = "Days before incomplete QA multipart uploads are aborted."
  type        = number
  default     = 1
}

variable "default_company_id" {
  description = "Fresh QA company UUID used by the frontend build."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.default_company_id))
    error_message = "default_company_id must be a UUID."
  }
}

variable "email_from_address" {
  description = "Verified QA SES sender. Empty disables backend-sent invitation email."
  type        = string
  default     = ""
}

variable "bootstrap_admin_emails" {
  description = "Temporary QA bootstrap admin email allowlist; clear after the first admin signs in."
  type        = string
  default     = ""
}

variable "bootstrap_company_name" {
  description = "Company name created for the first QA bootstrap admin."
  type        = string
  default     = "Mango QA"
}

variable "nylas_client_id" {
  description = "Separate QA Nylas application/client ID. Empty disables Nylas."
  type        = string
  default     = ""
}

variable "nylas_api_base_url" {
  description = "Nylas API region used by the QA application."
  type        = string
  default     = "https://api.us.nylas.com"

  validation {
    condition     = contains(["https://api.us.nylas.com", "https://api.eu.nylas.com"], var.nylas_api_base_url)
    error_message = "nylas_api_base_url must be the Nylas US or EU API URL."
  }
}

variable "nylas_api_key_secret_arn" {
  description = "Secrets Manager ARN containing the separate QA Nylas API key."
  type        = string
  default     = ""
}

variable "nylas_state_secret_arn" {
  description = "Secrets Manager ARN containing the QA OAuth-state secret."
  type        = string
  default     = ""
}

variable "nylas_webhook_secret_arn" {
  description = "Secrets Manager ARN containing the QA Nylas webhook secret."
  type        = string
  default     = ""
}

variable "nylas_google_scopes" {
  description = "Google scopes requested through the QA Nylas app."
  type        = string
  default     = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.labels"
}

variable "nylas_microsoft_scopes" {
  description = "Microsoft scopes requested through the QA Nylas app."
  type        = string
  default     = "offline_access User.Read Mail.ReadWrite Mail.Send"
}

variable "origin_verify_secret" {
  description = "QA-only secret material for CloudFront-to-ALB origin verification."
  type        = string
  sensitive   = true
}

variable "cloudwatch_log_retention_days" {
  description = "Short QA ECS log retention."
  type        = number
  default     = 7
}

variable "ecs_container_insights_enabled" {
  description = "Enable ECS Container Insights for production-shaped QA task and service metrics."
  type        = bool
  default     = true
}

variable "cloudwatch_alarms_enabled" {
  description = "Create the full QA email and Valkey alarm set."
  type        = bool
  default     = true
}

variable "waf_enabled" {
  description = "Attach a separate QA WAF web ACL to CloudFront using the production-shaped application and managed-rule policy."
  type        = bool
  default     = true
}

variable "github_owner" {
  description = "GitHub owner or organization allowed to deploy QA."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository allowed to deploy QA."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "Existing account-level GitHub Actions OIDC provider ARN reused by QA."
  type        = string
}

variable "extra_tags" {
  description = "Additional QA resource tags."
  type        = map(string)
  default     = {}
}
