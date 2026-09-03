import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const moduleECS = read("infra/modules/mangorts-platform/ecs_alb.tf");
const moduleIAM = read("infra/modules/mangorts-platform/iam.tf");
const moduleEmailSQS = read("infra/modules/mangorts-platform/email_sqs.tf");
const moduleRealtimeValkey = read("infra/modules/mangorts-platform/realtime_valkey.tf");
const moduleLocals = read("infra/modules/mangorts-platform/locals.tf");
const moduleVariables = read("infra/modules/mangorts-platform/variables.tf");
const devMain = read("infra/aws-dev/main.tf");
const devVariables = read("infra/aws-dev/variables.tf");
const devWorkflow = read(".github/workflows/deploy-dev.yml");
const qaWorkflow = read(".github/workflows/deploy-qa.yml");
const prodWorkflow = read(".github/workflows/deploy-prod.yml");

test("DEV assistant configuration stays disabled unless model and secret ARN are both set", () => {
  assert.match(moduleVariables, /variable "assistant_model"[\s\S]*?default\s*=\s*""/);
  assert.match(moduleVariables, /variable "openai_api_key_secret_arn"[\s\S]*?default\s*=\s*""/);
  assert.match(moduleLocals, /assistant_enabled\s*=\s*var\.environment == "dev" && trimspace\(var\.assistant_model\) != "" && trimspace\(var\.openai_api_key_secret_arn\) != ""/);
  const cluster = moduleECS.slice(
    moduleECS.indexOf('resource "aws_ecs_cluster" "main"'),
    moduleECS.indexOf('resource "aws_ecs_task_definition" "backend"'),
  );
  assert.match(cluster, /trimspace\(var\.assistant_model\) == "" && trimspace\(var\.openai_api_key_secret_arn\) == ""/);
  assert.match(cluster, /var\.environment == "dev" && trimspace\(var\.assistant_model\) != "" && trimspace\(var\.openai_api_key_secret_arn\) != ""/);
  assert.match(cluster, /Mango chat may be enabled only in dev, with both assistant_model and openai_api_key_secret_arn set/);
  assert.match(devVariables, /variable "assistant_model"[\s\S]*?default\s*=\s*""/);
  assert.match(devVariables, /variable "openai_api_key_secret_arn"[\s\S]*?default\s*=\s*""/);
  assert.match(devMain, /assistant_model\s*=\s*var\.assistant_model/);
  assert.match(devMain, /openai_api_key_secret_arn\s*=\s*var\.openai_api_key_secret_arn/);
});

test("DEV ECS injects the assistant model and the Secrets Manager value only into the API task", () => {
  assert.match(moduleECS, /local\.assistant_enabled \? \[[\s\S]*?MANGORTS_ASSISTANT_MODEL[\s\S]*?var\.assistant_model/);
  assert.match(moduleECS, /local\.assistant_enabled \? \[[\s\S]*?OPENAI_API_KEY[\s\S]*?var\.openai_api_key_secret_arn/);
  assert.match(moduleIAM, /data "aws_iam_policy_document" "ecs_execution_secrets"[\s\S]*?var\.openai_api_key_secret_arn/);
  assert.match(moduleECS, /resource "aws_ecs_task_definition" "backend"[\s\S]*?depends_on = \[[\s\S]*?aws_iam_role_policy_attachment\.ecs_execution_secrets/);
  assert.doesNotMatch(moduleEmailSQS, /OPENAI_API_KEY|MANGORTS_ASSISTANT_MODEL|openai_api_key_secret_arn/);
  const emailWorkerSecrets = moduleIAM.match(/data "aws_iam_policy_document" "email_worker_execution_secrets"[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(emailWorkerSecrets, /openai_api_key_secret_arn/);
  const taskRolePolicies = moduleIAM.slice(
    moduleIAM.indexOf('data "aws_iam_policy_document" "ecs_task_cognito"'),
    moduleIAM.indexOf('data "aws_iam_policy_document" "github_oidc_assume_role"'),
  ) + moduleEmailSQS + moduleRealtimeValkey;
  assert.doesNotMatch(taskRolePolicies, /openai_api_key_secret_arn/);
  const githubDeployPolicy = moduleIAM.slice(
    moduleIAM.indexOf('data "aws_iam_policy_document" "github_deploy"'),
    moduleIAM.indexOf('resource "aws_iam_policy" "github_deploy"'),
  );
  assert.doesNotMatch(githubDeployPolicy, /openai_api_key_secret_arn/);
});

test("DEV deployment passes only the OpenAI secret ARN through GitHub", () => {
  assert.match(devWorkflow, /TF_ASSISTANT_MODEL: \$\{\{ vars\.TF_ASSISTANT_MODEL \|\| 'gpt-5\.6-luna' \}\}/);
  assert.match(devWorkflow, /TF_OPENAI_API_KEY_SECRET_ARN: \$\{\{ vars\.TF_OPENAI_API_KEY_SECRET_ARN \|\| '' \}\}/);
  assert.match(devWorkflow, /openai_api_key_secret_arn = \$\(json_string "\$TF_OPENAI_API_KEY_SECRET_ARN"\)/);
  assert.doesNotMatch(devWorkflow, /secrets\.OPENAI_API_KEY|secrets\.TF_OPENAI_API_KEY/);
  assert.doesNotMatch(qaWorkflow + prodWorkflow, /TF_ASSISTANT_MODEL|TF_OPENAI_API_KEY_SECRET_ARN/);
});
