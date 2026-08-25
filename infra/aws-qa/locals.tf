data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  project_name           = "mangorts"
  environment            = "qa"
  root_domain_name       = "mangorts.com"
  app_subdomain          = "qa"
  api_subdomain          = "api.qa"
  origin_subdomain       = "origin.qa"
  terraform_state_key    = "mangorts/qa/terraform.tfstate"
  name_prefix            = "${local.project_name}-${local.environment}"
  attachment_bucket_name = trimspace(var.attachment_s3_bucket) != "" ? trimspace(var.attachment_s3_bucket) : "${local.name_prefix}-attachments-${data.aws_caller_identity.current.account_id}"
  nylas_core_configured_count = length(compact([
    trimspace(var.nylas_client_id),
    trimspace(var.nylas_api_key_secret_arn),
    trimspace(var.nylas_state_secret_arn)
  ]))

  tags = merge(
    {
      project     = local.project_name
      environment = local.environment
      managed_by  = "terraform"
      stack       = "aws-qa"
    },
    var.extra_tags
  )
}
