import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

test("GitHub CI gives SQS and realtime planning separate databases on pinned PostgreSQL 17", () => {
  assert.match(workflow, /image: postgres:17\.7/);
  assert.match(workflow, /EMAIL_SQS_POSTGRES17_HOST: 127\.0\.0\.1/);
  assert.match(workflow, /EMAIL_SQS_POSTGRES17_DATABASE: postgres/);
  assert.match(workflow, /MANGORTS_EMAIL_SQS_TEST_DSN: postgres:\/\/postgres:postgres@127\.0\.0\.1:5432\/postgres\?sslmode=disable/);
  assert.match(workflow, /MANGORTS_REALTIME_PLAN_DATABASE_URL: postgres:\/\/postgres:postgres@127\.0\.0\.1:5432\/mangorts_realtime_plan_test\?sslmode=disable/);
  assert.match(workflow, /apt-get install --yes postgresql-client/);
  assert.match(workflow, /createdb --host=127\.0\.0\.1 --port=5432 --username=postgres mangorts_realtime_plan_test/);
  assert.doesNotMatch(workflow, /POSTGRES_BIN/);
  assert.notEqual(
    workflow.match(/MANGORTS_EMAIL_SQS_TEST_DSN: [^\n]+\/([^/?\s]+)\?/)?.[1],
    workflow.match(/MANGORTS_REALTIME_PLAN_DATABASE_URL: [^\n]+\/([^/?\s]+)\?/)?.[1],
    "SQS schema tests and realtime query-plan tests must not share a database",
  );
  assert.ok(
    workflow.indexOf("Install PostgreSQL client tools") < workflow.indexOf("Run repo tests"),
    "PostgreSQL client tools must be available before the full repository gate",
  );
  assert.ok(
    workflow.indexOf("Create separate realtime plan test database") < workflow.indexOf("Run repo tests"),
    "the guarded realtime test database must exist before the full repository gate",
  );
});

test("GitHub CI does not install browser automation", () => {
  assert.doesNotMatch(workflow, /playwright|chromium/i);
});
