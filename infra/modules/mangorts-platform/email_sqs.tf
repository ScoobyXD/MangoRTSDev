locals {
  email_work_queue_name      = "${local.name_prefix}-email-work.fifo"
  email_work_dlq_name        = "${local.name_prefix}-email-work-dlq.fifo"
  email_scheduler_dlq_name   = "${local.name_prefix}-email-scheduler-dlq"
  email_schedule_group_name  = "${local.name_prefix}-email-reconciliation"
  email_schedule_name        = "${local.name_prefix}-email-reconciliation"
  email_work_queue_arn       = "arn:${data.aws_partition.current.partition}:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${local.email_work_queue_name}"
  email_work_dlq_arn         = "arn:${data.aws_partition.current.partition}:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${local.email_work_dlq_name}"
  email_scheduler_dlq_arn    = "arn:${data.aws_partition.current.partition}:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${local.email_scheduler_dlq_name}"
  email_schedule_group_arn   = "arn:${data.aws_partition.current.partition}:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule-group/${local.email_schedule_group_name}"
  email_schedule_arn         = "arn:${data.aws_partition.current.partition}:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${local.email_schedule_group_name}/${local.email_schedule_name}"
  email_reconciliation_group = "reconciliation-control"
  email_reconciliation_input = jsonencode({
    schema_version    = 1
    kind              = "reconciliation_control"
    reconciliation_id = "<aws.scheduler.scheduled-time>"
    scan_started_at   = "<aws.scheduler.scheduled-time>"
  })
}

resource "aws_sqs_queue" "email_work_dlq" {
  count = var.email_sqs_enabled ? 1 : 0

  name                        = local.email_work_dlq_name
  fifo_queue                  = true
  content_based_deduplication = true
  sqs_managed_sse_enabled     = true
  message_retention_seconds   = 1209600

  tags = local.tags

  lifecycle {
    precondition {
      condition     = local.nonproduction_services_environment
      error_message = "The SQS email delivery path can be enabled only in dev or qa."
    }
  }

  depends_on = [aws_iam_role_policy_attachment.github_deploy_email_sqs]
}

resource "aws_sqs_queue" "email_work" {
  count = var.email_sqs_enabled ? 1 : 0

  name                        = local.email_work_queue_name
  fifo_queue                  = true
  content_based_deduplication = true
  sqs_managed_sse_enabled     = true
  visibility_timeout_seconds  = 600
  receive_wait_time_seconds   = 20
  message_retention_seconds   = 1209600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.email_work_dlq[0].arn
    maxReceiveCount     = 3
  })

  tags = local.tags
}

resource "aws_sqs_queue_redrive_allow_policy" "email_work_dlq" {
  count = var.email_sqs_enabled ? 1 : 0

  queue_url = aws_sqs_queue.email_work_dlq[0].url
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.email_work[0].arn]
  })
}

resource "aws_sqs_queue" "email_scheduler_dlq" {
  count = var.email_sqs_enabled ? 1 : 0

  name                      = local.email_scheduler_dlq_name
  sqs_managed_sse_enabled   = true
  message_retention_seconds = 1209600

  tags = local.tags

  depends_on = [aws_iam_role_policy_attachment.github_deploy_email_sqs]
}

data "aws_iam_policy_document" "ecs_task_email_sqs" {
  count = var.email_sqs_enabled ? 1 : 0

  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.email_work[0].arn]
  }
}

resource "aws_iam_policy" "ecs_task_email_sqs" {
  count = var.email_sqs_enabled ? 1 : 0

  name   = "${local.name_prefix}-api-email-sqs"
  policy = data.aws_iam_policy_document.ecs_task_email_sqs[0].json
}

resource "aws_iam_role_policy_attachment" "ecs_task_email_sqs" {
  count = var.email_sqs_enabled ? 1 : 0

  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.ecs_task_email_sqs[0].arn
}

data "aws_iam_policy_document" "github_deploy_email_sqs" {
  count = var.environment == "dev" && var.email_sqs_enabled ? 1 : 0

  statement {
    sid = "ManageExactEnvironmentEmailQueues"
    actions = [
      "sqs:CreateQueue",
      "sqs:DeleteQueue",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ListQueueTags",
      "sqs:SetQueueAttributes",
      "sqs:TagQueue",
      "sqs:UntagQueue",
    ]
    resources = [local.email_work_queue_arn, local.email_work_dlq_arn, local.email_scheduler_dlq_arn]
  }

  statement {
    sid       = "ReadQueueNames"
    actions   = ["sqs:ListQueues"]
    resources = ["*"]
  }

  statement {
    sid = "ManageExactEnvironmentEmailSchedule"
    actions = [
      "scheduler:CreateSchedule",
      "scheduler:DeleteSchedule",
      "scheduler:GetSchedule",
      "scheduler:UpdateSchedule",
    ]
    resources = [local.email_schedule_arn]
  }

  statement {
    sid = "ManageExactEnvironmentEmailScheduleGroup"
    actions = [
      "scheduler:CreateScheduleGroup",
      "scheduler:DeleteScheduleGroup",
      "scheduler:GetScheduleGroup",
      "scheduler:ListTagsForResource",
      "scheduler:TagResource",
      "scheduler:UntagResource",
    ]
    resources = [local.email_schedule_group_arn]
  }

  statement {
    sid       = "ReadSchedulerCollections"
    actions   = ["scheduler:ListScheduleGroups", "scheduler:ListSchedules"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "github_deploy_email_sqs" {
  count = var.environment == "dev" && var.email_sqs_enabled ? 1 : 0

  name   = "${local.name_prefix}-github-deploy-email-sqs"
  policy = data.aws_iam_policy_document.github_deploy_email_sqs[0].json
}

resource "aws_iam_role_policy_attachment" "github_deploy_email_sqs" {
  count = var.environment == "dev" && var.email_sqs_enabled ? 1 : 0

  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy_email_sqs[0].arn
}

data "aws_iam_policy_document" "email_worker_sqs" {
  count = var.email_sqs_enabled ? 1 : 0

  statement {
    actions = [
      "sqs:DeleteMessage",
      "sqs:ReceiveMessage",
      "sqs:SendMessage"
    ]
    resources = [aws_sqs_queue.email_work[0].arn]
  }
}

resource "aws_iam_policy" "email_worker_sqs" {
  count = var.email_sqs_enabled ? 1 : 0

  name   = "${local.name_prefix}-email-worker-sqs"
  policy = data.aws_iam_policy_document.email_worker_sqs[0].json
}

resource "aws_iam_role_policy_attachment" "email_worker_sqs" {
  count = var.email_sqs_enabled ? 1 : 0

  role       = aws_iam_role.email_worker[0].name
  policy_arn = aws_iam_policy.email_worker_sqs[0].arn
}

resource "aws_cloudwatch_log_group" "email_worker" {
  count = var.email_sqs_enabled ? 1 : 0

  name              = "/ecs/${local.name_prefix}/email-worker"
  retention_in_days = var.cloudwatch_log_retention_days
}

resource "aws_ecs_task_definition" "email_worker" {
  count = local.email_worker_service_enabled ? 1 : 0

  family                   = "${local.name_prefix}-email-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.email_worker_cpu
  memory                   = var.email_worker_memory
  execution_role_arn       = aws_iam_role.email_worker_execution[0].arn
  task_role_arn            = aws_iam_role.email_worker[0].arn
  tags                     = local.tags
  skip_destroy             = true

  container_definitions = jsonencode([
    {
      name      = "email-worker"
      image     = var.backend_image_uri
      essential = true
      environment = concat(
        [
          { name = "APP_ENV", value = var.environment },
          { name = "ALLOW_INMEMORY_FALLBACK", value = "false" },
          { name = "AUTH_MODE", value = "disabled" },
          { name = "AWS_REGION", value = var.aws_region },
          { name = "MANGORTS_RUNTIME_ROLE", value = "email-worker" },
          { name = "MANGORTS_EMAIL_WORK_QUEUE_URL", value = aws_sqs_queue.email_work[0].url },
          { name = "MANGORTS_EMAIL_WORKER_CONCURRENCY", value = tostring(var.email_worker_concurrency) },
          { name = "MANGORTS_DEPLOY_ENV", value = var.environment },
          { name = "MANGORTS_DEPLOY_REVISION", value = var.deploy_revision },
          { name = "MANGORTS_APP_URL", value = "https://${local.app_domain}" },
          { name = "MANGORTS_API_URL", value = "https://${local.api_domain}" },
          { name = "DB_HOST", value = local.db_host },
          { name = "DB_PORT", value = tostring(local.db_port) },
          { name = "DB_NAME", value = local.db_name },
          { name = "DB_USER", value = local.db_user },
          { name = "DB_SSLMODE", value = "require" }
        ],
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
          { name = "MANGORTS_ATTACHMENT_DIRECT_UPLOAD_ENABLED", value = "false" },
          { name = "MANGORTS_ATTACHMENT_MAX_BROWSER_UPLOAD_BYTES", value = tostring(var.attachment_max_browser_upload_bytes) },
          { name = "MANGORTS_ATTACHMENT_UPLOAD_INTENT_TTL_SECONDS", value = tostring(var.attachment_upload_intent_ttl_seconds) },
          { name = "MANGORTS_ATTACHMENT_SINGLE_PUT_URL_TTL_SECONDS", value = tostring(var.attachment_single_put_url_ttl_seconds) },
          { name = "MANGORTS_ATTACHMENT_MULTIPART_PART_URL_TTL_SECONDS", value = tostring(var.attachment_multipart_part_url_ttl_seconds) }
          ], trimspace(var.attachment_s3_presign_endpoint) != "" ? [
          { name = "MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT", value = trimspace(var.attachment_s3_presign_endpoint) }
        ] : []) : [],
        local.nylas_worker_enabled ? [
          { name = "NYLAS_CLIENT_ID", value = var.nylas_client_id },
          { name = "NYLAS_API_BASE_URL", value = var.nylas_api_base_url }
        ] : []
      )
      secrets = concat(
        [
          { name = "DB_PASSWORD", valueFrom = local.db_password_secret_value_from }
        ],
        local.nylas_worker_enabled ? [
          { name = "NYLAS_API_KEY", valueFrom = var.nylas_api_key_secret_arn }
        ] : []
      )
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.email_worker[0].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  depends_on = [
    aws_iam_role_policy_attachment.email_worker_execution,
    aws_iam_role_policy_attachment.email_worker_execution_secrets,
    aws_iam_role_policy_attachment.email_worker_attachments,
    aws_iam_role_policy_attachment.email_worker_realtime_valkey,
    aws_iam_role_policy_attachment.email_worker_sqs,
  ]

  lifecycle {
    precondition {
      condition     = local.email_worker_dependencies_configured
      error_message = "The email worker requires dev or qa, the final migrated schema, complete DB and Nylas configuration, and external Valkey."
    }
  }
}

resource "aws_ecs_service" "email_worker" {
  count = local.email_worker_service_enabled ? 1 : 0

  name                  = "${local.name_prefix}-email-worker"
  cluster               = aws_ecs_cluster.main.id
  task_definition       = aws_ecs_task_definition.email_worker[0].arn
  desired_count         = 1
  launch_type           = "FARGATE"
  wait_for_steady_state = true

  network_configuration {
    subnets          = local.ecs_subnet_ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  depends_on = [
    aws_iam_role_policy_attachment.email_worker_execution,
    aws_iam_role_policy_attachment.email_worker_execution_secrets,
    aws_iam_role_policy_attachment.email_worker_attachments,
    aws_iam_role_policy_attachment.email_worker_realtime_valkey,
    aws_iam_role_policy_attachment.email_worker_sqs,
  ]
}

resource "aws_scheduler_schedule_group" "email_reconciliation" {
  count = var.email_sqs_enabled ? 1 : 0

  name = local.email_schedule_group_name
  tags = local.tags

  depends_on = [aws_iam_role_policy_attachment.github_deploy_email_sqs]
}

data "aws_iam_policy_document" "email_reconciliation_scheduler_assume" {
  count = var.email_sqs_enabled && var.email_reconciliation_schedule_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values = [
        local.email_schedule_group_arn
      ]
    }
  }
}

resource "aws_iam_role" "email_reconciliation_scheduler" {
  count = var.email_sqs_enabled && var.email_reconciliation_schedule_enabled ? 1 : 0

  name               = "${local.name_prefix}-email-reconciliation-scheduler"
  assume_role_policy = data.aws_iam_policy_document.email_reconciliation_scheduler_assume[0].json
}

data "aws_iam_policy_document" "email_reconciliation_scheduler" {
  count = var.email_sqs_enabled && var.email_reconciliation_schedule_enabled ? 1 : 0

  statement {
    actions = ["sqs:SendMessage"]
    resources = [
      aws_sqs_queue.email_scheduler_dlq[0].arn,
      aws_sqs_queue.email_work[0].arn
    ]
  }
}

resource "aws_iam_policy" "email_reconciliation_scheduler" {
  count = var.email_sqs_enabled && var.email_reconciliation_schedule_enabled ? 1 : 0

  name   = "${local.name_prefix}-email-reconciliation-sqs"
  policy = data.aws_iam_policy_document.email_reconciliation_scheduler[0].json
}

resource "aws_iam_role_policy_attachment" "email_reconciliation_scheduler" {
  count = var.email_sqs_enabled && var.email_reconciliation_schedule_enabled ? 1 : 0

  role       = aws_iam_role.email_reconciliation_scheduler[0].name
  policy_arn = aws_iam_policy.email_reconciliation_scheduler[0].arn
}

resource "aws_scheduler_schedule" "email_reconciliation" {
  count = var.email_sqs_enabled && var.email_reconciliation_schedule_enabled ? 1 : 0

  name                         = local.email_schedule_name
  group_name                   = aws_scheduler_schedule_group.email_reconciliation[0].name
  schedule_expression          = "rate(10 minutes)"
  schedule_expression_timezone = "UTC"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_sqs_queue.email_work[0].arn
    role_arn = aws_iam_role.email_reconciliation_scheduler[0].arn
    input    = local.email_reconciliation_input

    dead_letter_config {
      arn = aws_sqs_queue.email_scheduler_dlq[0].arn
    }

    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 2
    }

    sqs_parameters {
      message_group_id = local.email_reconciliation_group
    }
  }

  lifecycle {
    precondition {
      condition     = local.nonproduction_services_environment
      error_message = "Email reconciliation can be enabled only in dev or qa."
    }

    precondition {
      condition     = var.email_worker_enabled && local.email_worker_dependencies_configured
      error_message = "Email reconciliation requires the enabled worker, final migrated schema, and complete DB/Nylas/Valkey configuration."
    }
  }

  depends_on = [aws_iam_role_policy_attachment.email_reconciliation_scheduler]
}

resource "aws_cloudwatch_metric_alarm" "email_worker_not_running" {
  count = local.email_worker_service_enabled && var.cloudwatch_alarms_enabled && var.ecs_container_insights_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-email-worker-not-running"
  alarm_description   = "The private email worker ECS service has no running task."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.email_worker_alarm_action_arns

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.email_worker[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "email_work_oldest_message" {
  count = var.email_sqs_enabled && var.cloudwatch_alarms_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-email-work-oldest-message"
  alarm_description   = "The oldest visible email work item is more than 15 minutes old."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 900
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.email_worker_alarm_action_arns

  dimensions = {
    QueueName = aws_sqs_queue.email_work[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "email_work_backlog" {
  count = var.email_sqs_enabled && var.cloudwatch_alarms_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-email-work-backlog"
  alarm_description   = "The visible email work backlog exceeded the small DEV worker's expected capacity."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.email_worker_alarm_action_arns

  dimensions = {
    QueueName = aws_sqs_queue.email_work[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "email_work_dlq" {
  count = var.email_sqs_enabled && var.cloudwatch_alarms_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-email-work-dlq"
  alarm_description   = "Email work reached the DLQ and requires deliberate operator review before replay."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.email_worker_alarm_action_arns

  dimensions = {
    QueueName = aws_sqs_queue.email_work_dlq[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "email_scheduler_dlq" {
  count = var.email_sqs_enabled && var.cloudwatch_alarms_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-email-scheduler-dlq"
  alarm_description   = "A reconciliation schedule delivery reached its separate Scheduler DLQ."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.email_worker_alarm_action_arns

  dimensions = {
    QueueName = aws_sqs_queue.email_scheduler_dlq[0].name
  }
}
