import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("product-editor images own their loads while the HTML mail surface keeps one hydration owner", () => {
  const textBlocks = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");
  const unified = source("frontend/src/modules/editor/UnifiedRichEditorSurface.tsx");
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  const tiptap = source("frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx");
  assert.equal((textBlocks.match(/hydrateEditorAttachmentImageFrames\(/g) ?? []).length, 0);
  assert.equal((unified.match(/hydrateEditorAttachmentImageFrames\(/g) ?? []).length, 1);
  assert.equal((editor.match(/hydrateEditorAttachmentImageFrames\(/g) ?? []).length, 0);
  assert.match(tiptap, /export const MangoAuthenticatedImage/);
  assert.match(tiptap, /controller\.abort\(\);[\s\S]*if \(current\) URL\.revokeObjectURL\(current\)/);
  assert.match(unified, /attachmentHydrationCleanupRef\.current\?\.\(\)/);
});

test("save-version history is requested only after Save Settings activation", () => {
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  assert.match(editor, /if \(activeTab !== "save-settings" \|\| linkedEntityAccessDenied\) return;\s+void loadEditorSaveVersions\(\);/);
  assert.match(editor, /if \(activeTabRef\.current === "save-settings"\) void loadEditorSaveVersions\(\);/);
  assert.doesNotMatch(editor, /lastAutoSaveVersionSignatureRef\.current = "";\s+void loadEditorSaveVersions\(\);/);
});

test("initial Node realtime acceptance does not reload the consolidated Node view", () => {
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  assert.match(editor, /let acceptedOnce = false;[\s\S]*onAccepted\(\) \{\s+if \(!acceptedOnce\) \{\s+acceptedOnce = true;\s+return;\s+\}\s+scheduleCanonicalRefresh\(\);/);
});

test("every node attachment refresh invalidates canonical metadata before incrementing the refresh key", () => {
  const nodeWorkspace = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  assert.match(nodeWorkspace, /const refreshNodeAttachments = useCallback\(\(\) => \{\s+invalidateMangoResourceAttachmentsCache\(requestJSON, \{[\s\S]*?resourceType: "node",[\s\S]*?resourceID: nodeID,[\s\S]*?\}\);\s+setNodeAttachmentsRefreshKey/);
});

test("Tiptap annotation work stays outside the ordinary save and whole-document paths", () => {
  const nodeWorkspace = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const editorContent = source("frontend/src/modules/editor/EditorContent.tsx");
  const annotations = source("frontend/src/modules/editor/tiptap/mangoTiptapAnnotations.ts");
  const editor = source("frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx");
  assert.doesNotMatch(annotations, /document\.descendants\(/);
  assert.match(annotations, /if \(annotations\.length === 0\) return DecorationSet\.empty/);
  assert.match(annotations, /document\.nodesBetween\(annotation\.from, annotation\.to/);
  assert.match(annotations, /previous\.decorations\.map\(transaction\.mapping, newState\.doc\)/);
  assert.match(editor, /if \(changed\) \{\s+if \(editorRef\.current\) updateMangoTiptapAnnotations/);
  assert.match(editor, /const changed = !mangoTiptapAnnotationsEqual\(mappedAnnotationsRef\.current, merged\);[\s\S]*if \(changed && editorRef\.current\) updateMangoTiptapAnnotations/);
  assert.match(editor, /if \(\(transaction\.docChanged && !transaction\.selectionSet\) \|\| transaction\.storedMarksSet\)[\s\S]*updateSelectionState\(transactionEditor\);[\s\S]*if \(!transaction\.docChanged\) return;/);
  assert.match(annotations, /mangoTiptapAnnotationsEqual\(readMappedMangoTiptapAnnotations\(editor\), annotations\)[\s\S]*return false;[\s\S]*editor\.view\.dispatch/);
  assert.match(editorContent, /setSelectionInlineFormat\(\(current\) => \([\s\S]*current\.bold === nextFormat\.bold[\s\S]*\? current[\s\S]*: nextFormat/);
  assert.match(nodeWorkspace, /const messages = chatMessagesByBlock\.get\(block\.id\) \?\? \[\];/);
  assert.doesNotMatch(nodeWorkspace, /displayedChatMessagesByBlock|legacyMessages|emailOriginChatHostBlockID/);
  assert.match(editor, /onSnapshot: \(snapshot, snapshotAnnotations\) => \{\s+currentDocumentRef\.current = snapshot;\s+persistedAnnotationsRef\.current = \[\.\.\.snapshotAnnotations\];\s+callbacksRef\.current\.onDocumentSnapshotChange\?\.\(snapshot\);\s+\}/);
  assert.doesNotMatch(editor, /onSnapshot: \(snapshot, snapshotAnnotations\) => \{\s+setDocument\(snapshot\)/);
});
