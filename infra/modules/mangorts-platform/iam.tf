data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      local.db_password_secret_arn,
      var.openai_api_key_secret_arn,
      var.nylas_api_key_secret_arn,
      var.nylas_state_secret_arn,
      var.nylas_webhook_secret_arn
    ])
  }
}

resource "aws_iam_policy" "ecs_execution_secrets" {
  name   = "${local.name_prefix}-ecs-execution-secrets"
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.ecs_execution_secrets.arn
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role" "email_worker_execution" {
  count = local.email_worker_service_enabled ? 1 : 0

  name               = "${local.name_prefix}-email-worker-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "email_worker_execution" {
  count = local.email_worker_service_enabled ? 1 : 0

  role       = aws_iam_role.email_worker_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "email_worker_execution_secrets" {
  count = local.email_worker_service_enabled ? 1 : 0

  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      local.db_password_secret_arn,
      var.nylas_api_key_secret_arn,
    ])
  }
}

resource "aws_iam_policy" "email_worker_execution_secrets" {
  count = local.email_worker_service_enabled ? 1 : 0

  name   = "${local.name_prefix}-email-worker-execution-secrets"
  policy = data.aws_iam_policy_document.email_worker_execution_secrets[0].json
}

resource "aws_iam_role_policy_attachment" "email_worker_execution_secrets" {
  count = local.email_worker_service_enabled ? 1 : 0

  role       = aws_iam_role.email_worker_execution[0].name
  policy_arn = aws_iam_policy.email_worker_execution_secrets[0].arn
}

resource "aws_iam_role" "email_worker" {
  count = var.email_sqs_enabled ? 1 : 0

  name               = "${local.name_prefix}-email-worker"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  lifecycle {
    precondition {
      condition     = local.nonproduction_services_environment
      error_message = "The SQS email worker can be enabled only in dev or qa."
    }
  }
}

data "aws_iam_policy_document" "ecs_task_cognito" {
  statement {
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminDeleteUser"
    ]
    resources = [aws_cognito_user_pool.main.arn]
  }

  statement {
    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail"
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "ecs_task_cognito" {
  name   = "${local.name_prefix}-ecs-task-cognito"
  policy = data.aws_iam_policy_document.ecs_task_cognito.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_cognito" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.ecs_task_cognito.arn
}

data "aws_iam_policy_document" "ecs_task_attachments" {
  count = local.attachment_storage_enabled ? 1 : 0

  statement {
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListMultipartUploadParts",
      "s3:PutObject"
    ]
    resources = ["arn:aws:s3:::${trimspace(var.attachment_s3_bucket)}/companies/*"]
  }
}

resource "aws_iam_policy" "ecs_task_attachments" {
  count  = local.attachment_storage_enabled ? 1 : 0
  name   = "${local.name_prefix}-ecs-task-attachments"
  policy = data.aws_iam_policy_document.ecs_task_attachments[0].json
}

resource "aws_iam_role_policy_attachment" "ecs_task_attachments" {
  count      = local.attachment_storage_enabled ? 1 : 0
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.ecs_task_attachments[0].arn
}

resource "aws_iam_role_policy_attachment" "email_worker_attachments" {
  count = var.email_sqs_enabled && local.attachment_storage_enabled ? 1 : 0

  role       = aws_iam_role.email_worker[0].name
  policy_arn = aws_iam_policy.ecs_task_attachments[0].arn
}

data "aws_iam_policy_document" "github_oidc_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_oidc_subjects
    }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name_prefix}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_assume_role.json

  lifecycle {
    precondition {
      condition     = var.create_github_oidc_provider || trimspace(var.github_oidc_provider_arn) != ""
      error_message = "Set github_oidc_provider_arn when create_github_oidc_provider is false."
    }
  }
}

data "aws_iam_policy_document" "github_deploy" {
  dynamic "statement" {
    for_each = var.environment == "qa" ? [] : [1]

    content {
      actions = [
        "acm:*",
        "cloudfront:*",
        "cognito-idp:*",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CreateSecurityGroup",
        "ec2:CreateTags",
        "ec2:CreateVpcEndpoint",
        "ec2:DeleteSecurityGroup",
        "ec2:DeleteTags",
        "ec2:DeleteVpcEndpoints",
        "ec2:Describe*",
        "ec2:GetManagedPrefixListEntries",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
        "ecr:*",
        "ecs:*",
        "elasticache:AddTagsToResource",
        "elasticache:CreateServerlessCache",
        "elasticache:CreateUser",
        "elasticache:CreateUserGroup",
        "elasticache:DeleteServerlessCache",
        "elasticache:DeleteUser",
        "elasticache:DeleteUserGroup",
        "elasticache:DescribeServerlessCaches",
        "elasticache:DescribeUsers",
        "elasticache:DescribeUserGroups",
        "elasticache:ListTagsForResource",
        "elasticache:ModifyServerlessCache",
        "elasticache:ModifyUser",
        "elasticache:ModifyUserGroup",
        "elasticache:RemoveTagsFromResource",
        "elasticloadbalancing:*",
        "iam:*",
        "logs:*",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:ListTagsForResource",
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:TagResource",
        "cloudwatch:UntagResource",
        "route53:*",
        "s3:*",
        "wafv2:*"
      ]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "ReadRequiredQAAccountMetadata"
      actions = [
        "ec2:DescribeManagedPrefixLists",
        "ec2:DescribeSubnets",
        "ecr:GetAuthorizationToken",
        "ecs:DescribeTaskDefinition",
        "sts:GetCallerIdentity"
      ]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "ReadExactQAResources"
      actions = [
        "acm:DescribeCertificate",
        "acm:ListTagsForCertificate",
        "cloudfront:DescribeFunction",
        "cloudfront:GetDistribution",
        "cloudfront:GetDistributionConfig",
        "cloudfront:GetFunction",
        "cloudfront:GetInvalidation",
        "cloudfront:GetOriginAccessControl",
        "cloudfront:GetOriginAccessControlConfig",
        "cloudfront:ListTagsForResource",
        "cloudwatch:ListTagsForResource",
        "cognito-idp:DescribeResourceServer",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:ListTagsForResource",
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:ListTagsForResource",
        "elasticache:ListTagsForResource",
        "logs:ListTagsForResource",
        "wafv2:GetWebACL",
        "wafv2:ListTagsForResource"
      ]
      resources = [
        aws_acm_certificate.cloudfront.arn,
        aws_acm_certificate.alb.arn,
        aws_cloudfront_distribution.app.arn,
        aws_cloudfront_function.basic_auth.arn,
        "arn:${data.aws_partition.current.partition}:cloudfront::${data.aws_caller_identity.current.account_id}:origin-access-control/${aws_cloudfront_origin_access_control.frontend.id}",
        "arn:${data.aws_partition.current.partition}:cloudwatch:${var.aws_region}:${data.aws_caller_identity.current.account_id}:alarm:${local.name_prefix}-*",
        aws_cognito_user_pool.main.arn,
        aws_ecs_cluster.main.arn,
        "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${local.name_prefix}-cluster/${local.name_prefix}-*",
        "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name_prefix}-*:*",
        "arn:${data.aws_partition.current.partition}:elasticache:${var.aws_region}:${data.aws_caller_identity.current.account_id}:serverlesscache:${local.name_prefix}-*",
        "arn:${data.aws_partition.current.partition}:elasticache:${var.aws_region}:${data.aws_caller_identity.current.account_id}:user:${local.name_prefix}-*",
        "arn:${data.aws_partition.current.partition}:elasticache:${var.aws_region}:${data.aws_caller_identity.current.account_id}:usergroup:${local.name_prefix}-*",
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/*",
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/*:*",
        "arn:${data.aws_partition.current.partition}:wafv2:us-east-1:${data.aws_caller_identity.current.account_id}:global/webacl/${local.name_prefix}-cloudfront/*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "ReadExactQAIAMResources"
      actions = [
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:GetRole",
        "iam:ListAttachedRolePolicies",
        "iam:ListPolicyTags",
        "iam:ListPolicyVersions",
        "iam:ListRolePolicies",
        "iam:ListRoleTags"
      ]
      resources = [
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:policy/${local.name_prefix}-*",
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid     = "PassExactQAECSRoles"
      actions = ["iam:PassRole"]
      resources = [
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-ecs-task-execution",
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-ecs-task",
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-email-worker-execution",
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-email-worker"
      ]

      condition {
        test     = "StringEquals"
        variable = "iam:PassedToService"
        values   = ["ecs-tasks.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "ManageExactQABackendRepository"
      actions = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:Describe*",
        "ecr:Get*",
        "ecr:InitiateLayerUpload",
        "ecr:ListImages",
        "ecr:ListTagsForResource",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ]
      resources = [aws_ecr_repository.backend.arn]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "DeployQAECSTasks"
      actions = [
        "ecs:CreateService",
        "ecs:DeleteService",
        "ecs:TagResource",
        "ecs:UntagResource",
        "ecs:UpdateService"
      ]
      resources = [
        "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:service/${local.name_prefix}-cluster/${local.name_prefix}-*",
        "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name_prefix}-*:*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "RegisterQAECSTaskDefinitions"
      actions = [
        "ecs:RegisterTaskDefinition"
      ]
      resources = [
        "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name_prefix}-*:*"
      ]

      condition {
        test     = "StringEquals"
        variable = "aws:RequestTag/environment"
        values   = ["qa"]
      }

      condition {
        test     = "StringEquals"
        variable = "aws:RequestTag/project"
        values   = ["mangorts"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "ManageQADeploymentLogs"
      actions = [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource"
      ]
      resources = [
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/*",
        "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/*:*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "ReadQABuckets"
      actions = [
        "s3:Get*",
        "s3:ListBucket"
      ]
      resources = [
        aws_s3_bucket.frontend.arn,
        "${aws_s3_bucket.frontend.arn}/*",
        "arn:${data.aws_partition.current.partition}:s3:::${trimspace(var.attachment_s3_bucket)}",
        "arn:${data.aws_partition.current.partition}:s3:::${trimspace(var.attachment_s3_bucket)}/*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid = "PublishQAFrontend"
      actions = [
        "s3:DeleteObject",
        "s3:GetBucketLocation",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:PutObject"
      ]
      resources = [
        aws_s3_bucket.frontend.arn,
        "${aws_s3_bucket.frontend.arn}/*"
      ]
    }
  }

  dynamic "statement" {
    for_each = var.environment == "qa" ? [1] : []

    content {
      sid       = "InvalidateQACloudFront"
      actions   = ["cloudfront:CreateInvalidation"]
      resources = [aws_cloudfront_distribution.app.arn]
    }
  }
}

resource "aws_iam_policy" "github_deploy" {
  name   = "${local.name_prefix}-github-deploy"
  policy = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_iam_role_policy_attachment" "github_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy.arn
}
