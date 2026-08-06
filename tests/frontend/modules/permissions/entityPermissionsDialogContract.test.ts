import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("permission dialog saves pending changes before closing without duplicate writes", () => {
  const source = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/permissions/EntityPermissionsDialog.tsx"),
    "utf8",
  );

  assert.match(source, /const \[permissionsLoadFailed, setPermissionsLoadFailed\] = useState\(false\);/);
  assert.match(source, /const \[hasUnsavedChanges, setHasUnsavedChanges\] = useState\(false\);/);
  assert.match(source, /const closeWithSave = \(\) => \{[\s\S]*?effectiveReadOnly \|\| permissionsLoadFailed \|\| !hasUnsavedChanges[\s\S]*?onClose\(\);[\s\S]*?void save\(true\);[\s\S]*?\};/);
  assert.match(source, /setPolicyRevision\(payload\.revision\);\s*setHasUnsavedChanges\(false\);\s*setSaved\(true\);/);
  assert.match(source, /onClick=\{closeWithSave\} disabled=\{busy\}[\s\S]*?aria-label="Close permissions"/);
  assert.match(source, /<AppModalPortal onRequestClose=\{busy \? undefined : closeWithSave\}>/);
});
