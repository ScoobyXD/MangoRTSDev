locals {
  effective_default_company_id       = trimspace(var.default_company_id) != "" ? var.default_company_id : var.dev_company_id
  effective_bootstrap_admin_emails   = trimspace(var.bootstrap_admin_emails) != "" ? var.bootstrap_admin_emails : var.bootstrap_dev_admin_emails
  effective_bootstrap_company_name   = trimspace(var.bootstrap_company_name) != "" ? var.bootstrap_company_name : var.bootstrap_dev_company_name
  effective_origin_verify_secret     = trimspace(var.origin_verify_secret) != "" ? var.origin_verify_secret : var.dev_basic_auth_password
  effective_create_github_oidc       = var.create_github_oidc_provider
  effective_github_oidc_provider_arn = var.github_oidc_provider_arn

  tags = merge(
    {
      project     = var.project_name
      environment = var.environment
      managed_by  = "terraform"
      stack       = "aws-dev"
    },
    var.extra_tags
  )
}
