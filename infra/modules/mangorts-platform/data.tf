data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_route53_zone" "root" {
  name         = "${local.root_domain}."
  private_zone = false
}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}
