output "alb_dns_name" {
  value       = aws_lb.api.dns_name
  description = "Public DNS for API ALB."
}

output "aurora_endpoint" {
  value       = aws_rds_cluster.aurora.endpoint
  description = "Aurora writer endpoint."
}

output "artifacts_bucket" {
  value       = aws_s3_bucket.artifacts.bucket
  description = "S3 bucket used for artifact attachments."
}

output "search_index_queue_url" {
  value       = aws_sqs_queue.search_index_updates.id
  description = "Queue URL for case-api -> search-api indexing events."
}

output "ecr_case_api" {
  value       = aws_ecr_repository.case_api.repository_url
  description = "ECR repo URL for case-api image."
}

output "ecr_search_api" {
  value       = aws_ecr_repository.search_api.repository_url
  description = "ECR repo URL for search-api image."
}
