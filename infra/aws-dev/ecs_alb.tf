resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name_prefix}/backend"
  retention_in_days = 14
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
    value = "enabled"
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
          { name = "APP_ENV", value = "staging" },
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
          { name = "DB_HOST", value = var.existing_db_host },
          { name = "DB_PORT", value = tostring(var.existing_db_port) },
          { name = "DB_NAME", value = var.existing_db_name },
          { name = "DB_USER", value = var.existing_db_user },
          { name = "DB_SSLMODE", value = "require" }
        ],
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
          { name = "DB_PASSWORD", valueFrom = var.existing_db_password_secret_arn }
        ],
        local.nylas_enabled ? [
          { name = "NYLAS_API_KEY", valueFrom = var.nylas_api_key_secret_arn },
          { name = "NYLAS_STATE_SECRET", valueFrom = var.nylas_state_secret_arn }
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
}

resource "aws_ecs_service" "backend" {
  count = local.backend_service_enabled ? 1 : 0

  name            = "${local.name_prefix}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend[0].arn
  desired_count   = var.backend_desired_count
  launch_type     = "FARGATE"

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

  depends_on = [aws_lb_listener_rule.cloudfront_to_backend]
}
