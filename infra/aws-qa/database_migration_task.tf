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

      # A task started without an explicit reviewed override can only inspect.
      # Fresh QA initialization must deliberately override this with:
      # -mode schema -baseline-migrations
      command = ["-mode", "audit"]

      environment = [
        { name = "DB_HOST", value = aws_db_instance.qa.address },
        { name = "DB_PORT", value = tostring(aws_db_instance.qa.port) },
        { name = "DB_NAME", value = var.database_name },
        { name = "DB_USER", value = var.database_user },
        { name = "DB_SSLMODE", value = "require" }
      ]

      secrets = [
        {
          name      = "DB_PASSWORD"
          valueFrom = "${aws_db_instance.qa.master_user_secret[0].secret_arn}:password::"
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
