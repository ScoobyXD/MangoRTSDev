resource "aws_cloudwatch_log_group" "case_api" {
  name              = "/ecs/${local.name_prefix}/case-api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/ecs/${local.name_prefix}/search-api"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "ecs-tasks.amazonaws.com" },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task_role" {
  name = "${local.name_prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "ecs-tasks.amazonaws.com" },
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "ecs_app_policy" {
  name = "${local.name_prefix}-ecs-app-policy"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ],
        Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
      },
      {
        Effect = "Allow",
        Action = [
          "s3:ListBucket"
        ],
        Resource = [aws_s3_bucket.artifacts.arn]
      },
      {
        Effect = "Allow",
        Action = [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ],
        Resource = [
          aws_sqs_queue.search_index_updates.arn,
          aws_sqs_queue.search_index_dlq.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_app_policy_attach" {
  role       = aws_iam_role.ecs_task_role.name
  policy_arn = aws_iam_policy.ecs_app_policy.arn
}

resource "aws_lb" "api" {
  name               = "${local.name_prefix}-api"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for subnet in values(aws_subnet.public) : subnet.id]
}

resource "aws_lb_target_group" "case_api" {
  name        = substr("${local.name_prefix}-case-api", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/healthz"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_lb_target_group" "search_api" {
  name        = substr("${local.name_prefix}-search-api", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    path                = "/healthz"
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.case_api.arn
  }
}

resource "aws_lb_listener_rule" "search_api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.search_api.arn
  }

  condition {
    path_pattern {
      values = ["/search*", "/v1/search*"]
    }
  }
}

resource "aws_ecs_task_definition" "case_api" {
  family                   = "${local.name_prefix}-case-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.case_api_cpu
  memory                   = var.case_api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "case-api"
      image     = var.case_api_image
      essential = true
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
      }]
      environment = [
        { name = "MIRAEOPUS_ADDR", value = ":${var.container_port}" },
        { name = "DB_HOST", value = aws_rds_cluster.aurora.endpoint },
        { name = "DB_NAME", value = var.aurora_database_name },
        { name = "DB_USER", value = var.aurora_master_username },
        { name = "ARTIFACTS_BUCKET", value = aws_s3_bucket.artifacts.bucket },
        { name = "SEARCH_INDEX_QUEUE_URL", value = aws_sqs_queue.search_index_updates.id }
      ]
      secrets = [
        { name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret_version.aurora_password.arn }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.case_api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "search_api" {
  family                   = "${local.name_prefix}-search-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.search_api_cpu
  memory                   = var.search_api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "search-api"
      image     = var.search_api_image
      essential = true
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
      }]
      environment = [
        { name = "MIRAEOPUS_ADDR", value = ":${var.container_port}" },
        { name = "DB_HOST", value = aws_rds_cluster.aurora.endpoint },
        { name = "DB_NAME", value = var.aurora_database_name },
        { name = "DB_USER", value = var.aurora_master_username },
        { name = "SEARCH_INDEX_QUEUE_URL", value = aws_sqs_queue.search_index_updates.id }
      ]
      secrets = [
        { name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret_version.aurora_password.arn }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.search_api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "case_api" {
  name            = "${local.name_prefix}-case-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.case_api.arn
  desired_count   = var.case_api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for subnet in values(aws_subnet.private) : subnet.id]
    security_groups  = [aws_security_group.ecs_services.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.case_api.arn
    container_name   = "case-api"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "search_api" {
  name            = "${local.name_prefix}-search-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.search_api.arn
  desired_count   = var.search_api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for subnet in values(aws_subnet.private) : subnet.id]
    security_groups  = [aws_security_group.ecs_services.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.search_api.arn
    container_name   = "search-api"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_secretsmanager_secret" "aurora_password" {
  name = "${local.name_prefix}/aurora/master-password"
}

resource "aws_secretsmanager_secret_version" "aurora_password" {
  secret_id     = aws_secretsmanager_secret.aurora_password.id
  secret_string = var.aurora_master_password
}
