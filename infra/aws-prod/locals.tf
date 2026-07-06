locals {
  tags = merge(
    {
      project     = var.project_name
      environment = var.environment
      managed_by  = "terraform"
      stack       = "aws-prod"
    },
    var.extra_tags
  )
}
