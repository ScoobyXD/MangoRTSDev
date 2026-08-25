check "nylas_core_is_all_or_none" {
  assert {
    condition     = contains([0, 3], local.nylas_core_configured_count)
    error_message = "Set all or none of nylas_client_id, nylas_api_key_secret_arn, and nylas_state_secret_arn."
  }
}

check "nylas_webhook_requires_core" {
  assert {
    condition     = trimspace(var.nylas_webhook_secret_arn) == "" || local.nylas_core_configured_count == 3
    error_message = "nylas_webhook_secret_arn requires the complete QA Nylas core configuration."
  }
}

check "email_worker_dependencies" {
  assert {
    condition = !var.email_worker_enabled || (
      var.realtime_valkey_enabled &&
      var.email_sqs_database_migration_complete &&
      local.nylas_core_configured_count == 3 &&
      trimspace(var.backend_image_uri) != ""
    )
    error_message = "email_worker_enabled requires an immutable backend image, Valkey, the reviewed database schema, and complete QA Nylas core configuration."
  }
}

check "full_alarms_require_container_insights" {
  assert {
    condition     = !var.cloudwatch_alarms_enabled || var.ecs_container_insights_enabled
    error_message = "The full QA alarm set requires ECS Container Insights for the email-worker running-task alarm."
  }
}

check "qa_identity_is_hard_locked" {
  assert {
    condition = (
      local.project_name == "mangorts" &&
      local.environment == "qa" &&
      local.root_domain_name == "mangorts.com" &&
      local.app_subdomain == "qa" &&
      local.api_subdomain == "api.qa" &&
      local.origin_subdomain == "origin.qa"
    )
    error_message = "QA project, environment, and DNS identity must remain hard-locked."
  }
}
