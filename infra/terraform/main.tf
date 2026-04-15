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
  db_host     = var.create_aurora ? aws_rds_cluster.aurora[0].endpoint : var.existing_db_host
  db_port     = var.create_aurora ? 5432 : var.existing_db_port
  db_name     = var.create_aurora ? var.aurora_database_name : var.existing_db_name
  db_user     = var.create_aurora ? var.aurora_master_username : var.existing_db_user
  db_password_secret_arn = var.create_aurora ? aws_secretsmanager_secret_version.aurora_password[0].arn : var.existing_db_password_secret_arn
}
