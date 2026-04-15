resource "aws_ecr_repository" "case_api" {
  name                 = "${local.name_prefix}-case-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "search_api" {
  name                 = "${local.name_prefix}-search-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}
