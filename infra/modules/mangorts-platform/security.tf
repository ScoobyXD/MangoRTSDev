resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "MangoRTS ${var.environment} ALB ingress from CloudFront"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTPS from CloudFront origin-facing network"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "${local.name_prefix}-ecs"
  description = "MangoRTS ${var.environment} ECS service ingress from ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "ecs_to_existing_db" {
  type                     = "ingress"
  from_port                = local.db_port
  to_port                  = local.db_port
  protocol                 = "tcp"
  security_group_id        = local.db_security_group_id
  source_security_group_id = aws_security_group.ecs.id
  description              = "Allow MangoRTS ${var.environment} ECS tasks to reach the database"
}
