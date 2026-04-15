variable "aws_region" {
  description = "AWS region for all infrastructure."
  type        = string
  default     = "us-west-1"
}

variable "project_name" {
  description = "Project slug used in resource names."
  type        = string
  default     = "mangoos"
}

variable "environment" {
  description = "Environment name (dev/staging/prod)."
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  description = "CIDR range for the VPC."
  type        = string
  default     = "10.30.0.0/16"
}

variable "az_count" {
  description = "How many AZs/subnet pairs to create."
  type        = number
  default     = 2
}

variable "container_port" {
  description = "Port both services expose inside containers."
  type        = number
  default     = 8080
}

variable "case_api_image" {
  description = "Container image URI for case-api service."
  type        = string
}

variable "search_api_image" {
  description = "Container image URI for search-api service."
  type        = string
}

variable "case_api_cpu" {
  type    = number
  default = 512
}

variable "case_api_memory" {
  type    = number
  default = 1024
}

variable "search_api_cpu" {
  type    = number
  default = 512
}

variable "search_api_memory" {
  type    = number
  default = 1024
}

variable "case_api_desired_count" {
  type    = number
  default = 2
}

variable "search_api_desired_count" {
  type    = number
  default = 2
}

variable "aurora_database_name" {
  description = "Initial Aurora database name."
  type        = string
  default     = "mangoos"
}

variable "create_aurora" {
  description = "Whether Terraform should create a new Aurora cluster. Set false to reuse an existing cluster."
  type        = bool
  default     = true
}

variable "aurora_master_username" {
  description = "Aurora cluster master username."
  type        = string
  default     = "mango_admin"
}

variable "aurora_master_password" {
  description = "Aurora cluster master password."
  type        = string
  sensitive   = true
  default     = null
}

variable "aurora_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "aurora_instances" {
  type    = number
  default = 2
}

variable "existing_db_host" {
  description = "Existing Aurora writer endpoint when create_aurora=false."
  type        = string
  default     = null
}

variable "existing_db_port" {
  description = "Existing Aurora port when create_aurora=false."
  type        = number
  default     = 5432
}

variable "existing_db_name" {
  description = "Existing Aurora database name when create_aurora=false."
  type        = string
  default     = null
}

variable "existing_db_user" {
  description = "Existing Aurora DB username when create_aurora=false."
  type        = string
  default     = null
}

variable "existing_db_password_secret_arn" {
  description = "Secrets Manager secret ARN containing DB password when create_aurora=false."
  type        = string
  default     = null
}

variable "existing_db_security_group_id" {
  description = "Security group ID attached to existing Aurora cluster; used to allow ECS ingress when create_aurora=false."
  type        = string
  default     = null
}

variable "extra_tags" {
  description = "Additional project tags."
  type        = map(string)
  default     = {}
}
