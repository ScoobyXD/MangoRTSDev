data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_ec2_managed_prefix_lists" "cloudfront_origin_facing" {
  filter {
    name   = "prefix-list-name"
    values = ["com.amazonaws.global.cloudfront.origin-facing"]
  }
}
