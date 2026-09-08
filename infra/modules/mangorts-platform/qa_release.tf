resource "aws_lb_listener_rule" "qa_release_probe" {
  count        = var.environment == "qa" ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 50

  action {
    type             = trimspace(var.qa_release_probe) != "" ? "forward" : "fixed-response"
    target_group_arn = trimspace(var.qa_release_probe) != "" ? aws_lb_target_group.backend.arn : null

    dynamic "fixed_response" {
      for_each = nonsensitive(trimspace(var.qa_release_probe) == "") ? [1] : []
      content {
        content_type = "text/plain"
        message_body = "QA maintenance"
        status_code  = "503"
      }
    }
  }

  dynamic "condition" {
    for_each = nonsensitive(trimspace(var.qa_release_probe) != "") ? [1] : []
    content {
      http_header {
        http_header_name = local.origin_verify_header_name
        values           = [local.origin_verify_header_value]
      }
    }
  }
  condition {
    http_header {
      http_header_name = "X-Mangorts-QA-Release-Probe"
      values           = [trimspace(var.qa_release_probe) != "" ? var.qa_release_probe : "disabled"]
    }
  }
}

resource "aws_lb_listener_rule" "qa_maintenance" {
  count        = var.environment == "qa" ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 60

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "QA maintenance"
      status_code  = "503"
    }
  }

  condition {
    path_pattern {
      values = var.deployment_maintenance_mode ? ["/*"] : ["/.qa-maintenance-disabled"]
    }
  }
}
