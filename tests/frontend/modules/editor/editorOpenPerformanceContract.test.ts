import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("each editor DOM has one attachment hydration owner with explicit cleanup", () => {
  const textBlocks = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");
  const unified = source("frontend/src/modules/editor/UnifiedRichEditorSurface.tsx");
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  assert.equal((textBlocks.match(/hydrateEditorAttachmentImageFrames\(/g) ?? []).length, 1);
  assert.equal((unified.match(/hydrateEditorAttachmentImageFrames\(/g) ?? []).length, 1);
  assert.equal((editor.match(/hydrateEditorAttachmentImageFrames\(/g) ?? []).length, 1);
  assert.match(textBlocks, /const owner = attachmentHydrationOwnerRef\.current;\s+attachmentHydrationOwnerRef\.current = null;\s+owner\?\.cleanup\(\)/);
  assert.match(unified, /attachmentHydrationCleanupRef\.current\?\.\(\)/);
  assert.match(editor, /attachmentHydrationCleanupRef\.current\?\.\(\)/);
});

test("save-version history is requested only after Save Settings activation", () => {
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  assert.match(editor, /if \(activeTab !== "save-settings" \|\| linkedEntityAccessDenied\) return;\s+void loadEditorSaveVersions\(\);/);
  assert.match(editor, /if \(activeTabRef\.current === "save-settings"\) void loadEditorSaveVersions\(\);/);
  assert.doesNotMatch(editor, /lastAutoSaveVersionSignatureRef\.current = "";\s+void loadEditorSaveVersions\(\);/);
});

test("every node attachment refresh invalidates canonical metadata before incrementing the refresh key", () => {
  const nodeWorkspace = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  assert.match(nodeWorkspace, /const refreshNodeAttachments = useCallback\(\(\) => \{\s+invalidateMangoResourceAttachmentsCache\(requestJSON, \{[\s\S]*?resourceType: "node",[\s\S]*?resourceID: nodeID,[\s\S]*?\}\);\s+setNodeAttachmentsRefreshKey/);
});
