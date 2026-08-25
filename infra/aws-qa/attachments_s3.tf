resource "aws_s3_bucket" "attachments" {
  bucket = local.attachment_bucket_name

  tags = merge(local.tags, {
    Name = local.attachment_bucket_name
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
