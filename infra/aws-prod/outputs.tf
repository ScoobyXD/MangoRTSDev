output "app_url" {
  description = "Protected MangoRTS prod frontend URL."
  value       = "https://${local.app_domain}"
}

output "api_url" {
  description = "Protected MangoRTS prod API URL."
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

output "default_company_id" {
  description = "Default production company ID for frontend builds."
  value       = var.default_company_id
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC prod deploys."
  value       = aws_iam_role.github_deploy.arn
}

output "db_tunnel_instance_id" {
  description = "Optional human-only SSM DB tunnel EC2 instance ID. Empty when enable_db_tunnel_host is false."
  value       = try(aws_instance.db_tunnel[0].id, "")
}

output "db_tunnel_local_port" {
  description = "Suggested localhost port for DBeaver when the optional SSM DB tunnel is enabled."
  value       = var.enable_db_tunnel_host ? var.db_tunnel_local_port : null
}

output "db_tunnel_start_session_command_powershell" {
  description = "PowerShell command for Jonat's human-admin terminal to start the optional DBeaver tunnel. Empty when enable_db_tunnel_host is false."
  value = var.enable_db_tunnel_host ? format(
    "aws ssm start-session --profile mangorts-prod --region %s --target %s --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=\"%s\",portNumber=\"%s\",localPortNumber=\"%s\"",
    var.aws_region,
    aws_instance.db_tunnel[0].id,
    var.existing_db_host,
    tostring(var.existing_db_port),
    tostring(var.db_tunnel_local_port),
  ) : ""
}
