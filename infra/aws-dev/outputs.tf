output "app_url" {
  description = "Protected MangoRTS dev frontend URL."
  value       = "https://${local.app_domain}"
}

output "api_url" {
  description = "Protected MangoRTS dev API URL."
  value       = "https://${local.api_domain}"
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
  value       = aws_ecs_service.backend.name
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_spa_client_id" {
  description = "Cognito SPA app client ID."
  value       = aws_cognito_user_pool_client.spa.id
}

output "cognito_domain" {
  description = "Cognito managed login domain."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "dev_company_id" {
  description = "Default dev company ID for frontend builds."
  value       = var.dev_company_id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC dev deploys."
  value       = aws_iam_role.github_deploy.arn
}
