output "app_url" {
  description = "MangoRTS prod frontend URL."
  value       = module.platform.app_url
}

output "api_url" {
  description = "MangoRTS prod API URL."
  value       = module.platform.api_url
}

output "nylas_callback_url" {
  description = "Nylas Hosted OAuth callback URL to register in the Nylas dashboard."
  value       = module.platform.nylas_callback_url
}

output "nylas_webhook_url" {
  description = "Nylas webhook destination URL for Communications realtime updates."
  value       = module.platform.nylas_webhook_url
}

output "nylas_frontend_redirect_url" {
  description = "Frontend URL the backend redirects to after a successful Nylas OAuth callback."
  value       = module.platform.nylas_frontend_redirect_url
}

output "frontend_bucket" {
  description = "Private S3 bucket for frontend build artifacts."
  value       = module.platform.frontend_bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for frontend/API invalidations."
  value       = module.platform.cloudfront_distribution_id
}

output "backend_ecr_repository_url" {
  description = "Backend ECR repository URL."
  value       = module.platform.backend_ecr_repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.platform.ecs_cluster_name
}

output "ecs_service_name" {
  description = "Backend ECS service name."
  value       = module.platform.ecs_service_name
}

output "ecs_subnet_ids" {
  description = "Private subnet IDs used by ECS tasks."
  value       = module.platform.ecs_subnet_ids
}

output "managed_nat_gateway_ids" {
  description = "NAT gateways created for managed ECS private subnets."
  value       = module.platform.managed_nat_gateway_ids
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID."
  value       = module.platform.cognito_user_pool_id
}

output "cognito_spa_client_id" {
  description = "Cognito SPA app client ID."
  value       = module.platform.cognito_spa_client_id
}

output "cognito_region" {
  description = "Cognito User Pool region for custom frontend auth."
  value       = module.platform.cognito_region
}

output "cognito_issuer" {
  description = "Cognito JWT issuer URL."
  value       = module.platform.cognito_issuer
}

output "default_company_id" {
  description = "Default company ID for frontend builds."
  value       = module.platform.default_company_id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC prod deploys."
  value       = module.platform.github_deploy_role_arn
}
