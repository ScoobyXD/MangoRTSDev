import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(path, "utf8");
const platform = "infra/modules/mangorts-platform";

test("CtrlLoop is explicitly off in dev and QA and cannot enable without its services", () => {
  for (const path of [platform, "infra/aws-dev", "infra/aws-qa"]) {
    const config = read(`${path}/ctrl_loop.tf`);
    assert.match(config, /variable "ctrl_loop_enabled" \{[^}]*default\s*=\s*false/);
    assert.match(config, /variable "openai_api_key_secret_arn" \{[^}]*default\s*=\s*""/);
  }
  const gate = read(`${platform}/ecs_alb.tf`).match(/condition = !var\.ctrl_loop_enabled \|\| \([\s\S]*?\n\s*\)/)?.[0] ?? "";
  for (const required of ["nonproduction_services_environment", "openai_enabled", "email_worker_service_enabled", "email_worker_dependencies_configured", "nylas_realtime_enabled", "attachment_storage_enabled"]) {
    assert.ok(gate.includes(`local.${required}`), `${required} must gate enablement`);
  }
});

test("OpenAI is an exact execution-role secret, never ordinary task environment data", () => {
  for (const filename of ["ecs_alb.tf", "email_sqs.tf"]) {
    const source = read(`${platform}/${filename}`);
    const environment = source.match(/environment = concat\([\s\S]*?\n\s*secrets =/)?.[0] ?? "";
    assert.doesNotMatch(environment, /OPENAI_API_KEY|openai_api_key_secret_arn/);
    assert.match(source, /name = "OPENAI_API_KEY", valueFrom = trimspace\(var\.openai_api_key_secret_arn\)/);
  }
  const iam = read(`${platform}/iam.tf`);
  for (const role of ["ecs_execution_secrets", "email_worker_execution_secrets"]) {
    const policy = iam.match(new RegExp(`data "aws_iam_policy_document" "${role}" \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.ok(policy.includes("trimspace(var.openai_api_key_secret_arn)"));
    assert.doesNotMatch(policy, /\*/);
  }
  assert.match(read(`${platform}/email_sqs.tf`), /var\.ctrl_loop_enabled && local\.openai_enabled \? \[/);
});

test("QA does not inherit dev enablement or secrets and production has no CtrlLoop wiring", () => {
  const qa = read(".github/workflows/deploy-qa.yml");
  for (const name of ["OPENAI_API_KEY_SECRET_ARN", "CTRL_LOOP_ENABLED", "CTRL_LOOP_MODEL"]) {
    assert.ok(qa.includes(`vars.TF_QA_${name}`));
    assert.ok(!qa.includes(`vars.TF_${name} `));
  }
  for (const path of ["infra/aws-prod/ecs_alb.tf", "infra/aws-prod/variables.tf", ".github/workflows/deploy-prod.yml"]) {
    assert.doesNotMatch(read(path), /CTRL_LOOP|ctrl_loop/);
  }
});
