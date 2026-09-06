resource "aws_cognito_user_pool" "main" {
  name = "${local.name_prefix}-users"

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  auto_verified_attributes = ["email"]

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  username_attributes = ["email"]

  verification_message_template {
    default_email_option = "CONFIRM_WITH_LINK"
  }

  password_policy {
    minimum_length                   = 6
    require_lowercase                = false
    require_numbers                  = false
    require_symbols                  = false
    require_uppercase                = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# Cognito's email verification links use /confirmUser on this domain.
# The pool ID supplies a stable, unique prefix without exposing an app secret.
resource "aws_cognito_user_pool_domain" "signup" {
  domain       = lower(replace(aws_cognito_user_pool.main.id, "_", "-"))
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_resource_server" "mangorts_api" {
  identifier   = "https://${local.api_domain}"
  name         = "MangoRTS API"
  user_pool_id = aws_cognito_user_pool.main.id

  scope {
    scope_name        = "api"
    scope_description = "Call MangoRTS API"
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${local.name_prefix}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]
  read_attributes  = ["email", "email_verified"]
  write_attributes = ["email"]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_client" "machine" {
  name         = "${local.name_prefix}-machine-reserved"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  prevent_user_existence_errors        = "ENABLED"
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = ["${aws_cognito_resource_server.mangorts_api.identifier}/api"]

  depends_on = [aws_cognito_resource_server.mangorts_api]
}
