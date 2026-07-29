import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

test("GitHub CI installs and exports the PostgreSQL server tools required by the production-path gate", () => {
  assert.match(workflow, /apt-get install --yes postgresql/);
  assert.match(workflow, /POSTGRES_BIN=\$\(pg_config --bindir\)/);
  assert.ok(
    workflow.indexOf("Install PostgreSQL server tools") < workflow.indexOf("Run repo tests"),
    "PostgreSQL server tools must be available before the full repository gate",
  );
});

test("GitHub CI does not install browser automation", () => {
  assert.doesNotMatch(workflow, /playwright|chromium/i);
});
