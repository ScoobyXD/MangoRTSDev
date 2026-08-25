moved {
  from = module.platform.data.aws_route53_zone.root
  to   = data.aws_route53_zone.root
}

moved {
  from = aws_acm_certificate.cloudfront
  to   = module.platform.aws_acm_certificate.cloudfront
}

moved {
  from = aws_route53_record.cloudfront_cert_validation
  to   = module.platform.aws_route53_record.cloudfront_cert_validation
}

moved {
  from = aws_acm_certificate_validation.cloudfront
  to   = module.platform.aws_acm_certificate_validation.cloudfront
}

moved {
  from = aws_acm_certificate.alb
  to   = module.platform.aws_acm_certificate.alb
}

moved {
  from = aws_route53_record.alb_cert_validation
  to   = module.platform.aws_route53_record.alb_cert_validation
}

moved {
  from = aws_acm_certificate_validation.alb
  to   = module.platform.aws_acm_certificate_validation.alb
}

moved {
  from = aws_s3_bucket.frontend
  to   = module.platform.aws_s3_bucket.frontend
}

moved {
  from = aws_s3_bucket_public_access_block.frontend
  to   = module.platform.aws_s3_bucket_public_access_block.frontend
}

moved {
  from = aws_s3_bucket_versioning.frontend
  to   = module.platform.aws_s3_bucket_versioning.frontend
}

moved {
  from = aws_s3_bucket_server_side_encryption_configuration.frontend
  to   = module.platform.aws_s3_bucket_server_side_encryption_configuration.frontend
}

moved {
  from = aws_cloudfront_origin_access_control.frontend
  to   = module.platform.aws_cloudfront_origin_access_control.frontend
}

moved {
  from = aws_cloudfront_function.basic_auth
  to   = module.platform.aws_cloudfront_function.basic_auth
}

moved {
  from = aws_cloudfront_distribution.app
  to   = module.platform.aws_cloudfront_distribution.app
}

moved {
  from = aws_s3_bucket_policy.frontend
  to   = module.platform.aws_s3_bucket_policy.frontend
}

moved {
  from = aws_cognito_user_pool.main
  to   = module.platform.aws_cognito_user_pool.main
}

moved {
  from = aws_cognito_resource_server.mangorts_api
  to   = module.platform.aws_cognito_resource_server.mangorts_api
}

moved {
  from = aws_cognito_user_pool_client.spa
  to   = module.platform.aws_cognito_user_pool_client.spa
}

moved {
  from = aws_cognito_user_pool_client.machine
  to   = module.platform.aws_cognito_user_pool_client.machine
}

moved {
  from = aws_ecr_repository.backend
  to   = module.platform.aws_ecr_repository.backend
}

moved {
  from = aws_ecr_lifecycle_policy.backend
  to   = module.platform.aws_ecr_lifecycle_policy.backend
}

moved {
  from = aws_cloudwatch_log_group.backend
  to   = module.platform.aws_cloudwatch_log_group.backend
}

moved {
  from = aws_lb.api
  to   = module.platform.aws_lb.api
}

moved {
  from = aws_lb_target_group.backend
  to   = module.platform.aws_lb_target_group.backend
}

moved {
  from = aws_lb_listener.https
  to   = module.platform.aws_lb_listener.https
}

moved {
  from = aws_lb_listener_rule.cloudfront_to_backend
  to   = module.platform.aws_lb_listener_rule.cloudfront_to_backend
}

moved {
  from = aws_ecs_cluster.main
  to   = module.platform.aws_ecs_cluster.main
}

moved {
  from = aws_ecs_task_definition.backend
  to   = module.platform.aws_ecs_task_definition.backend
}

moved {
  from = aws_ecs_service.backend
  to   = module.platform.aws_ecs_service.backend
}

moved {
  from = aws_iam_role.ecs_task_execution
  to   = module.platform.aws_iam_role.ecs_task_execution
}

moved {
  from = aws_iam_role_policy_attachment.ecs_execution
  to   = module.platform.aws_iam_role_policy_attachment.ecs_execution
}

moved {
  from = aws_iam_policy.ecs_execution_secrets
  to   = module.platform.aws_iam_policy.ecs_execution_secrets
}

moved {
  from = aws_iam_role_policy_attachment.ecs_execution_secrets
  to   = module.platform.aws_iam_role_policy_attachment.ecs_execution_secrets
}

moved {
  from = aws_iam_role.ecs_task
  to   = module.platform.aws_iam_role.ecs_task
}

moved {
  from = aws_iam_policy.ecs_task_cognito
  to   = module.platform.aws_iam_policy.ecs_task_cognito
}

moved {
  from = aws_iam_role_policy_attachment.ecs_task_cognito
  to   = module.platform.aws_iam_role_policy_attachment.ecs_task_cognito
}

moved {
  from = aws_iam_openid_connect_provider.github
  to   = module.platform.aws_iam_openid_connect_provider.github[0]
}

moved {
  from = aws_iam_role.github_deploy
  to   = module.platform.aws_iam_role.github_deploy
}

moved {
  from = aws_iam_policy.github_deploy
  to   = module.platform.aws_iam_policy.github_deploy
}

moved {
  from = aws_iam_role_policy_attachment.github_deploy
  to   = module.platform.aws_iam_role_policy_attachment.github_deploy
}

moved {
  from = aws_subnet.ecs_private
  to   = module.platform.aws_subnet.ecs_private
}

moved {
  from = aws_eip.ecs_nat
  to   = module.platform.aws_eip.ecs_nat
}

moved {
  from = aws_nat_gateway.ecs
  to   = module.platform.aws_nat_gateway.ecs
}

moved {
  from = aws_route_table.ecs_private
  to   = module.platform.aws_route_table.ecs_private
}

moved {
  from = aws_route.ecs_private_nat
  to   = module.platform.aws_route.ecs_private_nat
}

moved {
  from = aws_route_table_association.ecs_private
  to   = module.platform.aws_route_table_association.ecs_private
}

moved {
  from = aws_route53_record.origin
  to   = module.platform.aws_route53_record.origin
}

moved {
  from = aws_route53_record.app
  to   = module.platform.aws_route53_record.app
}

moved {
  from = aws_route53_record.api
  to   = module.platform.aws_route53_record.api
}

moved {
  from = aws_security_group.alb
  to   = module.platform.aws_security_group.alb
}

moved {
  from = aws_security_group.ecs
  to   = module.platform.aws_security_group.ecs
}

moved {
  from = aws_security_group_rule.ecs_to_existing_db
  to   = module.platform.aws_security_group_rule.ecs_to_existing_db
}

moved {
  from = aws_wafv2_web_acl.cloudfront
  to   = module.platform.aws_wafv2_web_acl.cloudfront
}
