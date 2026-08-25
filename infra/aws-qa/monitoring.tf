resource "aws_cloudwatch_log_group" "ecs_container_insights_performance" {
  count = var.ecs_container_insights_enabled ? 1 : 0

  name              = "/aws/ecs/containerinsights/${local.name_prefix}-cluster/performance"
  retention_in_days = var.cloudwatch_log_retention_days

  tags = local.tags
}
