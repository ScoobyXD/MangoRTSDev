module "platform" {
  source = "../modules/mangorts-platform"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  aws_region   = var.aws_region
  project_name = local.project_name
  environment  = local.environment
  stack_name   = "aws-qa"

  root_domain_name = local.root_domain_name
  route53_zone_id  = aws_route53_zone.qa.zone_id
  app_subdomain    = local.app_subdomain
  api_subdomain    = local.api_subdomain
  origin_subdomain = local.origin_subdomain

  vpc_id                     = var.vpc_id
  public_subnet_ids          = var.public_subnet_ids
  private_subnet_ids         = var.private_subnet_ids
  create_private_ecs_subnets = false

  database_connection_mode = "managed"

  managed_db_host                     = aws_db_instance.qa.address
  managed_db_port                     = aws_db_instance.qa.port
  managed_db_name                     = var.database_name
  managed_db_user                     = var.database_user
  managed_db_password_secret_arn      = aws_db_instance.qa.master_user_secret[0].secret_arn
  managed_db_password_secret_json_key = "password"
  managed_db_security_group_id        = aws_security_group.database.id

  backend_image_uri     = var.backend_image_uri
  deploy_revision       = var.deploy_revision
  backend_cpu           = var.backend_cpu
  backend_memory        = var.backend_memory
  backend_desired_count = var.backend_desired_count

  cloudwatch_log_retention_days  = var.cloudwatch_log_retention_days
  ecs_container_insights_enabled = var.ecs_container_insights_enabled
  cloudwatch_alarms_enabled      = var.cloudwatch_alarms_enabled
  waf_enabled                    = var.waf_enabled

  email_sqs_enabled                     = true
  email_worker_enabled                  = var.email_worker_enabled
  email_sqs_database_migration_complete = var.email_sqs_database_migration_complete
  email_reconciliation_schedule_enabled = var.email_reconciliation_schedule_enabled
  email_worker_concurrency              = var.email_worker_concurrency
  email_worker_cpu                      = var.email_worker_cpu
  email_worker_memory                   = var.email_worker_memory
  email_worker_alarm_action_arns        = var.email_worker_alarm_action_arns

  realtime_valkey_enabled                   = var.realtime_valkey_enabled
  realtime_valkey_channel                   = var.realtime_valkey_channel
  realtime_valkey_major_engine_version      = var.realtime_valkey_major_engine_version
  realtime_valkey_max_data_storage_gb       = var.realtime_valkey_max_data_storage_gb
  realtime_valkey_max_ecpu_per_second       = var.realtime_valkey_max_ecpu_per_second
  realtime_valkey_alarm_action_arns         = var.realtime_valkey_alarm_action_arns
  attachment_s3_bucket                      = local.attachment_bucket_name
  attachment_direct_upload_enabled          = var.attachment_direct_upload_enabled
  attachment_max_browser_upload_bytes       = var.attachment_max_browser_upload_bytes
  attachment_upload_intent_ttl_seconds      = var.attachment_upload_intent_ttl_seconds
  attachment_single_put_url_ttl_seconds     = var.attachment_single_put_url_ttl_seconds
  attachment_multipart_part_url_ttl_seconds = var.attachment_multipart_part_url_ttl_seconds
  attachment_multipart_abort_days           = var.attachment_multipart_abort_days

  default_company_id     = var.default_company_id
  email_from_address     = var.email_from_address
  bootstrap_admin_emails = var.bootstrap_admin_emails
  bootstrap_company_name = var.bootstrap_company_name
  origin_verify_secret   = var.origin_verify_secret

  nylas_client_id             = var.nylas_client_id
  nylas_api_base_url          = var.nylas_api_base_url
  nylas_api_key_secret_arn    = var.nylas_api_key_secret_arn
  nylas_state_secret_arn      = var.nylas_state_secret_arn
  nylas_webhook_secret_arn    = var.nylas_webhook_secret_arn
  nylas_google_scopes         = var.nylas_google_scopes
  nylas_microsoft_scopes      = var.nylas_microsoft_scopes
  github_owner                = var.github_owner
  github_repository           = var.github_repository
  github_oidc_subjects        = ["repo:${var.github_owner}/${var.github_repository}:environment:qa"]
  create_github_oidc_provider = false
  github_oidc_provider_arn    = var.github_oidc_provider_arn

  extra_tags = var.extra_tags

  depends_on = [
    aws_cloudwatch_log_group.ecs_container_insights_performance,
    aws_s3_bucket.attachments,
  ]
}
