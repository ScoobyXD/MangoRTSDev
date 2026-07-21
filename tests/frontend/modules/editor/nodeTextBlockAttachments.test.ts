import test from "node:test";
import assert from "node:assert/strict";
import type { AttachmentRequestJSON } from "../../../../frontend/src/modules/attachments/attachmentApi.js";
import type { EditorChatAttachment } from "../../../../frontend/src/modules/editor/editorProjection.js";
import {
  appendUniqueEditorAttachments,
  editorChatAttachmentsReadyForSubmit,
  failEditorChatAttachmentTransfer,
  formatNodeAttachmentListError,
  nodeAttachmentUploadScopeMatches,
  resolveEditorChatAttachmentTransfer,
  stageEditorChatAttachmentTransfer,
  textBlockAttachmentContextLabel,
  transferTextBlockImageToChatDraft,
  visibleNodeAttachmentUploads,
} from "../../../../frontend/src/modules/editor/nodeTextBlockAttachments.js";
import { resolveTextBlockImageActionLayout } from "../../../../frontend/src/modules/editor/nodeTextBlockImageActions.js";

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

test("optional attachment-list network failures stay local and actionable", () => {
  assert.equal(
    formatNodeAttachmentListError(new TypeError("Failed to fetch")),
    "Attachments are temporarily unavailable. Retry from the attachment menu.",
  );
  assert.equal(formatNodeAttachmentListError(new Error("permission_denied")), "permission_denied");
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

test("attachment-backed editor images stage immediately and link without downloading or reuploading bytes", async () => {
  let releaseLink!: () => void;
  const linkGate = new Promise<void>((resolve) => { releaseLink = resolve; });
  const requests: Array<{ path: string; init: unknown }> = [];
  const requestJSON = (async (path: string, init?: unknown) => {
    requests.push({ path, init });
    await linkGate;
    return { resource_attachment: {} };
  }) as AttachmentRequestJSON;
  let drafts: EditorChatAttachment[] = [];
  let legacyUploads = 0;

  const transfer = transferTextBlockImageToChatDraft({
    image: {
      blockID: "block-1",
      dataURL: "data:image/png;base64,preview",
      attachmentID: "attachment-1",
      filename: "diagram.png",
      mimeType: "image/png",
      size: 1388196,
    },
    requestJSON,
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    editorSurface: "node_text_block",
    createPendingID: () => "pending-1",
    uploadLegacyImage: async () => {
      legacyUploads += 1;
      return editorAttachment("legacy", "legacy", 1);
    },
    onStage: (attachment) => { drafts = stageEditorChatAttachmentTransfer(drafts, attachment); },
    onResolve: (pendingID, attachment) => { drafts = resolveEditorChatAttachmentTransfer(drafts, pendingID, attachment); },
    onReject: (pendingID) => { drafts = failEditorChatAttachmentTransfer(drafts, pendingID); },
  });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.transferState, "processing");
  assert.equal(drafts[0]?.dataURL, "data:image/png;base64,preview");
  assert.equal(editorChatAttachmentsReadyForSubmit(drafts), false);
  assert.equal(legacyUploads, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "/v1/resources/node/node-1/attachments");
  assert.deepEqual((requests[0]?.init as { json?: unknown }).json, {
    company_id: "company-1",
    attachment_id: "attachment-1",
    relationship_kind: "chat_attachment",
    information_id: "block-1",
    message_id: undefined,
    editor_surface: "node_text_block",
  });

  releaseLink();
  await transfer;

  assert.equal(legacyUploads, 0);
  assert.deepEqual(drafts, [{
    id: "attachment-1",
    attachmentID: "attachment-1",
    name: "diagram.png",
    type: "image/png",
    size: 1388196,
    transferState: undefined,
  }]);
  assert.equal(editorChatAttachmentsReadyForSubmit(drafts), true);
});

test("failed editor image transfers stay visible and block chat submission until removed", async () => {
  let drafts: EditorChatAttachment[] = [];
  const requestJSON = (async () => { throw new Error("link failed"); }) as AttachmentRequestJSON;
  const transfer = transferTextBlockImageToChatDraft({
    image: {
      blockID: "block-1",
      dataURL: "data:image/png;base64,preview",
      attachmentID: "attachment-1",
      filename: "diagram.png",
      mimeType: "image/png",
      size: 10,
    },
    requestJSON,
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    editorSurface: "node_text_block",
    createPendingID: () => "pending-2",
    uploadLegacyImage: async () => editorAttachment("legacy", "legacy", 1),
    onStage: (attachment) => { drafts = stageEditorChatAttachmentTransfer(drafts, attachment); },
    onResolve: (pendingID, attachment) => { drafts = resolveEditorChatAttachmentTransfer(drafts, pendingID, attachment); },
    onReject: (pendingID) => { drafts = failEditorChatAttachmentTransfer(drafts, pendingID); },
  });

  assert.equal(drafts[0]?.transferState, "processing");
  await assert.rejects(transfer, /link failed/);
  assert.equal(drafts[0]?.transferState, "failed");
  assert.equal(drafts[0]?.dataURL, "data:image/png;base64,preview");
  assert.equal(editorChatAttachmentsReadyForSubmit(drafts), false);
});

test("inline image actions use the elevated app layer without losing their image anchor", () => {
  const editorViewport = { left: 100, top: 100, right: 700, bottom: 500 };
  const appViewport = { left: 0, top: 0, right: 1200, bottom: 800 };
  const before = resolveTextBlockImageActionLayout(
    { left: 160, top: 180, right: 460, bottom: 380 },
    editorViewport,
    appViewport,
  );
  const after = resolveTextBlockImageActionLayout(
    { left: 160, top: 130, right: 460, bottom: 330 },
    editorViewport,
    appViewport,
  );

  if (!before || !after) throw new Error("expected visible image action layouts");
  assert.equal(after.y - before.y, -50);
  assert.equal(after.downloadX, before.downloadX);
  assert.equal(after.x, before.x);
  assert.equal(after.downloadY - before.downloadY, -50);

  const besideChatPane = resolveTextBlockImageActionLayout(
    { left: 500, top: 180, right: 695, bottom: 380 },
    editorViewport,
    appViewport,
  );
  if (!besideChatPane) throw new Error("expected image actions beside the chat pane");
  assert.equal(besideChatPane.x, 703);
  assert.ok(besideChatPane.x > editorViewport.right, "the elevated action surface may cross the editor edge above the chat pane");
  assert.equal(resolveTextBlockImageActionLayout(
    { left: 160, top: -300, right: 460, bottom: -100 },
    editorViewport,
    appViewport,
  ), null);
});
function editorAttachment(id: string, attachmentID: string, size: number): EditorChatAttachment {
  return { id, attachmentID, name: `${id}.bin`, type: "application/octet-stream", size };
}
