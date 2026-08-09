import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

test("GitHub CI pins PostgreSQL 17 for migration success and exports its client tools", () => {
  assert.match(workflow, /image: postgres:17\.7/);
  assert.match(workflow, /EMAIL_SQS_POSTGRES17_HOST: 127\.0\.0\.1/);
  assert.match(workflow, /MANGORTS_EMAIL_SQS_TEST_DSN: postgres:\/\/postgres:postgres@127\.0\.0\.1:5432\/postgres\?sslmode=disable/);
  assert.match(workflow, /apt-get install --yes postgresql-client/);
  assert.match(workflow, /POSTGRES_BIN=\$\(dirname "\$\(command -v psql\)"\)/);
  assert.ok(
    workflow.indexOf("Install PostgreSQL client tools") < workflow.indexOf("Run repo tests"),
    "PostgreSQL client tools must be available before the full repository gate",
  );
});

test("GitHub CI does not install browser automation", () => {
  assert.doesNotMatch(workflow, /playwright|chromium/i);
});
