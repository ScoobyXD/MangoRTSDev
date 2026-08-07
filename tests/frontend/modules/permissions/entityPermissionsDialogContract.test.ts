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
  assert.equal(source.includes("invalidateResourcePolicyDependentCaches(apiBase, companyID);"), true);
  assert.match(source, /onClick=\{closeWithSave\} disabled=\{busy\}[\s\S]*?aria-label="Close permissions"/);
  assert.match(source, /<AppModalPortal onRequestClose=\{busy \? undefined : closeWithSave\}>/);
  assert.match(source, /permissionMapsEqual\(accessBySubject, permissionsToMap\(parentPolicy\.permissions \?\? \[\]\)\) \? "inherited" : "customized"/);
  assert.match(source, /aria-label="Permission policy mode"[\s\S]*permissionMode === "inherited" \? "Inherited" : "Customized"/);
  assert.doesNotMatch(source, /setPermissionMode|onClick=[^\n]*permissionMode/);
  assert.match(source, /onClick=\{\(\) => \{ void save\(false, "inherited_only"\); \}\}[\s\S]*Apply to non-customized descendants/);
  assert.match(source, /window\.confirm\([\s\S]*void save\(false, "including_customized"\)[\s\S]*Apply to every descendant/);
  assert.match(source, /const supportsDescendantApply = hasDescendants/);
  assert.doesNotMatch(source, /Effective source:[\s\S]*effectiveSource\.resource_id/);
});
