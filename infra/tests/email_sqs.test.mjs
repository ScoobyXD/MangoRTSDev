import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const sqs = read("infra/modules/mangorts-platform/email_sqs.tf");
const task = read("infra/modules/mangorts-platform/ecs_alb.tf");
const iam = read("infra/modules/mangorts-platform/iam.tf");
const moduleVariables = read("infra/modules/mangorts-platform/variables.tf");
const moduleLocals = read("infra/modules/mangorts-platform/locals.tf");
const devMain = read("infra/aws-dev/main.tf");
const devVariables = read("infra/aws-dev/variables.tf");
const devWorkflow = read(".github/workflows/deploy-dev.yml");
const localBackend = read("scripts/start_local_cognito_backend.ps1");
const apiMain = read("backend/cmd/miraeopus-api/main.go");

test("DEV email work queue and work DLQ are encrypted FIFO with fixed SQS delivery", () => {
  for (const queue of ["email_work", "email_work_dlq"]) {
    assert.match(sqs, new RegExp(`resource "aws_sqs_queue" "${queue}"[\\s\\S]*?fifo_queue\\s*=\\s*true`));
    assert.match(sqs, new RegExp(`resource "aws_sqs_queue" "${queue}"[\\s\\S]*?content_based_deduplication\\s*=\\s*true`));
    assert.match(sqs, new RegExp(`resource "aws_sqs_queue" "${queue}"[\\s\\S]*?sqs_managed_sse_enabled\\s*=\\s*true`));
  }
  assert.match(sqs, /visibility_timeout_seconds\s*=\s*600/);
  assert.match(sqs, /receive_wait_time_seconds\s*=\s*20/);
  assert.match(sqs, /maxReceiveCount\s*=\s*3/);
  assert.doesNotMatch(sqs + task, /ChangeMessageVisibility/);
});

test("worker is one private task with independent health and bounded concurrency", () => {
  assert.match(sqs, /resource "aws_ecs_service" "email_worker"[\s\S]*?desired_count\s*=\s*var\.deployment_maintenance_mode \? 0 : 1/);
  assert.match(sqs, /resource "aws_ecs_service" "email_worker"[\s\S]*?wait_for_steady_state\s*=\s*true/);
  assert.match(sqs, /assign_public_ip\s*=\s*false/);
  assert.doesNotMatch(sqs, /load_balancer\s*\{/);
  assert.match(sqs, /MANGORTS_RUNTIME_ROLE", value = "email-worker"/);
	assert.match(sqs, /MANGORTS_EMAIL_WORKER_CONCURRENCY/);
	assert.match(sqs, /AUTH_MODE", value = "disabled"/);
	assert.doesNotMatch(sqs, /NYLAS_STATE_SECRET|NYLAS_WEBHOOK_SECRET/);
	assert.match(sqs, /execution_role_arn\s*=\s*aws_iam_role\.email_worker_execution\[0\]\.arn/);
	assert.match(iam, /data "aws_iam_policy_document" "email_worker_execution_secrets"[\s\S]*?local\.db_password_secret_arn,[\s\S]*?var\.nylas_api_key_secret_arn/);
	assert.doesNotMatch(iam.match(/data "aws_iam_policy_document" "email_worker_execution_secrets"[\s\S]*?\n\}/)?.[0] ?? "", /nylas_state|nylas_webhook/i);
	const workerRuntimePolicy = sqs.match(/data "aws_iam_policy_document" "email_worker_sqs"[\s\S]*?\n\}/)?.[0] ?? "";
	assert.doesNotMatch(workerRuntimePolicy, /GetQueueAttributes/);
  assert.match(sqs, /metric_name\s*=\s*"RunningTaskCount"/);
  assert.doesNotMatch(sqs, /healthCheck|health_check/);
});

test("scheduler uses stable control group, bounded retries, and its own encrypted Standard DLQ", () => {
  assert.match(sqs, /schedule_expression\s*=\s*"rate\(10 minutes\)"/);
  assert.match(sqs, /message_group_id\s*=\s*local\.email_reconciliation_group/);
  assert.match(sqs, /email_reconciliation_group\s*=\s*"reconciliation-control"/);
  assert.match(sqs, /<aws\.scheduler\.scheduled-time>/);
  assert.match(sqs, /maximum_retry_attempts\s*=\s*2/);
  assert.match(sqs, /maximum_event_age_in_seconds\s*=\s*300/);
  assert.match(sqs, /variable\s*=\s*"aws:SourceAccount"/);
  assert.match(sqs, /variable\s*=\s*"aws:SourceArn"/);
	assert.match(sqs, /resource "aws_scheduler_schedule_group" "email_reconciliation"/);
	assert.match(sqs, /email_schedule_group_arn\s*=\s*"arn:[^"]+:schedule-group\/\$\{local\.email_schedule_group_name\}"/);
	assert.match(sqs, /variable\s*=\s*"aws:SourceArn"[\s\S]*?local\.email_schedule_group_arn/);
	assert.doesNotMatch(sqs, /schedule\/default\//);
	assert.match(sqs, /group_name\s*=\s*aws_scheduler_schedule_group\.email_reconciliation\[0\]\.name/);
	assert.match(sqs, /resource "aws_scheduler_schedule" "email_reconciliation"[\s\S]*?depends_on = \[aws_iam_role_policy_attachment\.email_reconciliation_scheduler\]/);
  assert.match(sqs, /resource "aws_sqs_queue" "email_scheduler_dlq"[\s\S]*?sqs_managed_sse_enabled\s*=\s*true/);
  assert.doesNotMatch(sqs.match(/resource "aws_sqs_queue" "email_scheduler_dlq"[\s\S]*?\n\}/)?.[0] ?? "", /fifo_queue/);
});

test("normal DEV deploy runs the queues and one worker while reconciliation stays off", () => {
  assert.match(devVariables, /variable "email_sqs_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(devVariables, /variable "email_worker_enabled"[\s\S]*?default\s*=\s*true/);
  assert.match(devVariables, /variable "email_sqs_database_migration_complete"[\s\S]*?default\s*=\s*true/);
  assert.match(devVariables, /variable "email_reconciliation_schedule_enabled"[\s\S]*?default\s*=\s*false/);
  assert.match(moduleVariables, /variable "email_sqs_enabled"[\s\S]*?default\s*=\s*false/);
  assert.match(devMain, /email_worker_enabled\s*=\s*var\.email_worker_enabled/);
	assert.match(devMain, /email_sqs_database_migration_complete\s*=\s*var\.email_sqs_database_migration_complete/);
  assert.match(task, /MANGORTS_RUNTIME_ROLE", value = "api"/);
  assert.match(task, /MANGORTS_EMAIL_WORK_QUEUE_URL/);
  assert.match(sqs, /data "aws_iam_policy_document" "github_deploy_email_sqs"[\s\S]*?var\.environment == "dev" && var\.email_sqs_enabled/);
	assert.doesNotMatch(sqs + iam, /"scheduler:\*"|"sqs:\*"/);
	const deployPolicy = sqs.match(/data "aws_iam_policy_document" "github_deploy_email_sqs"[\s\S]*?\n\}/)?.[0] ?? "";
	assert.match(deployPolicy, /ManageExactEnvironmentEmailQueues[\s\S]*?local\.email_work_queue_arn[\s\S]*?local\.email_work_dlq_arn[\s\S]*?local\.email_scheduler_dlq_arn/);
	assert.match(deployPolicy, /ManageExactEnvironmentEmailSchedule[\s\S]*?resources = \[local\.email_schedule_arn\]/);
	assert.match(deployPolicy, /ManageExactEnvironmentEmailScheduleGroup[\s\S]*?resources = \[local\.email_schedule_group_arn\]/);
	assert.equal([...deployPolicy.matchAll(/resources = \["\*"\]/g)].length, 2, "only read-only collection actions may use wildcard resources");
	assert.match(deployPolicy, /ReadQueueNames[\s\S]*?sqs:ListQueues/);
	assert.match(deployPolicy, /ReadSchedulerCollections[\s\S]*?scheduler:ListScheduleGroups[\s\S]*?scheduler:ListSchedules/);
  assert.match(sqs, /resource "aws_sqs_queue" "email_work_dlq"[\s\S]*?depends_on = \[aws_iam_role_policy_attachment\.github_deploy_email_sqs\]/);
});

test("cloud-integrated local backend reuses the deployed DEV queue", () => {
  assert.match(localBackend, /Get-ContainerEnvironmentValue -Container \$backendContainer -Name "MANGORTS_EMAIL_WORK_QUEUE_URL"/);
  assert.match(localBackend, /\$env:MANGORTS_EMAIL_WORK_QUEUE_URL = \$emailWorkQueueURL/);
  assert.match(localBackend, /throw "The deployed DEV backend task does not provide MANGORTS_EMAIL_WORK_QUEUE_URL/);
  assert.doesNotMatch(localBackend, /First-NonBlank @\(\s*\$env:MANGORTS_EMAIL_WORK_QUEUE_URL/);
  assert.match(localBackend, /Unable to list the deployed DEV backend task definition/);
  assert.match(localBackend, /Unable to read the deployed DEV backend task definition/);
  assert.doesNotMatch(localBackend, /MANGORTS_EMAIL_WORK_QUEUE_URL\s*=\s*"https:\/\//);
});

test("API represents a missing concrete SQS client as a nil sender", () => {
  assert.match(apiMain, /var emailQueueSender emailqueue\.Sender/);
  assert.match(apiMain, /if emailSQS != nil \{\s*emailQueueSender = emailSQS\s*\}/);
  assert.match(apiMain, /EmailQueue:\s+emailQueueSender/);
  assert.doesNotMatch(apiMain, /EmailQueue:\s+emailSQS/);
});

test("worker and schedule cannot enable before final schema and external dependencies", () => {
	assert.match(moduleVariables, /variable "email_sqs_database_migration_complete"[\s\S]*?default\s*=\s*false/);
	assert.match(sqs, /local\.email_worker_dependencies_configured/);
	assert.doesNotMatch(moduleLocals, /length\(var\.email_worker_alarm_action_arns\) > 0/);
	assert.match(sqs, /var\.email_worker_enabled && local\.email_worker_dependencies_configured/);
	assert.match(task, /!var\.email_worker_enabled[\s\S]*?var\.email_sqs_enabled[\s\S]*?local\.backend_service_enabled[\s\S]*?local\.email_worker_dependencies_configured/);
	assert.match(task, /!var\.email_reconciliation_schedule_enabled[\s\S]*?var\.email_worker_enabled[\s\S]*?local\.backend_service_enabled/);
});

test("Terraform blocks every nonzero SQS-enabled API until migration is complete", () => {
	assert.match(task, /var\.email_sqs_enabled[\s\S]*?var\.backend_desired_count > 0[\s\S]*?var\.email_sqs_database_migration_complete/);
	assert.match(task, /A nonzero SQS-enabled API desired count requires email_sqs_database_migration_complete=true/);
	assert.doesNotMatch(task, /requires at least one email alarm action ARN/);
});

test("Terraform waits for the DEV backend rollout to become steady", () => {
	assert.match(task, /resource "aws_ecs_service" "backend"[\s\S]*?wait_for_steady_state\s*=\s*true/);
});

test("DEV workflow is one normal input-free deployment", () => {
	assert.match(devWorkflow, /workflow_dispatch:\s*\n\s*\npermissions:/);
	assert.doesNotMatch(devWorkflow, /inputs\.|reviewed_plan_run_id|infrastructure-api|worker-only|schedule-only/);
	assert.match(devWorkflow, /API_DESIRED_COUNT: "1"/);
	assert.match(devWorkflow, /EMAIL_SCHEMA_MIGRATED: "true"/);
	assert.match(devWorkflow, /EMAIL_WORKER_ENABLED: "true"/);
	assert.match(devWorkflow, /EMAIL_SCHEDULE_ENABLED: "false"/);
	assert.doesNotMatch(devWorkflow, /environment:\s*development/);
	assert.match(devWorkflow, /jobs:\s*\n\s*deploy:\s*\n\s*if: github\.ref == 'refs\/heads\/main'\s*\n\s*runs-on: ubuntu-latest/);
	assert.match(devWorkflow, /terraform plan -out=tfplan/);
	assert.match(devWorkflow, /terraform apply tfplan/);
	assert.doesNotMatch(devWorkflow, /terraform apply -auto-approve/);
	assert.match(devWorkflow, /TF_EMAIL_WORKER_ALARM_ACTION_ARNS/);
	assert.doesNotMatch(devWorkflow, /TF_PLAN_AGE|mangorts-dev-tfplan-ciphertext|actions\/download-artifact/);
	assert.match(devWorkflow, /- name: Build frontend\s*\n\s*working-directory: frontend/);
	assert.match(devWorkflow, /- name: Publish frontend\s*\n\s*run:/);
	assert.match(devWorkflow, /- name: Post-deploy smoke tests\s*\n\s*run:/);
	assert.match(moduleLocals, /var\.environment == "dev" \? \["repo:\$\{var\.github_owner\}\/\$\{var\.github_repository\}:environment:development"\] : \[\]/);
});

test("alarms cover queue age, backlog, both DLQs, and running task count", () => {
  for (const alarm of [
    "email_worker_not_running",
    "email_work_oldest_message",
    "email_work_backlog",
    "email_work_dlq",
    "email_scheduler_dlq",
  ]) {
    assert.match(sqs, new RegExp(`resource "aws_cloudwatch_metric_alarm" "${alarm}"`));
  }
});
