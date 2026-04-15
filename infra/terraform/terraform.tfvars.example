aws_region             = "us-west-1"
project_name           = "mangoos"
environment            = "staging"

case_api_image         = "123456789012.dkr.ecr.us-west-1.amazonaws.com/mangoos-staging-case-api:latest"
search_api_image       = "123456789012.dkr.ecr.us-west-1.amazonaws.com/mangoos-staging-search-api:latest"

aurora_database_name   = "mangoos"
aurora_master_username = "mango_admin"
aurora_master_password = "CHANGE_ME_NOW"

# If you already have Aurora and want to keep it, set create_aurora=false and fill these:
# create_aurora                   = false
# existing_db_host                = "mycluster.cluster-xxxxxxxx.us-west-1.rds.amazonaws.com"
# existing_db_port                = 5432
# existing_db_name                = "mangoos"
# existing_db_user                = "mango_admin"
# existing_db_password_secret_arn = "arn:aws:secretsmanager:us-west-1:123456789012:secret:mango-db-password"
# existing_db_security_group_id   = "sg-0123456789abcdef0"

extra_tags = {
  owner = "you"
  team  = "platform"
}
