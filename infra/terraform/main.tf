terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        project     = var.project_name
        environment = var.environment
        managed_by  = "terraform"
      },
      var.extra_tags
    )
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}
