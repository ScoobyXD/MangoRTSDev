output "app_url" {
  description = "Protected MangoRTS dev frontend URL."
  value       = "https://${local.app_domain}"
}

output "api_url" {
  description = "Protected MangoRTS dev API URL."
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

output "dev_company_id" {
  description = "Default dev company ID for frontend builds."
  value       = var.dev_company_id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC dev deploys."
  value       = aws_iam_role.github_deploy.arn
}
