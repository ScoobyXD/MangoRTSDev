data "aws_route53_zone" "root" {
  name         = "${trimsuffix(var.root_domain_name, ".")}."
  private_zone = false
}
