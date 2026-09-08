resource "aws_cloudwatch_log_group" "database_migration" {
  name              = "/ecs/${local.name_prefix}/database-migration"
  retention_in_days = var.cloudwatch_log_retention_days
}

resource "aws_ecs_task_definition" "database_migration" {
  count = trimspace(var.migration_image_uri) != "" ? 1 : 0

  family                   = "${local.name_prefix}-database-migration"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = module.platform.ecs_task_execution_role_arn
  tags                     = local.tags
  skip_destroy             = true

  container_definitions = jsonencode([
    {
      name      = "database-migration"
      image     = var.migration_image_uri
      essential = true

      # Starting the task directly is read-only. The approved QA release
      # overrides the command only after maintenance and PITR are verified.
      command = ["-mode", "audit"]

      environment = [
        { name = "DB_HOST", value = data.aws_db_instance.active.address },
        { name = "DB_PORT", value = tostring(data.aws_db_instance.active.port) },
        { name = "DB_NAME", value = var.database_name },
        { name = "DB_USER", value = var.database_user },
        { name = "DB_SSLMODE", value = "require" }
      ]

      secrets = [
        {
          name      = "DB_PASSWORD"
          valueFrom = var.database_managed_password_bootstrap ? "${aws_db_instance.qa.master_user_secret[0].secret_arn}:password::" : trimspace(var.database_password_secret_arn)
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.database_migration.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}
