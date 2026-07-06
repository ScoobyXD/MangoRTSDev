locals {
  name_prefix = "${var.project_name}-${var.environment}"
  root_domain = trimsuffix(var.root_domain_name, ".")
  app_domain  = "${var.app_subdomain}.${local.root_domain}"
  api_domain  = "${var.api_subdomain}.${local.root_domain}"
  origin_host = "${var.origin_subdomain}.${local.root_domain}"
  stack_name  = trimspace(var.stack_name) != "" ? var.stack_name : "aws-${var.environment}"

  backend_service_enabled        = trimspace(var.backend_image_uri) != ""
  effective_origin_verify_secret = var.origin_verify_secret
  origin_verify_header_name      = "x-mangorts-origin-verify"
  origin_verify_header_value     = sha256("${local.name_prefix}:${local.effective_origin_verify_secret}")
  nylas_enabled                  = trimspace(var.nylas_client_id) != "" && trimspace(var.nylas_api_key_secret_arn) != "" && trimspace(var.nylas_state_secret_arn) != ""
  nylas_redirect_uri             = "https://${local.api_domain}/nylas/oauth/callback"
  nylas_webhook_url              = "https://${local.api_domain}/nylas/webhook"
  nylas_frontend_redirect_url    = "https://${local.app_domain}/communications"
  nylas_realtime_enabled         = local.nylas_enabled && trimspace(var.nylas_webhook_secret_arn) != ""

  db_host                = var.database_connection_mode == "managed" ? var.managed_db_host : var.existing_db_host
  db_port                = var.database_connection_mode == "managed" ? var.managed_db_port : var.existing_db_port
  db_name                = var.database_connection_mode == "managed" ? var.managed_db_name : var.existing_db_name
  db_user                = var.database_connection_mode == "managed" ? var.managed_db_user : var.existing_db_user
  db_password_secret_arn = var.database_connection_mode == "managed" ? var.managed_db_password_secret_arn : var.existing_db_password_secret_arn
  db_security_group_id   = var.database_connection_mode == "managed" ? var.managed_db_security_group_id : var.existing_db_security_group_id

  managed_ecs_private_subnet_count = var.create_private_ecs_subnets ? length(var.ecs_private_subnet_cidrs) : 0
  managed_nat_gateway_count        = var.create_private_ecs_subnets ? (var.ecs_nat_gateway_mode == "per_az" ? local.managed_ecs_private_subnet_count : 1) : 0
  ecs_subnet_ids                   = var.create_private_ecs_subnets ? aws_subnet.ecs_private[*].id : var.private_subnet_ids
  github_oidc_provider_arn         = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.github_oidc_provider_arn
  github_oidc_subjects             = length(var.github_oidc_subjects) > 0 ? var.github_oidc_subjects : ["repo:${var.github_owner}/${var.github_repository}:ref:refs/heads/${var.github_branch}"]

  tags = merge(
    {
      project     = var.project_name
      environment = var.environment
      managed_by  = "terraform"
      stack       = local.stack_name
    },
    var.extra_tags
  )
}
