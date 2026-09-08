resource "aws_security_group" "database" {
  name                   = "${local.name_prefix}-postgres"
  description            = "Private MangoRTS QA PostgreSQL access"
  vpc_id                 = var.vpc_id
  revoke_rules_on_delete = true

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-postgres"
  })
}

resource "aws_db_subnet_group" "qa" {
  name       = "${local.name_prefix}-postgres"
  subnet_ids = var.private_subnet_ids

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-postgres"
  })
}

resource "aws_db_instance" "qa" {
  identifier = "${local.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = var.database_engine_version
  instance_class = var.database_instance_class

  allocated_storage     = var.database_allocated_storage_gb
  max_allocated_storage = var.database_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.database_user
  # RDS-managed credentials are an explicit one-time bootstrap mode. Omitting
  # the fixed secret cannot silently turn rotation back on for established QA.
  manage_master_user_password = var.database_managed_password_bootstrap
  port                        = 5432

  db_subnet_group_name   = aws_db_subnet_group.qa.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  apply_immediately           = false

  backup_retention_period  = var.database_backup_retention_days
  copy_tags_to_snapshot    = true
  delete_automated_backups = true
  deletion_protection      = var.database_deletion_protection
  skip_final_snapshot      = true

  performance_insights_enabled = false
  monitoring_interval          = 0

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-postgres"
  })

  lifecycle {
    prevent_destroy = true

    # The human credential transition supplies the hidden password directly to
    # RDS. Terraform must not replay that transition without the password.
    ignore_changes = [manage_master_user_password]

    precondition {
      condition = (
        var.database_managed_password_bootstrap
        ? trimspace(var.database_password_secret_arn) == ""
        : trimspace(var.database_password_secret_arn) != ""
      )
      error_message = "Set database_password_secret_arn for established QA. Use database_managed_password_bootstrap=true with an empty ARN only for initial database creation."
    }

    postcondition {
      condition     = var.database_managed_password_bootstrap || length(self.master_user_secret) == 0
      error_message = "Established QA unexpectedly has an RDS-managed password secret. Stop and restore the fixed customer-managed credential before deploying."
    }

    precondition {
      condition     = length(var.private_subnet_ids) >= 2
      error_message = "QA PostgreSQL requires at least two existing private subnets in the shared VPC."
    }

    precondition {
      condition     = var.database_max_allocated_storage_gb == 0 || var.database_max_allocated_storage_gb >= var.database_allocated_storage_gb
      error_message = "database_max_allocated_storage_gb must be zero or at least database_allocated_storage_gb."
    }
  }
}
