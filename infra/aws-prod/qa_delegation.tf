resource "aws_route53_record" "qa_delegation" {
  zone_id         = data.aws_route53_zone.root.zone_id
  name            = "qa.${local.root_domain}"
  type            = "NS"
  ttl             = 300
  allow_overwrite = false

  records = [
    "ns-1059.awsdns-04.org",
    "ns-1735.awsdns-24.co.uk",
    "ns-495.awsdns-61.com",
    "ns-736.awsdns-28.net",
  ]

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = data.aws_caller_identity.current.account_id == "828435022930"
      error_message = "QA DNS delegation may only be managed in the MangoRTS production AWS account."
    }

    precondition {
      condition     = data.aws_route53_zone.root.zone_id == "Z05521211GBNMIH6SBM5Z"
      error_message = "QA DNS delegation may only be managed in the authoritative mangorts.com hosted zone."
    }
  }
}
