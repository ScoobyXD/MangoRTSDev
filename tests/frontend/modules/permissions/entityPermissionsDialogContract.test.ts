import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("permission dialog dismissal never retries a failed save", () => {
  const source = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/permissions/EntityPermissionsDialog.tsx"),
    "utf8",
  );

  assert.match(source, /const closeWithoutSave = \(\) => \{[\s\S]*?onClose\(\);[\s\S]*?\};/);
  assert.match(source, /onClick=\{closeWithoutSave\}[\s\S]*?aria-label="Close permissions"/);
  assert.match(source, /<AppModalPortal onRequestClose=\{closeWithoutSave\}>/);
  assert.doesNotMatch(source, /const closeWithSave/);
  assert.doesNotMatch(source, /void save\(true\)/);
});
