resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name_prefix}/backend"
  retention_in_days = var.cloudwatch_log_retention_days
}

resource "aws_lb" "api" {
  name               = "${local.name_prefix}-api"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_target_group" "backend" {
  name        = substr("${local.name_prefix}-backend", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/healthz"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "cloudfront_to_backend" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    http_header {
      http_header_name = local.origin_verify_header_name
      values           = [local.origin_verify_header_value]
    }
  }
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = var.ecs_container_insights_enabled ? "enabled" : "disabled"
  }

  lifecycle {
    precondition {
      condition = (
        (trimspace(var.assistant_model) == "" && trimspace(var.openai_api_key_secret_arn) == "") ||
        (var.environment == "dev" && trimspace(var.assistant_model) != "" && trimspace(var.openai_api_key_secret_arn) != "")
      )
      error_message = "Mango chat may be enabled only in dev, with both assistant_model and openai_api_key_secret_arn set."
    }

    precondition {
      condition = !(
        var.email_sqs_enabled &&
        var.backend_desired_count > 0
      ) || var.email_sqs_database_migration_complete
      error_message = "A nonzero SQS-enabled API desired count requires email_sqs_database_migration_complete=true."
    }

    precondition {
      condition = !var.email_worker_enabled || (
        var.email_sqs_enabled &&
        local.backend_service_enabled &&
        local.email_worker_dependencies_configured
      )
      error_message = "Email worker enablement requires SQS, an immutable backend image, the final migrated schema, and complete DB/Nylas/Valkey configuration."
    }

    precondition {
      condition = !var.email_reconciliation_schedule_enabled || (
        var.email_sqs_enabled &&
        var.email_worker_enabled &&
        local.backend_service_enabled &&
        local.email_worker_dependencies_configured
      )
      error_message = "Email reconciliation enablement requires the fully configured worker stage and an immutable backend image."
    }
  }
}

resource "aws_ecs_task_definition" "backend" {
  count = local.backend_service_enabled ? 1 : 0

  family                   = "${local.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.backend_cpu
  memory                   = var.backend_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  tags                     = local.tags
  skip_destroy             = true

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = var.backend_image_uri
      essential = true
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
      }]
      environment = concat(
        [
          { name = "APP_ENV", value = var.environment },
          { name = "ALLOW_INMEMORY_FALLBACK", value = "false" },
          { name = "AUTH_MODE", value = "cognito" },
          { name = "AWS_REGION", value = var.aws_region },
          { name = "COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.main.id },
          { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.spa.id },
          { name = "COGNITO_TOKEN_USE", value = "access,id" },
          { name = "MANGORTS_ADDR", value = ":${var.container_port}" },
          { name = "MANGORTS_ALLOWED_ORIGIN", value = "https://${local.app_domain}" },
          { name = "MANGORTS_DEPLOY_ENV", value = var.environment },
          { name = "MANGORTS_DEPLOY_REVISION", value = var.deploy_revision },
          { name = "MANGORTS_APP_URL", value = "https://${local.app_domain}" },
          { name = "MANGORTS_API_URL", value = "https://${local.api_domain}" },
          { name = "MANGORTS_EMAIL_FROM", value = var.email_from_address },
          { name = "MANGORTS_RUNTIME_ROLE", value = "api" },
          { name = "MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS", value = var.bootstrap_admin_emails },
          { name = "MANGORTS_BOOTSTRAP_DEV_COMPANY_NAME", value = var.bootstrap_company_name },
          { name = "DB_HOST", value = local.db_host },
          { name = "DB_PORT", value = tostring(local.db_port) },
          { name = "DB_NAME", value = local.db_name },
          { name = "DB_USER", value = local.db_user },
          { name = "DB_SSLMODE", value = "require" }
        ],
        local.assistant_enabled ? [
          { name = "MANGORTS_ASSISTANT_MODEL", value = trimspace(var.assistant_model) }
        ] : [],
        var.realtime_valkey_enabled ? [
          { name = "MANGORTS_VALKEY_REQUIRED", value = "true" },
          { name = "MANGORTS_VALKEY_ENDPOINT", value = "${aws_elasticache_serverless_cache.realtime[0].endpoint[0].address}:${aws_elasticache_serverless_cache.realtime[0].endpoint[0].port}" },
          { name = "MANGORTS_VALKEY_REGION", value = var.aws_region },
          { name = "MANGORTS_VALKEY_CACHE_NAME", value = aws_elasticache_serverless_cache.realtime[0].name },
          { name = "MANGORTS_VALKEY_USER_ID", value = aws_elasticache_user.realtime[0].user_id },
          { name = "MANGORTS_VALKEY_CHANNEL", value = var.realtime_valkey_channel }
        ] : [],
        local.attachment_storage_enabled ? concat([
          { name = "MANGORTS_ATTACHMENT_S3_BUCKET", value = trimspace(var.attachment_s3_bucket) },
          { name = "MANGORTS_ATTACHMENT_AWS_REGION", value = var.aws_region },
          { name = "MANGORTS_ATTACHMENT_DIRECT_UPLOAD_ENABLED", value = tostring(var.attachment_direct_upload_enabled) },
          { name = "MANGORTS_ATTACHMENT_MAX_BROWSER_UPLOAD_BYTES", value = tostring(var.attachment_max_browser_upload_bytes) },
          { name = "MANGORTS_ATTACHMENT_UPLOAD_INTENT_TTL_SECONDS", value = tostring(var.attachment_upload_intent_ttl_seconds) },
          { name = "MANGORTS_ATTACHMENT_SINGLE_PUT_URL_TTL_SECONDS", value = tostring(var.attachment_single_put_url_ttl_seconds) },
          { name = "MANGORTS_ATTACHMENT_MULTIPART_PART_URL_TTL_SECONDS", value = tostring(var.attachment_multipart_part_url_ttl_seconds) }
          ], trimspace(var.attachment_s3_presign_endpoint) != "" ? [
          { name = "MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT", value = trimspace(var.attachment_s3_presign_endpoint) }
        ] : []) : [],
        var.email_sqs_enabled ? [
          { name = "MANGORTS_EMAIL_WORK_QUEUE_URL", value = aws_sqs_queue.email_work[0].url }
        ] : [],
        local.nylas_enabled ? [
          { name = "NYLAS_CLIENT_ID", value = var.nylas_client_id },
          { name = "NYLAS_API_BASE_URL", value = var.nylas_api_base_url },
          { name = "NYLAS_REDIRECT_URI", value = local.nylas_redirect_uri },
          { name = "NYLAS_FRONTEND_REDIRECT_URL", value = local.nylas_frontend_redirect_url },
          { name = "NYLAS_GOOGLE_SCOPES", value = var.nylas_google_scopes },
          { name = "NYLAS_MICROSOFT_SCOPES", value = var.nylas_microsoft_scopes }
        ] : []
      )
      secrets = concat(
        [
          { name = "DB_PASSWORD", valueFrom = local.db_password_secret_value_from }
        ],
        local.assistant_enabled ? [
          { name = "OPENAI_API_KEY", valueFrom = trimspace(var.openai_api_key_secret_arn) }
        ] : [],
        local.nylas_enabled ? [
          { name = "NYLAS_API_KEY", valueFrom = var.nylas_api_key_secret_arn },
          { name = "NYLAS_STATE_SECRET", valueFrom = var.nylas_state_secret_arn }
        ] : [],
        local.nylas_realtime_enabled ? [
          { name = "NYLAS_WEBHOOK_SECRET", valueFrom = var.nylas_webhook_secret_arn }
        ] : []
      )
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  depends_on = [
    aws_iam_role_policy_attachment.ecs_execution_secrets,
    aws_iam_role_policy_attachment.ecs_task_email_sqs,
    aws_iam_role_policy_attachment.ecs_task_realtime_valkey,
  ]
}

resource "aws_ecs_service" "backend" {
  count = local.backend_service_enabled ? 1 : 0

  name                  = "${local.name_prefix}-backend"
  cluster               = aws_ecs_cluster.main.id
  task_definition       = aws_ecs_task_definition.backend[0].arn
  desired_count         = var.backend_desired_count
  launch_type           = "FARGATE"
  wait_for_steady_state = true

  network_configuration {
    subnets          = local.ecs_subnet_ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "backend"
    container_port   = var.container_port
  }

  depends_on = [
    aws_lb_listener_rule.cloudfront_to_backend,
    aws_cloudwatch_event_target.attachment_maintenance,
    aws_cloudwatch_event_target.attachment_maintenance_failures,
    aws_cloudwatch_metric_alarm.attachment_maintenance_delivery_failed,
    aws_cloudwatch_metric_alarm.attachment_maintenance_failed,
    aws_cloudwatch_metric_alarm.attachment_maintenance_overdue,
    aws_iam_role_policy_attachment.ecs_task_email_sqs,
    aws_iam_role_policy_attachment.ecs_task_realtime_valkey,
  ]
}
