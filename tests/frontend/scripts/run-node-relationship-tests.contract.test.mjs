import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const runnerSource = readFileSync(resolve(scriptDir, "run-node-relationship-tests.mjs"), "utf8");

test("the frontend test runner uses esbuild's JavaScript API instead of passing its native binary to Node", () => {
  assert.match(runnerSource, /createRequire\(resolve\(frontendRoot, "package\.json"\)\)/);
  assert.match(runnerSource, /frontendRequire\("esbuild"\)/);
  assert.match(runnerSource, /\bbuildSync\(\{/);
  assert.doesNotMatch(runnerSource, /node_modules\/esbuild\/bin\/esbuild/);
  assert.doesNotMatch(runnerSource, /process\.execPath[^\r\n]*esbuild/i);
});
