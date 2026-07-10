import test from "node:test";
import assert from "node:assert/strict";
import type { MangoResourceAttachment } from "../../../../frontend/src/modules/attachments/attachmentApi.js";
import type { EditorChatAttachment } from "../../../../frontend/src/modules/editor/editorProjection.js";
import {
  appendUniqueEditorAttachments,
  selectAttachmentUploadCandidates,
  textBlockAttachmentContextLabel,
  totalTextBlockAttachmentBytes,
} from "../../../../frontend/src/modules/editor/nodeTextBlockAttachments.js";

test("attachment candidate selection accounts for existing and reserved bytes", () => {
  const small = { name: "small", size: 4 };
  const overTotal = { name: "over-total", size: 1 };
  const overFile = { name: "over-file", size: 7 };
  const selection = selectAttachmentUploadCandidates({
    candidates: [small, overTotal, overFile],
    existingBytes: 5,
    pendingBytes: 3,
    maxFileBytes: 6,
    maxTotalBytes: 12,
  });

  assert.deepEqual(selection.accepted, [small]);
  assert.equal(selection.acceptedBytes, 4);
  assert.deepEqual(selection.rejected.map(({ candidate, reason }) => [candidate.name, reason]), [
    ["over-total", "total_too_large"],
    ["over-file", "file_too_large"],
  ]);
});

test("attachment candidate selection treats a concurrent batch reservation as occupied capacity", () => {
  const selection = selectAttachmentUploadCandidates({
    candidates: [{ name: "next-batch", size: 5 }],
    existingBytes: 0,
    pendingBytes: 8,
    maxFileBytes: 10,
    maxTotalBytes: 12,
  });
  assert.equal(selection.accepted.length, 0);
  assert.equal(selection.rejected[0]?.reason, "total_too_large");
});

test("latest projection append preserves partial successes and deduplicates durable attachment IDs", () => {
  const existing = editorAttachment("local-a", "attachment-a", 10);
  const duplicateExisting = editorAttachment("other-local-a", "attachment-a", 10);
  const uploaded = editorAttachment("local-b", "attachment-b", 20);
  const duplicateUploaded = editorAttachment("other-local-b", "attachment-b", 20);

  const result = appendUniqueEditorAttachments([existing], [duplicateExisting, uploaded, duplicateUploaded]);

  assert.deepEqual(result, [existing, uploaded]);
});

test("attachment byte total prefers canonical metadata and adds projection-only references", () => {
  const canonicalA = resourceAttachment("attachment-a", 100);
  const canonicalC = resourceAttachment("attachment-c", 300);
  const total = totalTextBlockAttachmentBytes(
    [
      editorAttachment("local-a", "attachment-a", 999),
      editorAttachment("local-b", "attachment-b", 200),
    ],
    [canonicalA, canonicalC, canonicalC],
  );

  assert.equal(total, 600);
});

test("node attachment context keeps deleted text-box links visible with a durable label", () => {
  const titles = new Map([["block-live", "Current notes"]]);
  assert.equal(textBlockAttachmentContextLabel("block-live", titles), "Current notes");
  assert.equal(textBlockAttachmentContextLabel("block-deleted", titles), "Deleted text box");
  assert.equal(textBlockAttachmentContextLabel("", titles), "Node");
});

function editorAttachment(id: string, attachmentID: string, size: number): EditorChatAttachment {
  return { id, attachmentID, name: `${id}.bin`, type: "application/octet-stream", size };
}

function resourceAttachment(attachmentID: string, byteSize: number): MangoResourceAttachment {
  return {
    resource_attachment_id: `link-${attachmentID}`,
    company_id: "company-1",
    resource_type: "node",
    resource_id: "node-1",
    attachment_id: attachmentID,
    information_id: "block-1",
    editor_surface: "node_text_block",
    relationship_kind: "file_attachment",
    created_timestamp: "2026-07-10T00:00:00Z",
    attachment: {
      company_id: "company-1",
      attachment_id: attachmentID,
      original_filename: `${attachmentID}.bin`,
      mime_type: "application/octet-stream",
      byte_size: byteSize,
      sha256: `sha-${attachmentID}`,
      storage_bucket: "bucket",
      storage_key: `attachments/${attachmentID}`,
      source_kind: "user_upload",
      created_timestamp: "2026-07-10T00:00:00Z",
    },
  };
}
