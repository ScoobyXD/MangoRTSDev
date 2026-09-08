# Terraform owns the original database. A PITR recovery creates a separately
# tagged coordinator-owned instance and changes only this nonsecret pointer.
# Ignoring its value prevents a later foundation apply from undoing recovery.
resource "aws_ssm_parameter" "active_database" {
  name            = "/mangorts/qa/active-database-identifier"
  description     = "QA RDS instance currently selected by the release coordinator."
  type            = "String"
  insecure_value  = aws_db_instance.qa.identifier
  allowed_pattern = "^mangorts-qa-(postgres|recovery-[a-z0-9-]+)$"
  tags            = local.tags

  lifecycle {
    ignore_changes  = [insecure_value]
    prevent_destroy = true
  }
}

resource "aws_ssm_parameter" "attachment_versioning_ready" {
  name           = "/mangorts/qa/attachment-versioning-ready-at"
  description    = "First safe QA attachment recovery boundary after S3 versioning propagation."
  type           = "String"
  insecure_value = timeadd(timestamp(), "15m")
  tags           = local.tags
  depends_on     = [aws_s3_bucket_versioning.attachments]

  lifecycle {
    ignore_changes  = [insecure_value]
    prevent_destroy = true
  }
}

# This data source must be read on every plan, including app plans using
# -refresh=false. A cached resource value must never reconnect a failed DB.
data "aws_ssm_parameter" "active_database" {
  name            = aws_ssm_parameter.active_database.name
  with_decryption = false
}

data "aws_db_instance" "active" {
  db_instance_identifier = nonsensitive(data.aws_ssm_parameter.active_database.value)

  lifecycle {
    postcondition {
      condition = (
        self.engine == "postgres" &&
        startswith(self.engine_version, "17.") &&
        !self.publicly_accessible &&
        self.db_subnet_group == aws_db_subnet_group.qa.name &&
        toset(self.vpc_security_groups) == toset([aws_security_group.database.id])
      )
      error_message = "The selected QA recovery database must remain PostgreSQL 17 in the exact private QA subnet and security groups."
    }
  }
}

output "qa_release" {
  description = "Nonsecret exact AWS targets for the approved QA release coordinator."
  value = {
    account_id                  = data.aws_caller_identity.current.account_id
    region                      = var.aws_region
    cluster                     = module.platform.ecs_cluster_name
    backend_service             = module.platform.ecs_service_name
    email_worker_service        = module.platform.email_worker_service_name
    desired_backend_count       = var.backend_desired_count
    email_worker_enabled        = var.email_worker_enabled
    subnets                     = module.platform.ecs_subnet_ids
    security_group              = module.platform.ecs_security_group_id
    task_role_arn               = module.platform.ecs_task_role_arn
    attachment_writer_role_arns = module.platform.attachment_writer_role_arns
    backend_task_definition     = module.platform.backend_task_definition_arn
    migration_task_definition   = try(aws_ecs_task_definition.database_migration[0].arn, "")
    attachment_maintenance      = module.platform.attachment_maintenance
    attachment_events_role_name = "${local.name_prefix}-attachment-maintenance-events"
    attachment_events_role_arn  = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-attachment-maintenance-events"
    email_reconciliation        = module.platform.email_reconciliation
    maintenance_rule_arn        = module.platform.qa_release_maintenance.gate_rule_arn
    probe_rule_arn              = module.platform.qa_release_maintenance.probe_rule_arn
    backend_target_group_arn    = module.platform.qa_release_maintenance.target_group_arn
    listener_arn                = module.platform.qa_release_maintenance.listener_arn
    database = {
      identifier            = data.aws_db_instance.active.db_instance_identifier
      host                  = data.aws_db_instance.active.address
      port                  = data.aws_db_instance.active.port
      name                  = var.database_name
      user                  = var.database_user
      password_secret_arn   = var.database_managed_password_bootstrap ? aws_db_instance.qa.master_user_secret[0].secret_arn : trimspace(var.database_password_secret_arn)
      subnet_group          = aws_db_subnet_group.qa.name
      security_group        = aws_security_group.database.id
      backup_retention_days = var.database_backup_retention_days
    }
    frontend_bucket                       = module.platform.frontend_bucket
    cloudfront_distribution_id            = module.platform.cloudfront_distribution_id
    attachment_bucket                     = aws_s3_bucket.attachments.id
    attachment_version_retention_days     = var.database_backup_retention_days + 1
    release_bucket                        = var.terraform_state_bucket_name
    release_prefix                        = "mangorts/qa/releases/"
    release_retention_days                = var.database_backup_retention_days + 1
    active_database_parameter             = aws_ssm_parameter.active_database.name
    attachment_versioning_ready_parameter = aws_ssm_parameter.attachment_versioning_ready.name
    release_terraform_targets = [
      "module.platform.aws_ecr_lifecycle_policy.backend",
      "aws_ecs_task_definition.database_migration",
      "module.platform.aws_ecs_task_definition.backend",
      "module.platform.aws_ecs_task_definition.email_worker",
      "module.platform.aws_ecs_task_definition.attachment_maintenance",
      "module.platform.aws_ecs_service.backend",
      "module.platform.aws_ecs_service.email_worker",
      "module.platform.aws_lb_listener_rule.qa_maintenance",
      "module.platform.aws_lb_listener_rule.qa_release_probe",
      "module.platform.aws_cloudwatch_event_rule.attachment_maintenance",
      "module.platform.aws_cloudwatch_event_rule.attachment_maintenance_failed",
      "module.platform.aws_cloudwatch_event_rule.attachment_maintenance_succeeded",
      "module.platform.aws_cloudwatch_event_target.attachment_maintenance",
      "module.platform.aws_cloudwatch_event_target.attachment_maintenance_failures",
      "module.platform.aws_iam_role_policy.attachment_maintenance_events",
      "module.platform.aws_cloudwatch_metric_alarm.attachment_maintenance_delivery_failed",
      "module.platform.aws_cloudwatch_metric_alarm.attachment_maintenance_failed",
      "module.platform.aws_cloudwatch_metric_alarm.attachment_maintenance_overdue",
      "module.platform.aws_scheduler_schedule.email_reconciliation",
    ]
  }
}
