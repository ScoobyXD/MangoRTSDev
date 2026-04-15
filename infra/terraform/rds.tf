resource "aws_db_subnet_group" "aurora" {
  name       = "${local.name_prefix}-aurora-subnets"
  subnet_ids = [for subnet in values(aws_subnet.private) : subnet.id]
}

resource "aws_rds_cluster_parameter_group" "aurora_postgres" {
  name   = "${local.name_prefix}-aurora-pg"
  family = "aurora-postgresql16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_rds_cluster" "aurora" {
  cluster_identifier              = "${local.name_prefix}-aurora"
  engine                          = "aurora-postgresql"
  engine_version                  = "16.4"
  database_name                   = var.aurora_database_name
  master_username                 = var.aurora_master_username
  master_password                 = var.aurora_master_password
  db_subnet_group_name            = aws_db_subnet_group.aurora.name
  vpc_security_group_ids          = [aws_security_group.aurora.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.aurora_postgres.name
  backup_retention_period         = 7
  preferred_backup_window         = "05:00-06:00"
  preferred_maintenance_window    = "sun:06:30-sun:07:30"
  deletion_protection             = true
  storage_encrypted               = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name_prefix}-final"
}

resource "aws_rds_cluster_instance" "aurora_instances" {
  count              = var.aurora_instances
  identifier         = "${local.name_prefix}-aurora-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = var.aurora_instance_class
  engine             = aws_rds_cluster.aurora.engine
  engine_version     = aws_rds_cluster.aurora.engine_version
}
