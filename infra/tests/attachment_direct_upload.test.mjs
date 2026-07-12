import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

const moduleCors = read("infra/modules/mangorts-platform/attachments_s3.tf");
const moduleIAM = read("infra/modules/mangorts-platform/iam.tf");
const moduleECS = read("infra/modules/mangorts-platform/ecs_alb.tf");
const moduleLocals = read("infra/modules/mangorts-platform/locals.tf");
const moduleVariables = read("infra/modules/mangorts-platform/variables.tf");
const devMain = read("infra/aws-dev/main.tf");
const prodCors = read("infra/aws-prod/attachments_s3.tf");
const prodIAM = read("infra/aws-prod/iam.tf");
const prodECS = read("infra/aws-prod/ecs_alb.tf");
const prodLocals = read("infra/aws-prod/locals.tf");
const prodVariables = read("infra/aws-prod/variables.tf");

test("attachment bucket CORS matches browser presigned PUT headers", () => {
  for (const source of [moduleCors, prodCors]) {
    assert.match(source, /aws_s3_bucket_public_access_block" "attachments"/);
    assert.match(source, /block_public_acls\s*=\s*true/);
    assert.match(source, /block_public_policy\s*=\s*true/);
    assert.match(source, /ignore_public_acls\s*=\s*true/);
    assert.match(source, /restrict_public_buckets\s*=\s*true/);
    assert.match(source, /allowed_methods\s*=\s*\["PUT"\]/);
    assert.match(
      source,
      /allowed_headers\s*=\s*\[\s*"content-type",\s*"x-amz-checksum-sha256",\s*"x-amz-server-side-encryption"\s*\]/,
    );
    assert.match(source, /expose_headers\s*=\s*\["ETag", "x-amz-checksum-sha256", "x-amz-checksum-type"\]/);
    assert.match(source, /max_age_seconds\s*=\s*3600/);
    assert.doesNotMatch(source, /allowed_origins\s*=\s*\["\*"\]/);
  }

  assert.match(moduleLocals, /"https:\/\/\$\{local\.app_domain\}"/);
  assert.match(moduleLocals, /var\.environment == "dev" \? \["http:\/\/localhost:5173"\]/);
  assert.match(prodLocals, /"https:\/\/\$\{local\.app_domain\}"/);
  assert.doesNotMatch(prodLocals, /http:\/\/localhost:5173/);
});

test("attachment buckets abort incomplete multipart uploads", () => {
  for (const source of [moduleCors, prodCors]) {
    assert.match(source, /aws_s3_bucket_lifecycle_configuration" "attachments"/);
    assert.match(source, /abort_incomplete_multipart_upload/);
    assert.match(source, /days_after_initiation\s*=\s*var\.attachment_multipart_abort_days/);
  }
});

test("backend task roles have only the required attachment object actions", () => {
  const expectedActions = [
    "s3:AbortMultipartUpload",
    "s3:DeleteObject",
    "s3:GetObject",
    "s3:ListMultipartUploadParts",
    "s3:PutObject",
  ];

  for (const source of [moduleIAM, prodIAM]) {
    const start = source.indexOf('data "aws_iam_policy_document" "ecs_task_attachments"');
    const end = source.indexOf('resource "aws_iam_policy" "ecs_task_attachments"', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const attachmentPolicy = source.slice(start, end);

    for (const action of expectedActions) {
      assert.match(attachmentPolicy, new RegExp(`"${action}"`));
    }
    assert.match(attachmentPolicy, /\/companies\/\*"\]/);
    assert.doesNotMatch(attachmentPolicy, /"s3:\*"/);
  }
});

test("ECS receives the complete browser upload policy configuration", () => {
  const names = [
    "MANGORTS_ATTACHMENT_DIRECT_UPLOAD_ENABLED",
    "MANGORTS_ATTACHMENT_MAX_BROWSER_UPLOAD_BYTES",
    "MANGORTS_ATTACHMENT_UPLOAD_INTENT_TTL_SECONDS",
    "MANGORTS_ATTACHMENT_SINGLE_PUT_URL_TTL_SECONDS",
    "MANGORTS_ATTACHMENT_MULTIPART_PART_URL_TTL_SECONDS",
    "MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT",
  ];

  for (const source of [moduleECS, prodECS]) {
    for (const name of names) {
      assert.match(source, new RegExp(`"${name}"`));
    }
  }
});

test("module defaults and the dev consumer preserve the V1 product policy", () => {
  const defaults = [
    ["attachment_max_browser_upload_bytes", "1073741824"],
    ["attachment_upload_intent_ttl_seconds", "86400"],
    ["attachment_single_put_url_ttl_seconds", "3600"],
    ["attachment_multipart_part_url_ttl_seconds", "900"],
  ];

  for (const [name, value] of defaults) {
    for (const source of [moduleVariables, prodVariables]) {
      assert.match(
        source,
        new RegExp(`variable "${name}" \\{[\\s\\S]*?default\\s*=\\s*${value}`),
      );
    }
    assert.match(devMain, new RegExp(`${name}\\s*=\\s*var\\.${name}`));
  }

  for (const source of [moduleVariables, prodVariables]) {
    assert.match(
      source,
      /variable "attachment_direct_upload_enabled" \{[\s\S]*?default\s*=\s*true/,
    );
  }
});
