resource "aws_s3_bucket" "frontend" {
  bucket = "${local.name_prefix}-frontend-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-frontend"
  description                       = "MangoRTS ${var.environment} frontend S3 origin access"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "basic_auth" {
  name    = "${local.name_prefix}-basic-auth"
  runtime = "cloudfront-js-1.0"
  comment = "MangoRTS frontend route rewrite; legacy function name avoids CloudFront replacement ordering issues"
  publish = true
  code    = <<-JS
function handler(event) {
  var request = event.request;
  if (isFrontendRoute(request.uri)) {
    request.uri = "/index.html";
  }
  return request;
}

function isFrontendRoute(uri) {
  if (uri === "/") {
    return true;
  }
  if (uri.indexOf("/v1/") === 0 || uri.indexOf("/v2/") === 0 || uri.indexOf("/nylas/") === 0 || uri === "/healthz") {
    return false;
  }
  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  return lastSegment.indexOf(".") === -1;
}
JS
}

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  comment             = "MangoRTS ${var.environment} app and API edge"
  default_root_object = "index.html"
  aliases             = [local.app_domain, local.api_domain]
  price_class         = "PriceClass_100"
  web_acl_id          = var.waf_enabled ? aws_wafv2_web_acl.cloudfront[0].arn : null

  origin {
    origin_id                = "frontend-s3"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id   = "backend-alb"
    domain_name = local.origin_host

    custom_header {
      name  = local.origin_verify_header_name
      value = local.origin_verify_header_value
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "frontend-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.cloudfront_caching_optimized_policy_id
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/v1/*"
    target_origin_id         = "backend-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = local.cloudfront_caching_disabled_policy_id
    origin_request_policy_id = local.cloudfront_all_viewer_except_host_policy_id
    compress                 = true

  }

  ordered_cache_behavior {
    path_pattern             = "/v2/*"
    target_origin_id         = "backend-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = local.cloudfront_caching_disabled_policy_id
    origin_request_policy_id = local.cloudfront_all_viewer_except_host_policy_id
    compress                 = true

  }

  ordered_cache_behavior {
    path_pattern             = "/nylas/oauth/*"
    target_origin_id         = "backend-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = local.cloudfront_caching_disabled_policy_id
    origin_request_policy_id = local.cloudfront_all_viewer_except_host_policy_id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern             = "/nylas/webhook"
    target_origin_id         = "backend-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = local.cloudfront_caching_disabled_policy_id
    origin_request_policy_id = local.cloudfront_all_viewer_except_host_policy_id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern             = "/healthz"
    target_origin_id         = "backend-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cloudfront_caching_disabled_policy_id
    origin_request_policy_id = local.cloudfront_all_viewer_except_host_policy_id
    compress                 = true

  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }


  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cloudfront.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  depends_on = [aws_route53_record.origin]

  lifecycle {
    precondition {
      condition     = local.effective_origin_verify_secret != ""
      error_message = "Set origin_verify_secret."
    }
  }
}

data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json
}
