output "app_url" {
  description = "MangoRTS QA frontend URL."
  value       = module.platform.app_url
}

output "qa_dns_zone_id" {
  description = "Dev-account public hosted-zone ID dedicated to qa.mangorts.com."
  value       = aws_route53_zone.qa.zone_id
}

output "qa_dns_name_servers" {
  description = "Name servers that the authoritative mangorts.com parent must delegate for qa.mangorts.com."
  value       = aws_route53_zone.qa.name_servers
}

output "api_url" {
  description = "MangoRTS QA API URL."
  value       = module.platform.api_url
}

output "nylas_callback_url" {
  description = "QA Nylas Hosted OAuth callback URL."
  value       = module.platform.nylas_callback_url
}

output "nylas_webhook_url" {
  description = "QA Nylas webhook destination URL."
  value       = module.platform.nylas_webhook_url
}

output "nylas_frontend_redirect_url" {
  description = "QA frontend redirect after Nylas OAuth."
  value       = module.platform.nylas_frontend_redirect_url
}

output "frontend_bucket" {
  description = "Private QA frontend artifact bucket."
  value       = module.platform.frontend_bucket
}

output "attachment_bucket" {
  description = "Private QA attachment bucket."
  value       = aws_s3_bucket.attachments.id
}

output "cloudfront_distribution_id" {
  description = "QA CloudFront distribution ID."
  value       = module.platform.cloudfront_distribution_id
}

output "backend_ecr_repository_url" {
  description = "QA backend ECR repository URL."
  value       = module.platform.backend_ecr_repository_url
}

output "ecs_cluster_name" {
  description = "QA ECS cluster name."
  value       = module.platform.ecs_cluster_name
}

output "ecs_service_name" {
  description = "QA API ECS service name."
  value       = module.platform.ecs_service_name
}

output "ecs_private_subnet_ids" {
  description = "Private subnet IDs for QA one-off ECS tasks."
  value       = module.platform.ecs_subnet_ids
}

output "ecs_security_group_id" {
  description = "Security group for QA one-off ECS tasks."
  value       = module.platform.ecs_security_group_id
}

output "ecs_task_execution_role_arn" {
  description = "QA ECS task execution role ARN."
  value       = module.platform.ecs_task_execution_role_arn
}

output "ecs_task_role_arn" {
  description = "QA ECS application task role ARN."
  value       = module.platform.ecs_task_role_arn
}

output "database_migration_task_definition_arn" {
  description = "Human-triggered QA migration task definition; empty until migration_image_uri is set."
  value       = try(aws_ecs_task_definition.database_migration[0].arn, "")
}

output "database_migration_container_name" {
  description = "Container name used for reviewed one-off migration command overrides."
  value       = "database-migration"
}

output "email_worker_service_name" {
  description = "QA email-worker service name when enabled."
  value       = module.platform.email_worker_service_name
}

output "email_work_queue_url" {
  description = "QA FIFO email work queue URL for exact operator depth checks."
  value       = module.platform.email_work_queue_url
}

output "email_work_dlq_url" {
  description = "QA FIFO email work DLQ URL for exact operator depth checks."
  value       = module.platform.email_work_dlq_url
}

output "email_scheduler_dlq_url" {
  description = "QA Scheduler delivery DLQ URL for exact operator depth checks."
  value       = module.platform.email_scheduler_dlq_url
}

output "realtime_valkey_cache_name" {
  description = "QA-owned Pub/Sub-only Valkey cache name."
  value       = module.platform.realtime_valkey_cache_name
}

output "realtime_valkey_user_id" {
  description = "QA-owned Pub/Sub-only Valkey user ID."
  value       = module.platform.realtime_valkey_user_id
}

output "cognito_user_pool_id" {
  description = "QA Cognito User Pool ID."
  value       = module.platform.cognito_user_pool_id
}

output "cognito_spa_client_id" {
  description = "QA Cognito SPA client ID."
  value       = module.platform.cognito_spa_client_id
}

output "cognito_region" {
  description = "QA Cognito region."
  value       = module.platform.cognito_region
}

output "default_company_id" {
  description = "QA frontend company ID."
  value       = module.platform.default_company_id
}

output "database_endpoint" {
  description = "Private QA PostgreSQL endpoint."
  value       = aws_db_instance.qa.address
}

output "database_instance_identifier" {
  description = "QA RDS instance identifier used by guarded operator scripts."
  value       = aws_db_instance.qa.identifier
}

output "database_name" {
  description = "Fresh QA PostgreSQL database name."
  value       = aws_db_instance.qa.db_name
}

output "database_user" {
  description = "Non-secret QA PostgreSQL username used for exact operator target binding."
  value       = aws_db_instance.qa.username
}

output "database_password_secret_arn" {
  description = "Secrets Manager ARN used by QA PostgreSQL clients. Established QA uses the customer-managed non-rotating secret."
  value       = var.database_managed_password_bootstrap ? aws_db_instance.qa.master_user_secret[0].secret_arn : trimspace(var.database_password_secret_arn)
}

output "database_security_group_id" {
  description = "QA PostgreSQL security group ID."
  value       = aws_security_group.database.id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for QA GitHub Actions deployments."
  value       = module.platform.github_deploy_role_arn
}
output "attachment_maintenance" {
  value = module.platform.attachment_maintenance
}
