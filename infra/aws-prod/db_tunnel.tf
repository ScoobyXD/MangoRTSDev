data "aws_ssm_parameter" "db_tunnel_al2023_x86_64" {
  count = var.enable_db_tunnel_host ? 1 : 0

  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_iam_policy_document" "db_tunnel_assume_role" {
  count = var.enable_db_tunnel_host ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "db_tunnel" {
  count = var.enable_db_tunnel_host ? 1 : 0

  name               = "${local.name_prefix}-db-tunnel"
  assume_role_policy = data.aws_iam_policy_document.db_tunnel_assume_role[0].json
}

resource "aws_iam_role_policy_attachment" "db_tunnel_ssm" {
  count = var.enable_db_tunnel_host ? 1 : 0

  role       = aws_iam_role.db_tunnel[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "db_tunnel" {
  count = var.enable_db_tunnel_host ? 1 : 0

  name = "${local.name_prefix}-db-tunnel"
  role = aws_iam_role.db_tunnel[0].name
}

resource "aws_security_group" "db_tunnel" {
  count = var.enable_db_tunnel_host ? 1 : 0

  name        = "${local.name_prefix}-db-tunnel"
  description = "Human-only SSM port-forward host for prod database access"
  vpc_id      = var.vpc_id

  tags = {
    Name    = "${local.name_prefix}-db-tunnel"
    purpose = "human-db-tunnel"
  }
}

resource "aws_security_group_rule" "db_tunnel_https_egress" {
  count = var.enable_db_tunnel_host ? 1 : 0

  type              = "egress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.db_tunnel[0].id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "Allow SSM agent HTTPS egress through NAT or VPC endpoints"
}

resource "aws_security_group_rule" "db_tunnel_to_existing_db_egress" {
  count = var.enable_db_tunnel_host ? 1 : 0

  type                     = "egress"
  from_port                = var.existing_db_port
  to_port                  = var.existing_db_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.db_tunnel[0].id
  source_security_group_id = var.existing_db_security_group_id
  description              = "Allow tunnel host to reach prod database"
}

resource "aws_security_group_rule" "db_tunnel_to_existing_db_ingress" {
  count = var.enable_db_tunnel_host ? 1 : 0

  type                     = "ingress"
  from_port                = var.existing_db_port
  to_port                  = var.existing_db_port
  protocol                 = "tcp"
  security_group_id        = var.existing_db_security_group_id
  source_security_group_id = aws_security_group.db_tunnel[0].id
  description              = "Allow human-only SSM tunnel host to reach prod database"
}

resource "aws_instance" "db_tunnel" {
  count = var.enable_db_tunnel_host ? 1 : 0

  ami                         = data.aws_ssm_parameter.db_tunnel_al2023_x86_64[0].value
  instance_type               = var.db_tunnel_instance_type
  subnet_id                   = local.db_tunnel_subnet_id
  associate_public_ip_address = false
  iam_instance_profile        = aws_iam_instance_profile.db_tunnel[0].name
  vpc_security_group_ids      = [aws_security_group.db_tunnel[0].id]

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    encrypted             = true
    delete_on_termination = true
    volume_size           = 8
    volume_type           = "gp3"
  }

  tags = {
    Name    = "${local.name_prefix}-db-tunnel"
    purpose = "human-db-tunnel"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      ami,
    ]

    precondition {
      condition     = local.db_tunnel_subnet_id != ""
      error_message = "enable_db_tunnel_host requires at least one private subnet, or an explicit db_tunnel_subnet_id."
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.db_tunnel_ssm,
  ]
}

