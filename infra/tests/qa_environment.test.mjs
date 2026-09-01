import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const devData = read("infra/aws-dev/data.tf");
const devMain = read("infra/aws-dev/main.tf");
const devMoved = read("infra/aws-dev/moved.tf");
const qaMain = read("infra/aws-qa/main.tf");
const qaDNS = read("infra/aws-qa/dns.tf");
const qaDatabase = read("infra/aws-qa/database.tf");
const qaMigration = read("infra/aws-qa/database_migration_task.tf");
const qaMonitoring = read("infra/aws-qa/monitoring.tf");
const qaChecks = read("infra/aws-qa/checks.tf");
const qaIAM = read("infra/aws-qa/iam.tf");
const qaLocals = read("infra/aws-qa/locals.tf");
const qaVariables = read("infra/aws-qa/variables.tf");
const qaVersions = read("infra/aws-qa/versions.tf");
const qaTfvarsExample = read("infra/aws-qa/terraform.tfvars.example");
const qaBackend = read("infra/aws-qa/backend.hcl.example");
const qaWorkflow = read(".github/workflows/deploy-qa.yml");
const qaPreflight = read("scripts/qa_environment_preflight.ps1");
const schemaInventoryExport = read("scripts/export_schema_inventory.ps1");
const schemaAuditRunbook = read("docs/infra/mangorts-schema-audit.md");
const prodQADelegation = read("infra/aws-prod/qa_delegation.tf");
const moduleIAM = read("infra/modules/mangorts-platform/iam.tf");
const moduleACM = read("infra/modules/mangorts-platform/acm.tf");
const moduleData = read("infra/modules/mangorts-platform/data.tf");
const moduleECS = read("infra/modules/mangorts-platform/ecs_alb.tf");
const moduleEmail = read("infra/modules/mangorts-platform/email_sqs.tf");
const moduleCloudFront = read("infra/modules/mangorts-platform/cloudfront_s3.tf");
const moduleLocals = read("infra/modules/mangorts-platform/locals.tf");
const moduleRoute53 = read("infra/modules/mangorts-platform/route53.tf");
const moduleSecurity = read("infra/modules/mangorts-platform/security.tf");
const moduleVariables = read("infra/modules/mangorts-platform/variables.tf");
const sharedDeployPolicy = moduleIAM.slice(
  moduleIAM.indexOf('data "aws_iam_policy_document" "github_deploy"'),
  moduleIAM.indexOf('resource "aws_iam_policy" "github_deploy"'),
);
const qaDeployPolicy = sharedDeployPolicy.slice(
  sharedDeployPolicy.indexOf('"ReadRequiredQAAccountMetadata"'),
);
const qaAccountMetadataPolicy = qaDeployPolicy.slice(
  0,
  qaDeployPolicy.indexOf('"ReadExactQAResources"'),
);
const qaExactReadPolicy = qaDeployPolicy.slice(
  qaDeployPolicy.indexOf('"ReadExactQAResources"'),
  qaDeployPolicy.indexOf('"PassExactQAECSRoles"'),
);
const qaInventoryPolicy = qaDeployPolicy.slice(
  0,
  qaDeployPolicy.indexOf('"PassExactQAECSRoles"'),
);
const qaEcrPolicy = qaDeployPolicy.slice(
  qaDeployPolicy.indexOf('"ManageExactQABackendRepository"'),
  qaDeployPolicy.indexOf('"DeployQAECSTasks"'),
);
const qaRegisterPolicy = qaDeployPolicy.slice(
  qaDeployPolicy.indexOf('"RegisterQAECSTaskDefinitions"'),
  qaDeployPolicy.indexOf('"ManageQADeploymentLogs"'),
);

test("QA reuses the current network but owns a private low-cost PostgreSQL 17 database", () => {
  assert.match(qaMain, /environment\s*=\s*local\.environment/);
  assert.match(qaMain, /create_private_ecs_subnets\s*=\s*false/);
  assert.match(qaMain, /database_connection_mode\s*=\s*"managed"/);
  assert.match(qaDatabase, /engine\s*=\s*"postgres"/);
  assert.match(qaVariables, /variable "database_engine_version"[\s\S]*?default\s*=\s*"17\.7"/);
  assert.match(qaVariables, /variable "database_instance_class"[\s\S]*?default\s*=\s*"db\.t4g\.micro"/);
  assert.match(qaVariables, /variable "database_name"[\s\S]*?default\s*=\s*"mangorts_qa"/);
  assert.match(qaVariables, /variable "default_company_id"[\s\S]*?default_company_id must be a UUID/);
  assert.match(qaDatabase, /multi_az\s*=\s*false/);
  assert.match(qaDatabase, /publicly_accessible\s*=\s*false/);
  assert.match(qaVariables, /variable "database_password_secret_arn"[\s\S]*?default\s*=\s*""/);
  assert.match(qaVariables, /variable "database_managed_password_bootstrap"[\s\S]*?default\s*=\s*false/);
  assert.match(qaDatabase, /manage_master_user_password\s*=\s*var\.database_managed_password_bootstrap/);
  assert.match(qaDatabase, /var\.database_managed_password_bootstrap[\s\S]*?trimspace\(var\.database_password_secret_arn\) == ""[\s\S]*?trimspace\(var\.database_password_secret_arn\) != ""/);
  assert.match(qaDatabase, /ignore_changes\s*=\s*\[manage_master_user_password\]/);
  assert.match(qaDatabase, /length\(self\.master_user_secret\) == 0/);
  assert.match(qaMain, /managed_db_password_secret_arn\s*=\s*var\.database_managed_password_bootstrap/);
  assert.match(qaMain, /managed_db_password_secret_json_key\s*=\s*var\.database_managed_password_bootstrap \? "password" : ""/);
  assert.match(qaWorkflow, /TF_DATABASE_PASSWORD_SECRET_ARN:\s*\$\{\{ vars\.TF_QA_DATABASE_PASSWORD_SECRET_ARN \}\}/);
  assert.match(qaMain, /attachment_s3_bucket\s*=\s*local\.attachment_bucket_name/);
  assert.match(qaMain, /depends_on\s*=\s*\[[\s\S]*?aws_cloudwatch_log_group\.ecs_container_insights_performance[\s\S]*?aws_s3_bucket\.attachments[\s\S]*?\]/);
});

test("QA defaults to the complete base service set with mail processing parked", () => {
  assert.match(qaMain, /email_sqs_enabled\s*=\s*true/);
  assert.match(qaVariables, /variable "realtime_valkey_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(qaVariables, /variable "email_worker_enabled"[\s\S]*?default\s*=\s*false/);
  assert.match(qaVariables, /variable "ecs_container_insights_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(qaVariables, /variable "cloudwatch_alarms_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(qaVariables, /variable "waf_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(qaTfvarsExample, /email_worker_enabled\s*=\s*false/);
  assert.match(qaTfvarsExample, /realtime_valkey_enabled\s*=\s*true/);
  assert.match(qaTfvarsExample, /ecs_container_insights_enabled\s*=\s*true/);
  assert.match(qaTfvarsExample, /cloudwatch_alarms_enabled\s*=\s*true/);
  assert.match(qaTfvarsExample, /waf_enabled\s*=\s*true/);
  assert.match(qaWorkflow, /TF_EMAIL_WORKER_ENABLED:.*\|\| 'false'/);
  assert.match(qaWorkflow, /TF_REALTIME_VALKEY_ENABLED:.*\|\| 'true'/);
  assert.match(qaWorkflow, /TF_ECS_CONTAINER_INSIGHTS_ENABLED:.*\|\| 'true'/);
  assert.match(qaWorkflow, /TF_CLOUDWATCH_ALARMS_ENABLED:.*\|\| 'true'/);
  assert.match(qaWorkflow, /TF_WAF_ENABLED:.*\|\| 'true'/);
  assert.match(
    qaChecks,
    /check "email_worker_dependencies"[\s\S]*?var\.realtime_valkey_enabled[\s\S]*?var\.email_sqs_database_migration_complete[\s\S]*?local\.nylas_core_configured_count == 3[\s\S]*?trimspace\(var\.backend_image_uri\) != ""/,
  );
  assert.match(qaChecks, /email_worker_enabled requires an immutable backend image, Valkey/);
  assert.match(
    qaChecks,
    /check "full_alarms_require_container_insights"[\s\S]*?!var\.cloudwatch_alarms_enabled \|\| var\.ecs_container_insights_enabled/,
  );
  assert.match(qaWorkflow, /The full QA alarm set requires TF_ECS_CONTAINER_INSIGHTS_ENABLED=true/);
  assert.match(qaMonitoring, /count\s*=\s*var\.ecs_container_insights_enabled \? 1 : 0/);
  assert.match(qaMonitoring, /name\s*=\s*"\/aws\/ecs\/containerinsights\/\$\{local\.name_prefix\}-cluster\/performance"/);
  assert.match(qaMonitoring, /retention_in_days\s*=\s*var\.cloudwatch_log_retention_days/);
});

test("QA Nylas sending preserves normal unrestricted recipient behavior", () => {
  assert.doesNotMatch(qaMain, /recipient_allowlist|allowed_recipient/i);
  assert.doesNotMatch(moduleECS, /NYLAS_RECIPIENT_ALLOWLIST|NYLAS_ALLOWED_RECIPIENT/);
  assert.doesNotMatch(qaWorkflow, /NYLAS_ALLOWED_RECIPIENT/);
  assert.match(qaChecks, /nylas_core_is_all_or_none/);
});

test("QA state and deployment identities are isolated", () => {
  assert.match(qaBackend, /key\s*=\s*"mangorts\/qa\/terraform\.tfstate"/);
  assert.match(qaBackend, /use_lockfile\s*=\s*true/);
  assert.match(qaVersions, /required_version\s*=\s*">= 1\.10\.0"/);
  assert.match(qaWorkflow, /terraform_version:\s*1\.15\.7/);
  assert.match(qaWorkflow, /key\s*=\s*"mangorts\/qa\/terraform\.tfstate"/);
  assert.match(qaWorkflow, /use_lockfile\s*=\s*true/);
  assert.doesNotMatch(qaWorkflow, /TF_STATE_KEY/);
  assert.match(qaWorkflow, /environment:\s*qa/);
  assert.match(qaWorkflow, /AWS_QA_DEPLOY_ROLE_ARN/);
  assert.doesNotMatch(qaWorkflow, /AWS_DEV_DEPLOY_ROLE_ARN/);
  assert.match(qaMain, /github_oidc_subjects\s*=\s*\["repo:\$\{var\.github_owner\}\/\$\{var\.github_repository\}:environment:qa"\]/);
  assert.doesNotMatch(qaMain, /ref:refs\/heads|github_branch/);
  assert.doesNotMatch(qaVariables, /variable "github_branch"/);
  assert.doesNotMatch(qaWorkflow, /TF_GITHUB_BRANCH/);
  assert.match(qaIAM, /ManageExactQAStateObjects/);
  assert.match(qaIAM, /\$\{local\.terraform_state_key\}\.tflock/);
});

test("QA project, environment, and DNS names cannot be changed by GitHub variables", () => {
  assert.match(qaLocals, /project_name\s*=\s*"mangorts"/);
  assert.match(qaLocals, /environment\s*=\s*"qa"/);
  assert.match(qaLocals, /root_domain_name\s*=\s*"mangorts\.com"/);
  assert.match(qaLocals, /app_subdomain\s*=\s*"qa"/);
  assert.match(qaLocals, /api_subdomain\s*=\s*"api\.qa"/);
  assert.match(qaLocals, /origin_subdomain\s*=\s*"origin\.qa"/);
  assert.match(qaMain, /project_name\s*=\s*local\.project_name/);
  assert.match(qaMain, /root_domain_name\s*=\s*local\.root_domain_name/);
  assert.match(qaMain, /app_subdomain\s*=\s*local\.app_subdomain/);
  assert.match(qaMain, /api_subdomain\s*=\s*local\.api_subdomain/);
  assert.match(qaMain, /origin_subdomain\s*=\s*local\.origin_subdomain/);
  assert.doesNotMatch(qaVariables, /variable "(?:project_name|root_domain_name|app_subdomain|api_subdomain|origin_subdomain)"/);
  assert.doesNotMatch(qaWorkflow, /TF_(?:ROOT_DOMAIN_NAME|APP_SUBDOMAIN|API_SUBDOMAIN|ORIGIN_SUBDOMAIN)/);
  assert.match(qaChecks, /check "qa_identity_is_hard_locked"/);
  assert.match(qaPreflight, /\[string\]\$PostgresBin/);
  assert.match(qaPreflight, /"aws", "gh", "git", "terraform"/);
  assert.match(qaPreflight, /"psql\.exe", "createdb\.exe", "dropdb\.exe", "pg_dump\.exe", "pg_restore\.exe"/);
});

test("QA cannot inherit repository-level dev Nylas or sender variables", () => {
  for (const name of [
    "EMAIL_FROM_ADDRESS",
    "NYLAS_CLIENT_ID",
    "NYLAS_API_BASE_URL",
    "NYLAS_API_KEY_SECRET_ARN",
    "NYLAS_STATE_SECRET_ARN",
    "NYLAS_WEBHOOK_SECRET_ARN",
    "NYLAS_GOOGLE_SCOPES",
    "NYLAS_MICROSOFT_SCOPES",
  ]) {
    assert.match(qaWorkflow, new RegExp(`vars\\.TF_QA_${name}`));
    assert.doesNotMatch(qaWorkflow, new RegExp(`vars\\.TF_${name}(?![A-Z_])`));
  }
});

test("QA owns a delegated public subdomain without giving automation production DNS access", () => {
  assert.match(qaDNS, /resource "aws_route53_zone" "qa"/);
  assert.match(qaDNS, /name\s*=\s*"\$\{local\.app_subdomain\}\.\$\{local\.root_domain_name\}"/);
  assert.match(qaDNS, /prevent_destroy\s*=\s*true/);
  assert.match(qaMain, /route53_zone_id\s*=\s*aws_route53_zone\.qa\.zone_id/);
  assert.doesNotMatch(qaDNS, /assume_role|provider\s*=|aws\.prod/);
  assert.match(moduleVariables, /variable "route53_zone_id"[\s\S]*?route53_zone_id is required/);
  assert.doesNotMatch(moduleData, /aws_route53_zone/);
  assert.match(moduleLocals, /route53_zone_id\s*=\s*trimspace\(var\.route53_zone_id\)/);
  assert.match(devData, /data "aws_route53_zone" "root"/);
  assert.match(devMain, /route53_zone_id\s*=\s*data\.aws_route53_zone\.root\.zone_id/);
  assert.match(devMoved, /from\s*=\s*module\.platform\.data\.aws_route53_zone\.root[\s\S]*?to\s*=\s*data\.aws_route53_zone\.root/);
  assert.doesNotMatch(moduleACM, /data\.aws_route53_zone\.root\.zone_id/);
  assert.doesNotMatch(moduleRoute53, /data\.aws_route53_zone\.root\.zone_id/);
  assert.equal((moduleACM.match(/zone_id\s*=\s*local\.route53_zone_id/g) || []).length, 2);
  assert.equal((moduleRoute53.match(/zone_id\s*=\s*local\.route53_zone_id/g) || []).length, 3);
  assert.doesNotMatch(qaWorkflow, /TF_(?:ROUTE53|DNS_ZONE|HOSTED_ZONE)/);
});

test("production delegates only qa.mangorts.com to the exact protected QA zone", () => {
  assert.match(prodQADelegation, /resource "aws_route53_record" "qa_delegation"/);
  assert.match(prodQADelegation, /zone_id\s*=\s*data\.aws_route53_zone\.root\.zone_id/);
  assert.match(prodQADelegation, /name\s*=\s*"qa\.\$\{local\.root_domain\}"/);
  assert.match(prodQADelegation, /type\s*=\s*"NS"/);
  assert.match(prodQADelegation, /allow_overwrite\s*=\s*false/);
  assert.match(prodQADelegation, /prevent_destroy\s*=\s*true/);
  assert.match(prodQADelegation, /account_id\s*==\s*"828435022930"/);
  assert.match(prodQADelegation, /zone_id\s*==\s*"Z05521211GBNMIH6SBM5Z"/);
  assert.deepEqual(
    [...prodQADelegation.matchAll(/"(ns-\d+\.awsdns-[\d-]+\.(?:com|net|org|co\.uk))"/g)].map((match) => match[1]),
    [
      "ns-1059.awsdns-04.org",
      "ns-1735.awsdns-24.co.uk",
      "ns-495.awsdns-61.com",
      "ns-736.awsdns-28.net",
    ],
  );
  assert.doesNotMatch(prodQADelegation, /provider\s*=|assume_role|aws\.us_east_1/);
});

test("the shared edge uses the exact AWS-managed CloudFront policy IDs", () => {
  assert.match(moduleLocals, /cloudfront_caching_optimized_policy_id\s*=\s*"658327ea-f89d-4fab-a63d-7e88639e58f6"/);
  assert.match(moduleLocals, /cloudfront_caching_disabled_policy_id\s*=\s*"4135ea2d-6df8-44a3-9df3-4b5a84be39ad"/);
  assert.match(moduleLocals, /cloudfront_all_viewer_except_host_policy_id\s*=\s*"b689b0a8-53d0-40ab-baf2-68738e2966ac"/);
  assert.doesNotMatch(moduleLocals, /413f1609-33d4-4f8c-8d(?:d|f)f-bd6df8fac40f/);
  assert.match(moduleCloudFront, /origin_access_control_id\s*=\s*aws_cloudfront_origin_access_control\.frontend\.id/);
  assert.doesNotMatch(moduleCloudFront, /s3_origin_config\s*\{/);
  assert.match(moduleCloudFront, /code\s*=\s*replace\(<<-JS[\s\S]*?JS\s*,\s*"\\r\\n",\s*"\\n"\)/);
  assert.match(moduleData, /data "aws_ec2_managed_prefix_lists" "cloudfront_origin_facing"/);
  assert.doesNotMatch(moduleData, /data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing"/);
  assert.match(moduleSecurity, /prefix_list_ids\s*=\s*\[one\(data\.aws_ec2_managed_prefix_lists\.cloudfront_origin_facing\.ids\)\]/);
});

test("QA registers immutable migration images before schema bootstrap without starting the app", () => {
  assert.match(
    qaWorkflow,
    /workflow_dispatch:[\s\S]*?stage:[\s\S]*?type: choice[\s\S]*?- bootstrap-images[\s\S]*?- deploy/,
  );
  assert.match(qaWorkflow, /expected_git_commit:[\s\S]*?required:\s*true[\s\S]*?type:\s*string/);
  assert.match(qaWorkflow, /GITHUB_SHA" != "\$EXPECTED_GIT_COMMIT/);
  assert.match(
    qaWorkflow,
    /bootstrap-images\)[\s\S]*?TF_EMAIL_SCHEMA_MIGRATED" != "false"[\s\S]*?EFFECTIVE_BACKEND_DESIRED_COUNT=0[\s\S]*?EFFECTIVE_EMAIL_SCHEMA_MIGRATED=false[\s\S]*?EFFECTIVE_EMAIL_WORKER_ENABLED=false/,
  );
  assert.match(
    qaWorkflow,
    /deploy\)[\s\S]*?TF_EMAIL_SCHEMA_MIGRATED" != "true"[\s\S]*?EFFECTIVE_BACKEND_DESIRED_COUNT=1[\s\S]*?EFFECTIVE_EMAIL_SCHEMA_MIGRATED=true/,
  );
  assert.match(qaWorkflow, /backend_desired_count = \$EFFECTIVE_BACKEND_DESIRED_COUNT/);
  assert.match(qaWorkflow, /email_sqs_database_migration_complete = \$EFFECTIVE_EMAIL_SCHEMA_MIGRATED/);
  assert.match(qaWorkflow, /email_worker_enabled = \$EFFECTIVE_EMAIL_WORKER_ENABLED/);
  assert.match(qaWorkflow, /The reviewed QA foundation must exist before either image workflow stage runs/);
  assert.match(qaWorkflow, /- name: Build frontend\s+if: inputs\.stage == 'deploy'/);
  assert.match(qaWorkflow, /- name: Publish frontend\s+if: inputs\.stage == 'deploy'/);
  assert.match(qaWorkflow, /- name: Post-deploy smoke tests\s+if: inputs\.stage == 'deploy'/);
  assert.match(qaWorkflow, /- name: Bootstrap image summary\s+if: inputs\.stage == 'bootstrap-images'/);
  assert.match(qaWorkflow, /API desired count: 0/);
  assert.match(qaWorkflow, /Email worker: disabled/);
  assert.match(qaWorkflow, /Revision: \$\{GITHUB_SHA\}/);
  assert.match(qaWorkflow, /API image: \$\{IMAGE_URI\}/);
  assert.match(qaWorkflow, /Migration image: \$\{MIGRATION_IMAGE_URI\}/);
  assert.match(qaWorkflow, /terraform plan -refresh=false -out=tfplan/);
});

test("QA exposes exact non-secret operator targets for the one-time copy", () => {
  for (const outputName of [
    "email_work_queue_url",
    "email_work_dlq_url",
    "email_scheduler_dlq_url",
    "realtime_valkey_cache_name",
    "realtime_valkey_user_id",
    "database_user",
  ]) {
    assert.match(qaMain + read("infra/aws-qa/outputs.tf"), new RegExp(`output "${outputName}"`));
  }
});

test("hosted schema exports use a noninteractive read-only libpq credential and TLS", () => {
  assert.match(schemaInventoryExport, /@\("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_SSLMODE", "PGSSLMODE"\)/);
  assert.match(schemaInventoryExport, /\$hasPasswordEnvironment[\s\S]*?\$hasPasswordFileEnvironment/);
  assert.match(schemaInventoryExport, /Test-Path -LiteralPath \$env:PGPASSFILE -PathType Leaf/);
  assert.doesNotMatch(schemaInventoryExport, /Get-Content[^\r\n]*PGPASSFILE/);
  assert.match(schemaInventoryExport, /if \(\$env:PGSSLMODE -cne "require"\)/);
  assert.match(schemaInventoryExport, /"--no-password"/);
  assert.match(schemaInventoryExport, /if \(\$EnvironmentLabel -ieq "dev"\) \{ "dev\(\?:cluster\)\?" \}/);
  assert.match(schemaInventoryExport, /prod\(\?:cluster\)\?/);
  assert.match(schemaAuditRunbook, /\$env:PGSSLMODE = "require"/);
  assert.match(schemaAuditRunbook, /\$env:PGPASSFILE = Join-Path \$env:APPDATA "postgresql\\pgpass\.conf"/);

  const devHostMarker = /(^|[-_/.])dev(?:cluster)?($|[-_/.])/i;
  const qaHostMarker = /(^|[-_/.])qa($|[-_/.])/i;
  const prodHostMarker = /(^|[-_/.])prod(?:cluster)?($|[-_/.])/i;
  assert.match("miraerts-northerncalifornia-devcluster.cluster.example.com", devHostMarker);
  assert.match("miraerts-northerncalifornia-DEV.cluster.example.com", devHostMarker);
  assert.doesNotMatch("miraerts-xdevcluster.cluster.example.com", devHostMarker);
  assert.doesNotMatch("miraerts-devclusterx.cluster.example.com", devHostMarker);
  assert.match("origin.qa.example.com", qaHostMarker);
  assert.doesNotMatch("origin.qa-prodcluster.example.com", devHostMarker);
  assert.match("origin.qa-prod.example.com", prodHostMarker);
  assert.match("origin.qa-prodcluster.example.com", prodHostMarker);
});

test("QA Actions has no RDS access", () => {
  assert.doesNotMatch(qaIAM, /rds:/);
  assert.doesNotMatch(qaDeployPolicy, /rds:/);
  assert.doesNotMatch(moduleIAM, /"rds:\*"/);
  assert.doesNotMatch(sharedDeployPolicy, /secretsmanager:GetSecretValue/);
});

test("QA deploy permissions exclude account-wide IAM, Route53, S3, and WAF mutation", () => {
  assert.match(
    sharedDeployPolicy,
    /for_each\s*=\s*var\.environment == "qa" \? \[\] : \[1\][\s\S]*?"iam:\*"[\s\S]*?"route53:\*"[\s\S]*?"s3:\*"[\s\S]*?"wafv2:\*"/,
  );
  assert.doesNotMatch(qaDeployPolicy, /"(?:iam|route53|s3|wafv2):\*"/);
  assert.doesNotMatch(qaDeployPolicy, /route53:/);
  assert.match(moduleEmail, /data "aws_iam_policy_document" "github_deploy_email_sqs" \{\s+count = var\.environment == "dev"/);
  assert.doesNotMatch(qaIAM, /"(?:iam|route53|s3|wafv2):\*"/);
  assert.doesNotMatch(qaDeployPolicy, /iam:(?:AttachRolePolicy|CreatePolicy|CreateRole|UpdateAssumeRolePolicy)/);
  assert.doesNotMatch(qaDeployPolicy, /cloudwatch:(?:DeleteAlarms|PutMetricAlarm|TagResource|UntagResource)/);
  assert.doesNotMatch(qaDeployPolicy, /cognito-idp:(?:List\*|ListUsers)|iam:(?:Get\*|List\*)|ecs:(?:Describe\*|List\*)|cloudfront:(?:Get\*|List\*)|logs:Get/);
  assert.doesNotMatch(qaExactReadPolicy, /resources\s*=\s*\["\*"\]/);
  assert.deepEqual(
    [...qaAccountMetadataPolicy.matchAll(/"((?:ec2|ecr|ecs|route53|sts):[^"]+)"/g)].map((match) => match[1]),
    [
      "ec2:DescribeManagedPrefixLists",
      "ec2:DescribeSubnets",
      "ecr:GetAuthorizationToken",
      "ecs:DescribeTaskDefinition",
      "sts:GetCallerIdentity",
    ],
  );
  assert.deepEqual([...qaInventoryPolicy.matchAll(/"(ecr:[^"]+)"/g)].map((match) => match[1]), ["ecr:GetAuthorizationToken"]);
  assert.match(qaEcrPolicy, /ecr:BatchGetImage/);
  assert.match(qaEcrPolicy, /resources\s*=\s*\[aws_ecr_repository\.backend\.arn\]/);
  assert.match(qaDeployPolicy, /PassExactQAECSRoles/);
  assert.match(qaDeployPolicy, /role\/\$\{local\.name_prefix\}-ecs-task-execution/);
  assert.match(qaDeployPolicy, /role\/\$\{local\.name_prefix\}-ecs-task/);
  assert.match(qaDeployPolicy, /role\/\$\{local\.name_prefix\}-email-worker-execution/);
  assert.match(qaDeployPolicy, /role\/\$\{local\.name_prefix\}-email-worker/);
  assert.match(qaDeployPolicy, /iam:PassedToService[\s\S]*?ecs-tasks\.amazonaws\.com/);
  assert.match(qaRegisterPolicy, /task-definition\/\$\{local\.name_prefix\}-\*:\*/);
  assert.doesNotMatch(qaRegisterPolicy, /resources\s*=\s*\["\*"\]/);
  assert.match(qaRegisterPolicy, /aws:RequestTag\/environment[\s\S]*?values\s*=\s*\["qa"\]/);
  assert.doesNotMatch(qaDeployPolicy, /ecs:DeregisterTaskDefinition/);
  assert.match(qaDeployPolicy, /log-group:\/ecs\/\$\{local\.name_prefix\}\/\*/);
  assert.match(moduleECS, /resource "aws_ecs_task_definition" "backend"[\s\S]*?tags\s*=\s*local\.tags[\s\S]*?skip_destroy\s*=\s*true/);
  assert.match(moduleEmail, /resource "aws_ecs_task_definition" "email_worker"[\s\S]*?tags\s*=\s*local\.tags[\s\S]*?skip_destroy\s*=\s*true/);
  assert.match(qaMigration, /resource "aws_ecs_task_definition" "database_migration"[\s\S]*?tags\s*=\s*local\.tags[\s\S]*?skip_destroy\s*=\s*true/);
  assert.match(qaDeployPolicy, /resources\s*=\s*\[[\s\S]*?aws_s3_bucket\.frontend\.arn,[\s\S]*?\$\{aws_s3_bucket\.frontend\.arn\}\/\*/);
  assert.doesNotMatch(qaDeployPolicy, /route53:(?:Change|Create|Delete)|wafv2:(?:Create|Delete|Update)/);
});

test("the migration task is defined but never run automatically", () => {
  assert.match(qaMigration, /resource "aws_ecs_task_definition" "database_migration"/);
  assert.match(qaMigration, /command\s*=\s*\["-mode", "audit"\]/);
  assert.match(qaMigration, /valueFrom\s*=\s*var\.database_managed_password_bootstrap \?/);
  assert.match(qaWorkflow, /Dockerfile\.migrations/);
  assert.doesNotMatch(qaWorkflow, /aws ecs run-task|-mode schema|-baseline-migrations/);
});
