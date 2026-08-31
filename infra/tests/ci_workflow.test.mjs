import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const processMapPostgresGate = readFileSync(resolve(process.cwd(), "scripts/test_process_map_postgres.mjs"), "utf8");

test("GitHub CI gives each database contract an isolated database on pinned PostgreSQL 17", () => {
  assert.match(workflow, /image: postgres:17\.7/);
  assert.match(workflow, /EMAIL_SQS_POSTGRES17_HOST: 127\.0\.0\.1/);
  assert.match(workflow, /EMAIL_SQS_POSTGRES17_DATABASE: postgres/);
  assert.match(workflow, /NODE_EMAIL_POSTGRES17_DATABASE: mangorts_node_email_test/);
  assert.match(workflow, /EMAIL_DRAFT_POSTGRES17_DATABASE: mangorts_email_draft_test/);
  assert.match(workflow, /HUDDLE_EXPLORER_POSTGRES17_DATABASE: mangorts_huddle_explorer_test/);
  assert.match(workflow, /PROCESS_MAP_POSTGRES17_DATABASE: mangorts_process_map_test_gate/);
  assert.match(workflow, /MANGORTS_EMAIL_SQS_TEST_DSN: postgres:\/\/postgres:postgres@127\.0\.0\.1:5432\/postgres\?sslmode=disable/);
  assert.match(workflow, /MANGORTS_REALTIME_PLAN_DATABASE_URL: postgres:\/\/postgres:postgres@127\.0\.0\.1:5432\/mangorts_realtime_plan_test\?sslmode=disable/);
  assert.match(workflow, /apt-get install --yes postgresql-client/);
  assert.match(workflow, /createdb --host=127\.0\.0\.1 --port=5432 --username=postgres mangorts_realtime_plan_test/);
  assert.match(workflow, /createdb --host=127\.0\.0\.1 --port=5432 --username=postgres mangorts_node_email_test/);
  assert.match(workflow, /createdb --host=127\.0\.0\.1 --port=5432 --username=postgres mangorts_email_draft_test/);
  assert.match(workflow, /createdb --host=127\.0\.0\.1 --port=5432 --username=postgres mangorts_huddle_explorer_test/);
  assert.match(workflow, /createdb --host=127\.0\.0\.1 --port=5432 --username=postgres mangorts_process_map_test_gate/);
  assert.doesNotMatch(workflow, /POSTGRES_BIN/);
  assert.doesNotMatch(workflow, /RACI_TABS_POSTGRES17|mangorts_raci_tabs_test/);
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
    workflow.indexOf("Create separate PostgreSQL contract databases") < workflow.indexOf("Run repo tests"),
    "the isolated PostgreSQL contract databases must exist before the full repository gate",
  );
});

test("GitHub CI does not install browser automation", () => {
  assert.doesNotMatch(workflow, /playwright|chromium/i);
});

test("shared disposable PostgreSQL gate runs Huddle and RACI Tabs retirement migrations", () => {
  assert.match(processMapPostgresGate, /\|Huddle\|/);
  assert.match(processMapPostgresGate, /\|RetiredRACITabs\|/);
});
