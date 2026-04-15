resource "aws_db_subnet_group" "aurora" {
  count = var.create_aurora ? 1 : 0

  name       = "${local.name_prefix}-aurora-subnets"
  subnet_ids = [for subnet in values(aws_subnet.private) : subnet.id]
}

resource "aws_rds_cluster_parameter_group" "aurora_postgres" {
  count = var.create_aurora ? 1 : 0

  name   = "${local.name_prefix}-aurora-pg"
  family = "aurora-postgresql16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_rds_cluster" "aurora" {
  count = var.create_aurora ? 1 : 0

  cluster_identifier              = "${local.name_prefix}-aurora"
  engine                          = "aurora-postgresql"
  engine_version                  = "16.4"
  database_name                   = var.aurora_database_name
  master_username                 = var.aurora_master_username
  master_password                 = var.aurora_master_password
  db_subnet_group_name            = aws_db_subnet_group.aurora[0].name
  vpc_security_group_ids          = [aws_security_group.aurora[0].id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.aurora_postgres[0].name
  backup_retention_period         = 7
  preferred_backup_window         = "05:00-06:00"
  preferred_maintenance_window    = "sun:06:30-sun:07:30"
  deletion_protection             = true
  storage_encrypted               = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name_prefix}-final"
}

resource "aws_rds_cluster_instance" "aurora_instances" {
  count              = var.create_aurora ? var.aurora_instances : 0
  identifier         = "${local.name_prefix}-aurora-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.aurora[0].id
  instance_class     = var.aurora_instance_class
  engine             = aws_rds_cluster.aurora[0].engine
  engine_version     = aws_rds_cluster.aurora[0].engine_version
}
