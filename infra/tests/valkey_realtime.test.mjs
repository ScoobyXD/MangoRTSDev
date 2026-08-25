import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const valkey = read("infra/modules/mangorts-platform/realtime_valkey.tf");
const task = read("infra/modules/mangorts-platform/ecs_alb.tf");
const iam = read("infra/modules/mangorts-platform/iam.tf");
const moduleLocals = read("infra/modules/mangorts-platform/locals.tf");
const devMain = read("infra/aws-dev/main.tf");
const devVariables = read("infra/aws-dev/variables.tf");

test("dev realtime backplane is private TLS Valkey with IAM auth and bounded capacity", () => {
  assert.match(valkey, /resource "aws_elasticache_serverless_cache" "realtime"/);
  assert.match(valkey, /engine\s*=\s*"valkey"/);
  assert.match(valkey, /subnet_ids\s*=\s*local\.ecs_subnet_ids/);
  assert.match(valkey, /security_group_ids\s*=\s*\[aws_security_group\.realtime_valkey\[0\]\.id\]/);
  assert.match(valkey, /ingress\s*\{[\s\S]*?from_port\s*=\s*6379[\s\S]*?to_port\s*=\s*6380[\s\S]*?protocol\s*=\s*"tcp"[\s\S]*?security_groups\s*=\s*\[aws_security_group\.ecs\.id\]/);
  assert.doesNotMatch(valkey, /cidr_blocks\s*=|0\.0\.0\.0\/0/);
  assert.match(valkey, /authentication_mode\s*\{\s*type\s*=\s*"iam"/s);
  assert.match(valkey, /condition\s*=\s*local\.nonproduction_services_environment/);
  assert.match(moduleLocals, /nonproduction_services_environment\s*=\s*contains\(\["dev", "qa"\], var\.environment\)/);
  assert.match(valkey, /cache_usage_limits\s*\{[\s\S]*data_storage[\s\S]*ecpu_per_second/);
});

test("runtime access is exact cache/user connect plus an exact Pub/Sub channel", () => {
  assert.match(valkey, /actions\s*=\s*\["elasticache:Connect"\]/);
  assert.match(valkey, /aws_elasticache_serverless_cache\.realtime\[0\]\.arn/);
  assert.match(valkey, /aws_elasticache_user\.realtime\[0\]\.arn/);
  assert.match(valkey, /variable\s*=\s*"aws:SourceVpc"/);
  assert.match(
    valkey,
    /access_string\s*=\s*"on ~\* resetchannels &\$\{var\.realtime_valkey_channel\} -@all \+@connection \+cluster\|slots \+cluster\|shards \+@pubsub"/,
  );
  assert.doesNotMatch(valkey, /\+@all\b/);
  assert.doesNotMatch(valkey, /\+(?:publish|subscribe|unsubscribe)\b/);
  assert.doesNotMatch(valkey, /password|no-password-required/i);
});

test("ECS receives non-secret Valkey coordinates and no cache credential", () => {
  for (const name of [
    "MANGORTS_VALKEY_REQUIRED",
    "MANGORTS_VALKEY_ENDPOINT",
    "MANGORTS_VALKEY_REGION",
    "MANGORTS_VALKEY_CACHE_NAME",
    "MANGORTS_VALKEY_USER_ID",
    "MANGORTS_VALKEY_CHANNEL",
  ]) {
    assert.match(task, new RegExp(name));
  }
  assert.doesNotMatch(task, /MANGORTS_VALKEY_(PASSWORD|TOKEN|SECRET)/);
  assert.match(task, /MANGORTS_VALKEY_REQUIRED", value = "true"/);
  assert.match(task, /resource "aws_ecs_task_definition" "backend"[\s\S]*depends_on\s*=\s*\[[\s\S]*aws_iam_role_policy_attachment\.ecs_task_realtime_valkey/);
  assert.match(task, /resource "aws_ecs_service" "backend"[\s\S]*aws_iam_role_policy_attachment\.ecs_task_realtime_valkey/);
  assert.match(iam, /"elasticache:CreateServerlessCache"/);
  assert.match(iam, /"elasticache:ModifyUserGroup"/);
  assert.match(iam, /"cloudwatch:PutMetricAlarm"/);
  assert.match(iam, /"ec2:CreateSecurityGroup"/);
  assert.match(iam, /"ec2:DeleteSecurityGroup"/);
  assert.match(iam, /"ec2:CreateVpcEndpoint"/);
  assert.match(iam, /"ec2:DeleteVpcEndpoints"/);
  assert.match(valkey, /resource "aws_security_group" "realtime_valkey"\s*\{[\s\S]*?depends_on\s*=\s*\[aws_iam_role_policy_attachment\.github_deploy\][\s\S]*?name\s*=/);
  assert.match(valkey, /resource "aws_elasticache_user" "realtime"\s*\{[\s\S]*?depends_on\s*=\s*\[aws_iam_role_policy_attachment\.github_deploy\][\s\S]*?user_id\s*=/);
  assert.equal((valkey.match(/depends_on\s*=\s*\[aws_iam_role_policy_attachment\.github_deploy\]/g) ?? []).length, 2);
  assert.match(task, /ALLOW_INMEMORY_FALLBACK", value = "false"/);
  assert.doesNotMatch(iam, /"(?:elasticache|cloudwatch):\*"/);
});

test("serverless alarms use the required clusterId dimension", () => {
  for (const alarm of [
    "realtime_valkey_no_connections",
    "realtime_valkey_auth_failures",
    "realtime_valkey_command_authorization_failures",
    "realtime_valkey_write_latency",
    "realtime_valkey_throttled",
    "realtime_valkey_ecpu_capacity",
  ]) {
    assert.match(valkey, new RegExp(`resource "aws_cloudwatch_metric_alarm" "${alarm}"`));
  }
  assert.match(
    valkey,
    /resource "aws_cloudwatch_metric_alarm" "realtime_valkey_command_authorization_failures"\s*\{[\s\S]*?count\s*=\s*var\.realtime_valkey_enabled && var\.cloudwatch_alarms_enabled \? 1 : 0[\s\S]*?metric_name\s*=\s*"CommandAuthorizationFailures"[\s\S]*?alarm_actions\s*=\s*var\.realtime_valkey_alarm_action_arns[\s\S]*?clusterId\s*=\s*aws_elasticache_serverless_cache\.realtime\[0\]\.name[\s\S]*?\n\}/,
  );
  assert.equal((valkey.match(/clusterId\s*=\s*aws_elasticache_serverless_cache\.realtime\[0\]\.name/g) ?? []).length, 6);
});

test("the dev root enables and wires the backplane explicitly", () => {
  assert.match(devVariables, /variable "realtime_valkey_enabled"[\s\S]*default\s*=\s*true/);
  assert.match(devMain, /realtime_valkey_enabled\s*=\s*var\.realtime_valkey_enabled/);
  assert.doesNotMatch(devMain + devVariables, /mangorts-prod|infra\/aws-prod/);
});
