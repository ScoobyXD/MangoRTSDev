module "platform" {
  source = "../modules/mangorts-platform"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  aws_region   = var.aws_region
  project_name = var.project_name
  environment  = var.environment
  stack_name   = "aws-dev"

  root_domain_name = var.root_domain_name
  app_subdomain    = var.app_subdomain
  api_subdomain    = var.api_subdomain
  origin_subdomain = var.origin_subdomain

  vpc_id                     = var.vpc_id
  public_subnet_ids          = var.public_subnet_ids
  private_subnet_ids         = var.private_subnet_ids
  create_private_ecs_subnets = var.create_private_ecs_subnets
  ecs_private_subnet_cidrs   = var.ecs_private_subnet_cidrs
  ecs_nat_gateway_mode       = var.ecs_nat_gateway_mode

  database_connection_mode = var.database_connection_mode

  existing_db_host                = var.existing_db_host
  existing_db_port                = var.existing_db_port
  existing_db_name                = var.existing_db_name
  existing_db_user                = var.existing_db_user
  existing_db_password_secret_arn = var.existing_db_password_secret_arn
  existing_db_security_group_id   = var.existing_db_security_group_id

  managed_db_host                = var.managed_db_host
  managed_db_port                = var.managed_db_port
  managed_db_name                = var.managed_db_name
  managed_db_user                = var.managed_db_user
  managed_db_password_secret_arn = var.managed_db_password_secret_arn
  managed_db_security_group_id   = var.managed_db_security_group_id

  backend_image_uri     = var.backend_image_uri
  deploy_revision       = var.deploy_revision
  container_port        = var.container_port
  backend_cpu           = var.backend_cpu
  backend_memory        = var.backend_memory
  backend_desired_count = var.backend_desired_count

  default_company_id     = local.effective_default_company_id
  email_from_address     = var.email_from_address
  bootstrap_admin_emails = local.effective_bootstrap_admin_emails
  bootstrap_company_name = local.effective_bootstrap_company_name
  origin_verify_secret   = local.effective_origin_verify_secret

  nylas_client_id          = var.nylas_client_id
  nylas_api_base_url       = var.nylas_api_base_url
  nylas_api_key_secret_arn = var.nylas_api_key_secret_arn
  nylas_state_secret_arn   = var.nylas_state_secret_arn
  nylas_webhook_secret_arn = var.nylas_webhook_secret_arn
  nylas_google_scopes      = var.nylas_google_scopes
  nylas_microsoft_scopes   = var.nylas_microsoft_scopes

  github_owner                = var.github_owner
  github_repository           = var.github_repository
  github_branch               = var.github_branch
  github_oidc_subjects        = var.github_oidc_subjects
  create_github_oidc_provider = local.effective_create_github_oidc
  github_oidc_provider_arn    = local.effective_github_oidc_provider_arn

  extra_tags = var.extra_tags
}
