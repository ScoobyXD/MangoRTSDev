locals {
  name_prefix = "${var.project_name}-${var.environment}"
  root_domain = trimsuffix(var.root_domain_name, ".")
  app_domain  = "${var.app_subdomain}.${local.root_domain}"
  api_domain  = "${var.api_subdomain}.${local.root_domain}"
  origin_host = "${var.origin_subdomain}.${local.root_domain}"

  basic_auth_header = "Basic ${base64encode("${var.dev_basic_auth_username}:${var.dev_basic_auth_password}")}"

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
