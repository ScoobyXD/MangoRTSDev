import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const modulePath = "infra/modules/mangorts-platform";
const locals = read(`${modulePath}/locals.tf`);
const ecs = read(`${modulePath}/ecs_alb.tf`);
const iam = read(`${modulePath}/iam.tf`);
const devWorkflow = read(".github/workflows/deploy-dev.yml");

test("dictation has one optional dev secret independent of the removed agent", () => {
  for (const path of ["infra/aws-dev/variables.tf", `${modulePath}/variables.tf`]) {
    assert.match(read(path), /variable "deepgram_api_key_secret_arn" \{[^}]*type\s*=\s*string[^}]*default\s*=\s*""/);
  }
  assert.match(read("infra/aws-dev/main.tf"), /deepgram_api_key_secret_arn\s*=\s*var\.deepgram_api_key_secret_arn/);
  assert.match(read("infra/aws-dev/terraform.tfvars.example"), /deepgram_api_key_secret_arn\s*=\s*""/);
  assert.match(locals, /dictation_enabled\s*=\s*var\.environment == "dev" && trimspace\(var\.deepgram_api_key_secret_arn\) != ""/);
  assert.match(ecs, /condition\s*=\s*trimspace\(var\.deepgram_api_key_secret_arn\) == "" \|\| var\.environment == "dev"/);
  assert.doesNotMatch([locals, ecs, iam, devWorkflow].join("\n"), /assistant_model|assistant_enabled|ai\/runtime|MANGORTS_PI/i);
});

test("ECS injects the key as a secret and grants only the configured secret ARN", () => {
  assert.match(ecs, /secrets = concat\([\s\S]*?local\.dictation_enabled \? \[\s*\{ name = "DEEPGRAM_API_KEY", valueFrom = trimspace\(var\.deepgram_api_key_secret_arn\) \}\s*\] : \[\]/);
  const environment = ecs.match(/environment = concat\([\s\S]*?\n\s*secrets =/)?.[0] ?? "";
  assert.doesNotMatch(environment, /DEEPGRAM/);
  const secretPolicy = iam.match(/data "aws_iam_policy_document" "ecs_execution_secrets" \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(secretPolicy, /actions = \["secretsmanager:GetSecretValue"\]/);
  assert.match(secretPolicy, /local\.dictation_enabled \? trimspace\(var\.deepgram_api_key_secret_arn\) : ""/);
  assert.doesNotMatch(secretPolicy, /\*/);
  assert.doesNotMatch(read(`${modulePath}/email_sqs.tf`), /DEEPGRAM|deepgram_api_key_secret_arn/);
  assert.doesNotMatch(read(`${modulePath}/attachment_maintenance.tf`), /DEEPGRAM|deepgram_api_key_secret_arn/);
});

test("the dev workflow passes an optional ARN without reading or creating the key", () => {
  assert.match(devWorkflow, /TF_DEEPGRAM_API_KEY_SECRET_ARN: \$\{\{ vars\.TF_DEEPGRAM_API_KEY_SECRET_ARN \|\| '' \}\}/);
  assert.ok(devWorkflow.includes('deepgram_api_key_secret_arn = $(json_string "$TF_DEEPGRAM_API_KEY_SECRET_ARN")'));
  assert.doesNotMatch(devWorkflow, /TF_DEEPGRAM_API_KEY_SECRET_ARN:\?/);
  assert.doesNotMatch(devWorkflow, /secretsmanager (?:get-secret-value|create-secret|put-secret-value)/);
  assert.doesNotMatch(read("infra/aws-qa/main.tf"), /deepgram/i);
  assert.doesNotMatch(read("infra/aws-prod/ecs_alb.tf"), /deepgram/i);
  for (const environment of ["qa", "prod"]) {
    assert.doesNotMatch(read(`infra/aws-${environment}/variables.tf`), /deepgram/i);
    assert.doesNotMatch(read(`.github/workflows/deploy-${environment}.yml`), /deepgram/i);
  }
});
