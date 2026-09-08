resource "aws_ecr_repository" "backend" {
  name                 = "${local.name_prefix}-backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    # Higher-priority tag matching keeps current QA recovery images out of
    # ordinary count-50 expiry. The coordinator removes obsolete hold tags.
    rules = concat(var.environment == "qa" ? [
      {
        rulePriority = 1
        description  = "Protect current QA recovery images from ordinary image expiry"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["qa-recovery-"]
          countType     = "imageCountMoreThan"
          countNumber   = 100
        }
        action = { type = "expire" }
      }
      ] : [], [
      {
        rulePriority = var.environment == "qa" ? 2 : 1
        description  = "Keep the most recent 50 backend images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 50
        }
        action = { type = "expire" }
      }
    ])
  })
}
