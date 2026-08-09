locals {
  realtime_valkey_cache_name = lower("${local.name_prefix}-realtime")
  realtime_valkey_user_name  = lower("${local.name_prefix}-realtime-api")
}

resource "aws_security_group" "realtime_valkey" {
  count = var.realtime_valkey_enabled ? 1 : 0

  # The first dev deployment expands its own deploy policy with
  # ec2:CreateSecurityGroup. Do not race security-group creation ahead of it.
  depends_on = [aws_iam_role_policy_attachment.github_deploy]

  name        = "${local.name_prefix}-realtime-valkey"
  description = "Private ${var.environment} Valkey ingress from MangoRTS ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "TLS ElastiCache Serverless Valkey endpoints from MangoRTS ECS tasks"
    from_port       = 6379
    to_port         = 6380
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  lifecycle {
    precondition {
      condition     = var.environment == "dev"
      error_message = "The realtime Valkey backplane is development-only and cannot be enabled outside dev."
    }
  }
}

resource "aws_elasticache_user" "realtime" {
  count = var.realtime_valkey_enabled ? 1 : 0

  # The first dev deployment expands its own deploy policy. Serializing the
  # first ElastiCache API call avoids racing IAM policy propagation.
  depends_on = [aws_iam_role_policy_attachment.github_deploy]

  user_id       = local.realtime_valkey_user_name
  user_name     = local.realtime_valkey_user_name
  engine        = "valkey"
  access_string = "on ~* &${var.realtime_valkey_channel} +@connection +cluster|slots +cluster|shards +publish +subscribe +unsubscribe"

  authentication_mode {
    type = "iam"
  }
}

resource "aws_elasticache_user_group" "realtime" {
  count = var.realtime_valkey_enabled ? 1 : 0

  engine        = "valkey"
  user_group_id = lower("${local.name_prefix}-realtime")
  user_ids      = [aws_elasticache_user.realtime[0].user_id]
}

resource "aws_elasticache_serverless_cache" "realtime" {
  count = var.realtime_valkey_enabled ? 1 : 0

  # Serverless Valkey always uses TLS in transit. Omitting kms_key_id selects
  # the AWS-managed ElastiCache service key for encryption at rest.
  name                 = local.realtime_valkey_cache_name
  description          = "MangoRTS development committed-event realtime backplane"
  engine               = "valkey"
  major_engine_version = var.realtime_valkey_major_engine_version
  subnet_ids           = local.ecs_subnet_ids
  security_group_ids   = [aws_security_group.realtime_valkey[0].id]
  user_group_id        = aws_elasticache_user_group.realtime[0].user_group_id

  cache_usage_limits {
    data_storage {
      maximum = var.realtime_valkey_max_data_storage_gb
      unit    = "GB"
    }

    ecpu_per_second {
      maximum = var.realtime_valkey_max_ecpu_per_second
    }
  }

  tags = local.tags
}

data "aws_iam_policy_document" "ecs_task_realtime_valkey" {
  count = var.realtime_valkey_enabled ? 1 : 0

  statement {
    actions = ["elasticache:Connect"]
    resources = [
      aws_elasticache_serverless_cache.realtime[0].arn,
      aws_elasticache_user.realtime[0].arn
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceVpc"
      values   = [var.vpc_id]
    }
  }
}

resource "aws_iam_policy" "ecs_task_realtime_valkey" {
  count = var.realtime_valkey_enabled ? 1 : 0

  name   = "${local.name_prefix}-ecs-task-realtime-valkey"
  policy = data.aws_iam_policy_document.ecs_task_realtime_valkey[0].json
}

resource "aws_iam_role_policy_attachment" "ecs_task_realtime_valkey" {
  count = var.realtime_valkey_enabled ? 1 : 0

  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.ecs_task_realtime_valkey[0].arn
}

resource "aws_cloudwatch_metric_alarm" "realtime_valkey_no_connections" {
  count = var.realtime_valkey_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-realtime-valkey-no-connections"
  alarm_description   = "No API task has an active Valkey connection for three minutes."
  namespace           = "AWS/ElastiCache"
  metric_name         = "CurrConnections"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.realtime_valkey_alarm_action_arns

  dimensions = {
    clusterId = aws_elasticache_serverless_cache.realtime[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "realtime_valkey_auth_failures" {
  count = var.realtime_valkey_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-realtime-valkey-auth-failures"
  alarm_description   = "Valkey rejected one or more authentication attempts."
  namespace           = "AWS/ElastiCache"
  metric_name         = "AuthenticationFailures"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.realtime_valkey_alarm_action_arns

  dimensions = {
    clusterId = aws_elasticache_serverless_cache.realtime[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "realtime_valkey_write_latency" {
  count = var.realtime_valkey_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-realtime-valkey-write-latency"
  alarm_description   = "Valkey p99 successful-write latency exceeded 10 milliseconds for five minutes."
  namespace           = "AWS/ElastiCache"
  metric_name         = "SuccessfulWriteRequestLatency"
  extended_statistic  = "p99"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 10000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.realtime_valkey_alarm_action_arns

  dimensions = {
    clusterId = aws_elasticache_serverless_cache.realtime[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "realtime_valkey_throttled" {
  count = var.realtime_valkey_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-realtime-valkey-throttled"
  alarm_description   = "ElastiCache Serverless throttled one or more realtime commands."
  namespace           = "AWS/ElastiCache"
  metric_name         = "ThrottledCmds"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.realtime_valkey_alarm_action_arns

  dimensions = {
    clusterId = aws_elasticache_serverless_cache.realtime[0].name
  }
}

resource "aws_cloudwatch_metric_alarm" "realtime_valkey_ecpu_capacity" {
  count = var.realtime_valkey_enabled ? 1 : 0

  alarm_name          = "${local.name_prefix}-realtime-valkey-ecpu-capacity"
  alarm_description   = "Valkey consumed at least 75 percent of its configured ECPU limit for three minutes."
  namespace           = "AWS/ElastiCache"
  metric_name         = "ElastiCacheProcessingUnits"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = var.realtime_valkey_max_ecpu_per_second * 60 * 0.75
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.realtime_valkey_alarm_action_arns

  dimensions = {
    clusterId = aws_elasticache_serverless_cache.realtime[0].name
  }
}
