import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const maintenance = read("infra/modules/mangorts-platform/attachment_maintenance.tf");
const ecs = read("infra/modules/mangorts-platform/ecs_alb.tf");
const main = read("backend/cmd/miraeopus-api/main.go");
const role = read("backend/cmd/miraeopus-api/attachment_maintenance.go");
const block = (type, name) => maintenance.match(new RegExp(`${type} "${name}"[\\s\\S]*?\n\\}`))?.[0] ?? "";

test("dev and QA share an enabled daily attachment task independent of email services", () => {
  assert.match(maintenance, /attachment_maintenance_enabled\s*=\s*local\.nonproduction_services_environment && local\.backend_service_enabled && local\.attachment_storage_enabled/);
  const schedule = block('resource "aws_cloudwatch_event_rule"', "attachment_maintenance");
  assert.match(schedule, /schedule_expression\s*=\s*"rate\(1 day\)"/);
  assert.match(schedule, /state\s*=\s*"ENABLED"/);
  assert.doesNotMatch(maintenance, /email_worker|email_sqs|aws_sqs_queue|aws_ecs_service|schedule_enabled/);
  for (const env of ["dev", "qa"]) {
    assert.match(read(`infra/aws-${env}/main.tf`), /source\s*=\s*"\.\.\/modules\/mangorts-platform"/);
    assert.match(read(`infra/aws-${env}/main.tf`), /attachment_maintenance_alarm_action_arns\s*=\s*var\.attachment_maintenance_alarm_action_arns/);
    assert.match(read(`infra/aws-${env}/outputs.tf`), /module\.platform\.attachment_maintenance/);
  }
});

test("recovery reuses environment storage and secret selector without HTTP or provider credentials", () => {
  const task = block('resource "aws_ecs_task_definition"', "attachment_maintenance");
  assert.match(task, /image\s*=\s*var\.backend_image_uri/);
  assert.match(task, /valueFrom\s*=\s*local\.db_password_secret_value_from/);
  assert.match(task, /MANGORTS_ATTACHMENT_S3_BUCKET.*var\.attachment_s3_bucket/);
  assert.match(task, /MANGORTS_RUNTIME_ROLE", value = "attachment-maintenance"/);
  assert.match(task, /tags\s*=\s*local\.tags/);
  assert.match(task, /skip_destroy\s*=\s*true/);
  assert.doesNotMatch(task, /NYLAS|COGNITO|OPENAI|VALKEY|portMappings|healthCheck/);
  assert.match(maintenance, /subnets\s*=\s*local\.ecs_subnet_ids/);
  assert.match(maintenance, /security_groups\s*=\s*\[aws_security_group\.ecs\.id\]/);
  assert.match(maintenance, /assign_public_ip\s*=\s*false/);
});

test("recovery enters the shared finite drain before creating any application service", () => {
  assert.ok(main.indexOf('if runtimeRole == "attachment-maintenance"') < main.indexOf("buildRepository()"));
  assert.ok(main.indexOf("runAttachmentMaintenance(") < main.indexOf("buildAssistantConfig("));
  assert.match(main, /time\.AfterFunc\(16\*time\.Minute/);
  assert.match(main, /runAttachmentMaintenance\([\s\S]*?if err != nil \{\s*log\.Fatal\(err\)/);
  assert.equal([...role.matchAll(/attachmentcleanup\.DrainPending\(/g)].length, 1);
  assert.match(role, /context\.WithTimeout\(ctx, 15\*time\.Minute\)/);
  assert.match(role, /MaxItems:\s*10000/);
  assert.match(role, /result\.FailureCount\(\) > 0 \|\| result\.Capped\(\)/);
  assert.doesNotMatch(role, /for\s*\{|NewTicker|time\.Sleep|NextCursor/);
});

test("failed launch, startup, interruption, nonzero exit and missing success have visible alarms", () => {
  assert.match(maintenance, /maximum_event_age_in_seconds\s*=\s*3600/);
  assert.match(maintenance, /maximum_retry_attempts\s*=\s*2/);
  const failure = block('resource "aws_cloudwatch_event_rule"', "attachment_maintenance_failed");
  assert.match(failure, /clusterArn\s*=\s*\[aws_ecs_cluster\.main\.arn\]/);
  assert.match(failure, /taskDefinitionArn\s*=\s*\[\{ prefix = local\.attachment_maintenance_task_arn \}\]/);
  assert.match(failure, /lastStatus\s*=\s*\["STOPPED"\]/);
  assert.match(failure, /"\$or"[\s\S]*?TaskFailedToStart[\s\S]*?UserInitiated[\s\S]*?exitCode = \[\{ "anything-but" = 0 \}\]/);
  assert.match(maintenance, /awslogs-stream-prefix\s*=\s*"attachment-maintenance"/);
  assert.match(maintenance, /resource "aws_cloudwatch_log_group" "attachment_maintenance_failures"/);
  assert.match(block('resource "aws_cloudwatch_metric_alarm"', "attachment_maintenance_delivery_failed"), /metric_name\s*=\s*"FailedInvocations"/);
  assert.match(block('resource "aws_cloudwatch_metric_alarm"', "attachment_maintenance_failed"), /metric_name\s*=\s*"TriggeredRules"/);
  const overdue = block('resource "aws_cloudwatch_metric_alarm"', "attachment_maintenance_overdue");
  assert.match(overdue, /evaluation_periods\s*=\s*26/);
  assert.match(overdue, /treat_missing_data\s*=\s*"breaching"/);
  assert.doesNotMatch(maintenance, /var\.cloudwatch_alarms_enabled/);
});

test("task invocation and failure log delivery use scoped permissions", () => {
  const policy = block('resource "aws_iam_role_policy"', "attachment_maintenance_events");
  assert.match(policy, /Action\s*=\s*"ecs:RunTask"[\s\S]*?Resource\s*=\s*aws_ecs_task_definition\.attachment_maintenance\[0\]\.arn/);
  assert.match(policy, /"ecs:cluster" = aws_ecs_cluster\.main\.arn/);
  assert.match(policy, /"iam:PassedToService" = "ecs-tasks\.amazonaws\.com"/);
  const logPolicy = block('resource "aws_cloudwatch_log_resource_policy"', "attachment_maintenance_failures");
  assert.match(logPolicy, /Action\s*=\s*"logs:CreateLogStream"[\s\S]*?Resource\s*=\s*"\$\{[^}]+\}:\*"/);
  assert.match(logPolicy, /Action\s*=\s*"logs:PutLogEvents"[\s\S]*?Resource\s*=\s*"\$\{[^}]+\}:\*:\*"[\s\S]*?"aws:SourceArn"/);
  assert.doesNotMatch(block('resource "aws_cloudwatch_event_target"', "attachment_maintenance_failures"), /role_arn/);
  assert.doesNotMatch(maintenance, /"(?:ecs|iam|events|logs|cloudwatch):\*"/);
});

test("API release depends on recovery and runbook requires successful bootstrap before timer removal", () => {
  const service = ecs.match(/resource "aws_ecs_service" "backend"[\s\S]*?\n\}/)?.[0] ?? "";
  for (const target of ["aws_cloudwatch_event_target.attachment_maintenance", "aws_cloudwatch_metric_alarm.attachment_maintenance_failed", "aws_cloudwatch_metric_alarm.attachment_maintenance_overdue"]) {
    assert.ok(service.includes(target));
  }
  const runbook = read("docs/infra/attachment-deletion-recovery.md");
  assert.match(runbook, /not deployed recovery/);
  assert.match(runbook, /Keep the existing API and email-worker images running/);
  assert.match(runbook, /require container exit code `0`/);
  assert.match(runbook, /QA email worker may remain disabled/);
});
