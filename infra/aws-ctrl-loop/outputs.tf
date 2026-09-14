output "site_url" {
  value = "https://ctrlloop.io"
}

output "frontend_bucket" {
  value = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "certificate_arn" {
  value = aws_acm_certificate.site.arn
}
