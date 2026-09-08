# S3 CORS and lifecycle configurations are singleton resources. Before the
# first approved apply against an existing attachment bucket, inventory and
# reconcile/import its complete current configurations; these resources then
# become authoritative for the entire bucket.
resource "aws_s3_bucket_public_access_block" "attachments" {
  count  = local.attachment_storage_enabled ? 1 : 0
  bucket = trimspace(var.attachment_s3_bucket)

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "attachments" {
  count  = local.attachment_storage_enabled ? 1 : 0
  bucket = trimspace(var.attachment_s3_bucket)

  cors_rule {
    allowed_headers = [
      "content-type",
      "x-amz-checksum-sha256",
      "x-amz-server-side-encryption"
    ]
    allowed_methods = ["PUT"]
    allowed_origins = local.attachment_browser_origins
    expose_headers  = ["ETag", "x-amz-checksum-sha256", "x-amz-checksum-type"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "attachments" {
  count  = local.attachment_storage_enabled ? 1 : 0
  bucket = trimspace(var.attachment_s3_bucket)

  rule {
    id     = "abort-incomplete-browser-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = var.attachment_multipart_abort_days
    }
  }

  dynamic "rule" {
    for_each = var.attachment_recovery_retention_days > 0 ? [1] : []

    content {
      id     = "expire-qa-attachment-recovery-versions"
      status = "Enabled"
      filter {}
      noncurrent_version_expiration {
        noncurrent_days = var.attachment_recovery_retention_days
      }
    }
  }
}
