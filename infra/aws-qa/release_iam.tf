locals {
  qa_cluster_arn         = "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/${local.name_prefix}-cluster"
  qa_rds_arn             = "arn:${data.aws_partition.current.partition}:rds:${var.aws_region}:${data.aws_caller_identity.current.account_id}"
  qa_release_objects_arn = "arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}/mangorts/qa/releases/*"
}

# Initial policy creation/attachment is an SSO foundation operation. The QA
# deploy role can use these exact targets but cannot change its own permissions.
data "aws_iam_policy_document" "qa_release" {
  statement {
    sid       = "RetainOnlyQARecoveryImages"
    actions   = ["ecr:PutLifecyclePolicy", "ecr:BatchDeleteImage"]
    resources = ["arn:${data.aws_partition.current.partition}:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/${local.name_prefix}-backend"]
  }
  statement {
    sid       = "ReadAttachmentVersioningPropagationBoundary"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.attachment_versioning_ready.arn]
  }
  statement {
    sid       = "ReadAndSelectActiveQADatabase"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = [aws_ssm_parameter.active_database.arn]
  }
  statement {
    sid       = "ReadExactQADatabaseRecoveryMetadata"
    actions   = ["rds:DescribeDBInstances", "rds:DescribeDBInstanceAutomatedBackups", "rds:ListTagsForResource"]
    resources = [aws_db_instance.qa.arn, "${local.qa_rds_arn}:db:${local.name_prefix}-recovery-*"]
  }
  # RDS authorizes backup enumeration against auto-backup ARNs, even when
  # the request is filtered to the exact QA database resource ID.
  # Keep the new Sid short to fit the IAM managed-policy size limit.
  statement {
    sid       = "ReadBackupMetadata"
    actions   = ["rds:DescribeDBInstanceAutomatedBackups"]
    resources = ["${local.qa_rds_arn}:auto-backup:*"]
  }
  statement {
    sid       = "RestoreOnlyPrivateTaggedQARecoveryInstances"
    actions   = ["rds:RestoreDBInstanceToPointInTime"]
    resources = [aws_db_instance.qa.arn, "${local.qa_rds_arn}:db:${local.name_prefix}-recovery-*"]
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
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/managed_by"
      values   = ["qa-release-recovery"]
    }
    condition {
      test     = "Bool"
      variable = "rds:PubliclyAccessible"
      values   = ["false"]
    }
    condition {
      test     = "Bool"
      variable = "rds:MultiAz"
      values   = ["false"]
    }
  }
  statement {
    sid     = "UseExactQARecoveryDatabaseGroups"
    actions = ["rds:RestoreDBInstanceToPointInTime"]
    resources = [
      aws_db_subnet_group.qa.arn,
      "${local.qa_rds_arn}:pg:default.postgres17",
      "${local.qa_rds_arn}:og:default:postgres-17",
    ]
  }
  statement {
    sid       = "TagOnlyCreatedQARecoveryInstances"
    actions   = ["rds:AddTagsToResource"]
    resources = ["${local.qa_rds_arn}:db:${local.name_prefix}-recovery-*"]
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
  statement {
    sid       = "DescribeExistingQARecoveryEncryptionKey"
    actions   = ["kms:DescribeKey"]
    resources = [aws_db_instance.qa.kms_key_id]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["rds.${var.aws_region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "AllowRDSOnlyToRestoreWithTheExistingKey"
    actions   = ["kms:CreateGrant"]
    resources = [aws_db_instance.qa.kms_key_id]
    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["rds.${var.aws_region}.amazonaws.com"]
    }
  }
  statement {
    sid     = "ListExactQAClusterWriters"
    actions = ["ecs:ListServices", "ecs:ListTasks"]
    # ListServices has no resource ARN and Fargate ListTasks has no container
    # instance ARN. The supported cluster condition binds both lists to QA.
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.qa_cluster_arn]
    }
  }
  statement {
    sid     = "InventoryWriterScheduleMetadata"
    actions = ["events:ListRules", "scheduler:ListSchedules"]
    # These list APIs do not support resource-level IAM. The coordinator
    # requests the mangorts-qa- prefix and rejects unknown scheduled writers.
    resources = ["*"]
  }
  statement {
    sid       = "DrainAndInspectQAWriterTasks"
    actions   = ["ecs:DescribeTasks", "ecs:StopTask"]
    resources = ["arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task/${local.name_prefix}-cluster/*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.qa_cluster_arn]
    }
  }
  statement {
    sid     = "RunExactQAReleaseTasks"
    actions = ["ecs:RunTask"]
    resources = [
      "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name_prefix}-database-migration:*",
      "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.name_prefix}-attachment-maintenance:*",
    ]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.qa_cluster_arn]
    }
  }
  statement {
    sid     = "ReadExactQAReleaseTaskLogs"
    actions = ["logs:GetLogEvents"]
    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/database-migration:log-stream:*",
      "arn:${data.aws_partition.current.partition}:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/ecs/${local.name_prefix}/backend:log-stream:attachment-maintenance/*",
    ]
  }
  statement {
    sid       = "GateOnlyQAApplicationTraffic"
    actions   = ["elasticloadbalancing:ModifyRule"]
    resources = [module.platform.qa_release_maintenance.gate_rule_arn, module.platform.qa_release_maintenance.probe_rule_arn]
  }
  statement {
    sid     = "ReadQAReleaseLoadBalancerState"
    actions = ["elasticloadbalancing:DescribeRules", "elasticloadbalancing:DescribeTags", "elasticloadbalancing:DescribeTargetHealth"]
    # These ELB describe APIs do not support resource-level IAM. Terraform
    # reads rule tags after ModifyRule even when its plan used -refresh=false.
    resources = ["*"]
  }
  statement {
    sid       = "PauseExactQAEmailSchedule"
    actions   = ["scheduler:GetSchedule", "scheduler:UpdateSchedule"]
    resources = ["arn:${data.aws_partition.current.partition}:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${local.name_prefix}-email-reconciliation/${local.name_prefix}-email-reconciliation"]
  }
  statement {
    sid       = "PassExactQAEmailSchedulerRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.name_prefix}-email-reconciliation-scheduler"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["scheduler.amazonaws.com"]
    }
  }
  statement {
    sid       = "ListOnlyQAReleaseHistory"
    actions   = ["s3:ListBucket", "s3:ListBucketVersions"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["mangorts/qa/releases/*"]
    }
  }
  statement {
    sid       = "RetainAndPruneOnlyQAReleaseHistory"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
    resources = [local.qa_release_objects_arn]
  }
  statement {
    sid       = "ReadAndGateExactQAAttachmentBucket"
    actions   = ["s3:GetBucketVersioning", "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:ListBucketVersions"]
    resources = [aws_s3_bucket.attachments.arn]
  }
  statement {
    sid       = "RestoreQAAttachmentBytesWithoutDeletingVersions"
    actions   = ["s3:GetObjectVersion", "s3:GetObjectVersionTagging", "s3:GetObject", "s3:PutObject", "s3:PutObjectTagging", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.attachments.arn}/companies/*"]
  }
}

resource "aws_iam_policy" "qa_release" {
  name   = "${local.name_prefix}-github-deploy-release"
  policy = data.aws_iam_policy_document.qa_release.json
}

resource "aws_iam_role_policy_attachment" "qa_release" {
  role       = module.platform.github_deploy_role_name
  policy_arn = aws_iam_policy.qa_release.arn
}
