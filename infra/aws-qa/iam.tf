data "aws_iam_policy_document" "qa_terraform_state" {
  statement {
    sid       = "ReadQAStateBucketMetadata"
    actions   = ["s3:GetBucketLocation"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}"]
  }

  statement {
    sid       = "ListExactQAStateObjects"
    actions   = ["s3:ListBucket"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [local.terraform_state_key, "${local.terraform_state_key}.tflock"]
    }
  }

  statement {
    sid = "ManageExactQAStateObjects"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject"
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}/${local.terraform_state_key}",
      "arn:${data.aws_partition.current.partition}:s3:::${var.terraform_state_bucket_name}/${local.terraform_state_key}.tflock"
    ]
  }
}

resource "aws_iam_policy" "qa_terraform_state" {
  name   = "${local.name_prefix}-github-deploy-state"
  policy = data.aws_iam_policy_document.qa_terraform_state.json
}

resource "aws_iam_role_policy_attachment" "qa_terraform_state" {
  role       = module.platform.github_deploy_role_name
  policy_arn = aws_iam_policy.qa_terraform_state.arn
}
