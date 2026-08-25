resource "aws_route53_zone" "qa" {
  name = "${local.app_subdomain}.${local.root_domain_name}"

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-public-dns"
  })

  lifecycle {
    prevent_destroy = true
  }
}
