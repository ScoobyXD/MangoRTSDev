locals {
  name_prefix = "${var.project_name}-${var.environment}"
  root_domain = trimsuffix(var.root_domain_name, ".")
  app_domain  = "${var.app_subdomain}.${local.root_domain}"
  api_domain  = "${var.api_subdomain}.${local.root_domain}"
  origin_host = "${var.origin_subdomain}.${local.root_domain}"

  basic_auth_header = "Basic ${base64encode("${var.dev_basic_auth_username}:${var.dev_basic_auth_password}")}"

  backend_service_enabled    = trimspace(var.backend_image_uri) != ""
  origin_verify_header_name  = "x-mangorts-origin-verify"
  origin_verify_header_value = sha256("${local.name_prefix}:${var.dev_basic_auth_password}")

  managed_ecs_private_subnet_count = var.create_private_ecs_subnets ? length(var.ecs_private_subnet_cidrs) : 0
  managed_nat_gateway_count        = var.create_private_ecs_subnets ? (var.ecs_nat_gateway_mode == "per_az" ? local.managed_ecs_private_subnet_count : 1) : 0
  ecs_subnet_ids                   = var.create_private_ecs_subnets ? aws_subnet.ecs_private[*].id : var.private_subnet_ids

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
