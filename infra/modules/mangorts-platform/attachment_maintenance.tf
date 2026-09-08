locals {
  attachment_maintenance_enabled  = local.nonproduction_services_environment && local.backend_service_enabled && local.attachment_storage_enabled
  attachment_maintenance_name     = "${local.name_prefix}-attachment-maintenance"
  attachment_maintenance_arn      = "arn:${data.aws_partition.current.partition}:events:${var.aws_region}:${data.aws_caller_identity.current.account_id}:rule/${local.attachment_maintenance_name}"
  attachment_maintenance_task_arn = "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.attachment_maintenance_name}:"
}

resource "aws_ecs_task_definition" "attachment_maintenance" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  family                   = local.attachment_maintenance_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.backend_cpu
  memory                   = var.backend_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  tags                     = local.tags
  skip_destroy             = true

  container_definitions = jsonencode([{
    name      = "attachment-maintenance"
    image     = var.backend_image_uri
    essential = true
    environment = [
      { name = "APP_ENV", value = var.environment },
      { name = "ALLOW_INMEMORY_FALLBACK", value = "false" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "MANGORTS_RUNTIME_ROLE", value = "attachment-maintenance" },
      { name = "MANGORTS_DEPLOY_REVISION", value = var.deploy_revision },
      { name = "MANGORTS_ATTACHMENT_S3_BUCKET", value = trimspace(var.attachment_s3_bucket) },
      { name = "MANGORTS_ATTACHMENT_AWS_REGION", value = var.aws_region },
      { name = "DB_HOST", value = local.db_host },
      { name = "DB_PORT", value = tostring(local.db_port) },
      { name = "DB_NAME", value = local.db_name },
      { name = "DB_USER", value = local.db_user },
      { name = "DB_SSLMODE", value = "require" },
      { name = "DB_MAX_OPEN_CONNS", value = "2" },
      { name = "DB_MAX_IDLE_CONNS", value = "1" },
    ]
    secrets = [{ name = "DB_PASSWORD", valueFrom = local.db_password_secret_value_from }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "attachment-maintenance"
      }
    }
  }])

  depends_on = [
    aws_iam_role_policy_attachment.ecs_execution_secrets,
    aws_iam_role_policy_attachment.ecs_task_attachments,
  ]
}

resource "aws_iam_role" "attachment_maintenance_events" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name = "${local.attachment_maintenance_name}-events"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnEquals    = { "aws:SourceArn" = local.attachment_maintenance_arn }
      }
    }]
  })
}

resource "aws_iam_role_policy" "attachment_maintenance_events" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name = local.attachment_maintenance_name
  role = aws_iam_role.attachment_maintenance_events[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = aws_ecs_task_definition.attachment_maintenance[0].arn
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.ecs_task_execution.arn, aws_iam_role.ecs_task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_cloudwatch_event_rule" "attachment_maintenance" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name                = local.attachment_maintenance_name
  description         = "Daily finite recovery of attachment deletions whose local wake was lost."
  schedule_expression = "rate(1 day)"
  state               = var.deployment_maintenance_mode ? "DISABLED" : "ENABLED"
  tags                = local.tags

  depends_on = [aws_iam_role_policy_attachment.github_deploy_attachment_maintenance]
}

resource "aws_cloudwatch_event_target" "attachment_maintenance" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  rule      = aws_cloudwatch_event_rule.attachment_maintenance[0].name
  target_id = "attachment-maintenance"
  arn       = aws_ecs_cluster.main.arn
  role_arn  = aws_iam_role.attachment_maintenance_events[0].arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 2
  }
  ecs_target {
    task_definition_arn = aws_ecs_task_definition.attachment_maintenance[0].arn
    task_count          = 1
    launch_type         = "FARGATE"
    network_configuration {
      subnets          = local.ecs_subnet_ids
      security_groups  = [aws_security_group.ecs.id]
      assign_public_ip = false
    }
  }
  depends_on = [aws_iam_role_policy.attachment_maintenance_events]
}

resource "aws_cloudwatch_event_rule" "attachment_maintenance_failed" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name        = "${local.attachment_maintenance_name}-failed"
  description = "Match maintenance startup failures and nonzero exits across task revisions."
  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn        = [aws_ecs_cluster.main.arn]
      taskDefinitionArn = [{ prefix = local.attachment_maintenance_task_arn }]
      lastStatus        = ["STOPPED"]
      "$or" = [
        { stopCode = ["TaskFailedToStart", "SpotInterruption", "TerminationNotice", "UserInitiated"] },
        { containers = { name = ["attachment-maintenance"], exitCode = [{ "anything-but" = 0 }] } },
      ]
    }
  })
  tags = local.tags

  depends_on = [aws_iam_role_policy_attachment.github_deploy_attachment_maintenance]
}

# RunTask can return HTTP 200 with placement failures and create no task event.
# Require an actual successful exit each day as well as explicit failure alarms.
resource "aws_cloudwatch_event_rule" "attachment_maintenance_succeeded" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name = "${local.attachment_maintenance_name}-succeeded"
  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn        = [aws_ecs_cluster.main.arn]
      taskDefinitionArn = [{ prefix = local.attachment_maintenance_task_arn }]
      lastStatus        = ["STOPPED"]
      stopCode          = ["EssentialContainerExited"]
      containers        = { name = ["attachment-maintenance"], exitCode = [0] }
    }
  })
  tags = local.tags

  depends_on = [aws_iam_role_policy_attachment.github_deploy_attachment_maintenance]
}

resource "aws_cloudwatch_metric_alarm" "attachment_maintenance_overdue" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  alarm_name          = "${local.attachment_maintenance_name}-overdue"
  alarm_description   = "No successful attachment recovery exit for 26 hours; inspect the daily target, ECS placement, and failure logs."
  namespace           = "AWS/Events"
  metric_name         = "TriggeredRules"
  dimensions          = { RuleName = aws_cloudwatch_event_rule.attachment_maintenance_succeeded[0].name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 26
  datapoints_to_alarm = 26
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.attachment_maintenance_alarm_action_arns
}

resource "aws_cloudwatch_log_group" "attachment_maintenance_failures" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name              = "/ecs/${local.name_prefix}/attachment-maintenance-failures"
  retention_in_days = var.cloudwatch_log_retention_days
}

resource "aws_cloudwatch_log_resource_policy" "attachment_maintenance_failures" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  policy_name = "${local.attachment_maintenance_name}-failures"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = "logs:CreateLogStream"
      Resource  = "${aws_cloudwatch_log_group.attachment_maintenance_failures[0].arn}:*"
      }, {
      Effect    = "Allow"
      Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }
      Action    = "logs:PutLogEvents"
      Resource  = "${aws_cloudwatch_log_group.attachment_maintenance_failures[0].arn}:*:*"
      Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.attachment_maintenance_failed[0].arn } }
    }]
  })
}

resource "aws_cloudwatch_event_target" "attachment_maintenance_failures" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  rule       = aws_cloudwatch_event_rule.attachment_maintenance_failed[0].name
  arn        = aws_cloudwatch_log_group.attachment_maintenance_failures[0].arn
  depends_on = [aws_cloudwatch_log_resource_policy.attachment_maintenance_failures]
}

resource "aws_cloudwatch_metric_alarm" "attachment_maintenance_delivery_failed" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  alarm_name          = "${local.attachment_maintenance_name}-delivery-failed"
  alarm_description   = "Daily attachment recovery could not launch after bounded EventBridge retries."
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  dimensions          = { RuleName = aws_cloudwatch_event_rule.attachment_maintenance[0].name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.attachment_maintenance_alarm_action_arns
}

# Bootstrap this narrowly scoped policy with the environment's human SSO role.
# Routine deploys can then refresh the recovery task revision and its target.
data "aws_iam_policy_document" "github_deploy_attachment_maintenance" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  statement {
    sid = "ManageExactAttachmentRecoveryRules"
    actions = [
      "events:DeleteRule", "events:DescribeRule", "events:DisableRule", "events:EnableRule",
      "events:ListTagsForResource", "events:ListTargetsByRule", "events:PutRule",
      "events:PutTargets", "events:RemoveTargets", "events:TagResource", "events:UntagResource",
    ]
    resources = [local.attachment_maintenance_arn, "${local.attachment_maintenance_arn}-failed", "${local.attachment_maintenance_arn}-succeeded"]
  }
  statement {
    sid       = "UpdateExactAttachmentRecoveryTaskPermission"
    actions   = ["iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]
    resources = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.attachment_maintenance_name}-events"]
  }
  statement {
    sid       = "PassExactAttachmentRecoveryEventsRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.attachment_maintenance_name}-events"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["events.amazonaws.com"]
    }
  }
  statement {
    sid = "ManageExactAttachmentRecoveryAlarms"
    actions = [
      "cloudwatch:DeleteAlarms", "cloudwatch:ListTagsForResource", "cloudwatch:PutMetricAlarm",
      "cloudwatch:TagResource", "cloudwatch:UntagResource",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:${local.attachment_maintenance_name}-failed",
      "arn:${data.aws_partition.current.partition}:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:${local.attachment_maintenance_name}-delivery-failed",
      "arn:${data.aws_partition.current.partition}:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:${local.attachment_maintenance_name}-overdue",
    ]
  }
  statement {
    sid       = "ReadRecoveryAlarmAndLogPolicyMetadata"
    actions   = ["cloudwatch:DescribeAlarms", "logs:DescribeResourcePolicies"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "github_deploy_attachment_maintenance" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  name   = "${local.name_prefix}-github-deploy-attachment-maintenance"
  policy = data.aws_iam_policy_document.github_deploy_attachment_maintenance[0].json
}

resource "aws_iam_role_policy_attachment" "github_deploy_attachment_maintenance" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy_attachment_maintenance[0].arn
}

resource "aws_cloudwatch_metric_alarm" "attachment_maintenance_failed" {
  count = local.attachment_maintenance_enabled ? 1 : 0

  alarm_name          = "${local.attachment_maintenance_name}-failed"
  alarm_description   = "Daily attachment recovery failed to start, was interrupted, or exited unsuccessfully; inspect its failure event log."
  namespace           = "AWS/Events"
  metric_name         = "TriggeredRules"
  dimensions          = { RuleName = aws_cloudwatch_event_rule.attachment_maintenance_failed[0].name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.attachment_maintenance_alarm_action_arns
}
