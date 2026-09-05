output "app_url" {
  description = "MangoRTS frontend URL."
  value       = "https://${local.app_domain}"
}

output "api_url" {
  description = "MangoRTS API URL."
  value       = "https://${local.api_domain}"
}

output "nylas_callback_url" {
  description = "Nylas Hosted OAuth callback URL to register in the Nylas dashboard."
  value       = local.nylas_redirect_uri
}

output "nylas_webhook_url" {
  description = "Nylas webhook destination URL for Communications realtime updates."
  value       = local.nylas_webhook_url
}

output "nylas_frontend_redirect_url" {
  description = "Frontend URL the backend redirects to after a successful Nylas OAuth callback."
  value       = local.nylas_frontend_redirect_url
}

output "frontend_bucket" {
  description = "Private S3 bucket for frontend build artifacts."
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for frontend/API invalidations."
  value       = aws_cloudfront_distribution.app.id
}

output "backend_ecr_repository_url" {
  description = "Backend ECR repository URL."
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Backend ECS service name."
  value       = try(aws_ecs_service.backend[0].name, "")
}

output "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN for environment-owned one-off tasks."
  value       = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  description = "ECS application task role ARN for environment-owned one-off tasks."
  value       = aws_iam_role.ecs_task.arn
}

output "ecs_security_group_id" {
  description = "Private ECS task security group ID."
  value       = aws_security_group.ecs.id
}

output "email_work_queue_url" {
  description = "Non-production FIFO email work queue URL."
  value       = try(aws_sqs_queue.email_work[0].url, "")
}

output "email_work_dlq_url" {
  description = "Non-production FIFO email work DLQ URL for deliberate operator review."
  value       = try(aws_sqs_queue.email_work_dlq[0].url, "")
}

output "email_scheduler_dlq_url" {
  description = "Non-production Standard Scheduler delivery DLQ URL."
  value       = try(aws_sqs_queue.email_scheduler_dlq[0].url, "")
}

output "email_worker_service_name" {
  description = "Private non-production email worker ECS service name when enabled."
  value       = try(aws_ecs_service.email_worker[0].name, "")
}

output "realtime_valkey_cache_name" {
  description = "Non-production ElastiCache Serverless Valkey cache name."
  value       = try(aws_elasticache_serverless_cache.realtime[0].name, "")
}

output "realtime_valkey_endpoint" {
  description = "Private TLS Valkey endpoint used by the environment ECS tasks."
  value       = try("${aws_elasticache_serverless_cache.realtime[0].endpoint[0].address}:${aws_elasticache_serverless_cache.realtime[0].endpoint[0].port}", "")
}

output "realtime_valkey_user_id" {
  description = "IAM-authenticated Valkey user ID used by the development ECS task role."
  value       = try(aws_elasticache_user.realtime[0].user_id, "")
}

output "ecs_subnet_ids" {
  description = "Private subnet IDs used by ECS tasks."
  value       = local.ecs_subnet_ids
}

output "managed_nat_gateway_ids" {
  description = "NAT gateways created for managed ECS private subnets."
  value       = aws_nat_gateway.ecs[*].id
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_spa_client_id" {
  description = "Cognito SPA app client ID."
  value       = aws_cognito_user_pool_client.spa.id
}

output "cognito_region" {
  description = "Cognito User Pool region for custom frontend auth."
  value       = var.aws_region
}

output "cognito_issuer" {
  description = "Cognito JWT issuer URL."
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "default_company_id" {
  description = "Default company ID for frontend builds."
  value       = var.default_company_id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC deploys."
  value       = aws_iam_role.github_deploy.arn
}

output "github_deploy_role_name" {
  description = "IAM role name for environment-owned deploy-policy attachments."
  value       = aws_iam_role.github_deploy.name
}
output "attachment_maintenance" {
  description = "Daily attachment recovery task and failure reporting; null when no non-production attachment backend is configured."
  value = local.attachment_maintenance_enabled ? {
    task_definition_arn = aws_ecs_task_definition.attachment_maintenance[0].arn
    rule_name           = aws_cloudwatch_event_rule.attachment_maintenance[0].name
    failure_log_group   = aws_cloudwatch_log_group.attachment_maintenance_failures[0].name
    alarm_names = [
      aws_cloudwatch_metric_alarm.attachment_maintenance_delivery_failed[0].alarm_name,
      aws_cloudwatch_metric_alarm.attachment_maintenance_failed[0].alarm_name,
      aws_cloudwatch_metric_alarm.attachment_maintenance_overdue[0].alarm_name,
    ]
  } : null
}
