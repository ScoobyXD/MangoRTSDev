import test from "node:test";
import assert from "node:assert/strict";
import type { EditorChatAttachment } from "../../../../frontend/src/modules/editor/editorProjection.js";
import {
  appendUniqueEditorAttachments,
  nodeAttachmentUploadScopeMatches,
  textBlockAttachmentContextLabel,
  visibleNodeAttachmentUploads,
} from "../../../../frontend/src/modules/editor/nodeTextBlockAttachments.js";

test("latest projection append preserves partial successes and deduplicates durable attachment IDs", () => {
  const existing = editorAttachment("local-a", "attachment-a", 10);
  const duplicateExisting = editorAttachment("other-local-a", "attachment-a", 10);
  const uploaded = editorAttachment("local-b", "attachment-b", 20);
  const duplicateUploaded = editorAttachment("other-local-b", "attachment-b", 20);

  const result = appendUniqueEditorAttachments([existing], [duplicateExisting, uploaded, duplicateUploaded]);

  assert.deepEqual(result, [existing, uploaded]);
});

test("node attachment context keeps deleted text-box links visible with a durable label", () => {
  const titles = new Map([["block-live", "Current notes"]]);
  assert.equal(textBlockAttachmentContextLabel("block-live", titles), "Current notes");
  assert.equal(textBlockAttachmentContextLabel("block-deleted", titles), "Deleted text box");
  assert.equal(textBlockAttachmentContextLabel("", titles), "Node");
});

test("an in-flight upload remains node-scoped after its origin text box is deleted", () => {
  const started = { companyID: "company-1", nodeID: "node-1", canEdit: true, generation: 7 };
  const currentAfterBlockDeletion = { ...started };

  assert.equal(nodeAttachmentUploadScopeMatches(started, currentAfterBlockDeletion), true);
  assert.equal(nodeAttachmentUploadScopeMatches(started, { ...started, nodeID: "node-2" }), false);
  assert.equal(nodeAttachmentUploadScopeMatches(started, { ...started, canEdit: false }), false);
  assert.equal(nodeAttachmentUploadScopeMatches(started, { ...started, generation: 8 }), false);
});

test("completed progress is retained until the canonical node link appears", () => {
  const uploading = { id: "uploading", progress: { state: "uploading" } };
  const completedPendingRefresh = { id: "completed", attachmentID: "attachment-a", progress: { state: "complete" } };
  const failed = { id: "failed", progress: { state: "failed" } };
  const uploads = [uploading, completedPendingRefresh, failed];

  assert.deepEqual(visibleNodeAttachmentUploads(uploads, new Set()), uploads);
  assert.deepEqual(
    visibleNodeAttachmentUploads(uploads, new Set(["attachment-a"])),
    [uploading, failed],
  );
});

function editorAttachment(id: string, attachmentID: string, size: number): EditorChatAttachment {
  return { id, attachmentID, name: `${id}.bin`, type: "application/octet-stream", size };
}
