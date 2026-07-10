import test from "node:test";
import assert from "node:assert/strict";
import {
  filterMangoResourceAttachments,
  groupMangoResourceAttachmentsByInformationID,
  listMangoResourceAttachments,
  type AttachmentRequestJSON,
  type MangoResourceAttachment,
  type MangoResourceAttachmentListResponse,
} from "../../../../frontend/src/modules/attachments/attachmentApi.js";

function resourceAttachment(
  attachmentID: string,
  overrides: Partial<MangoResourceAttachment> = {},
): MangoResourceAttachment {
  return {
    resource_attachment_id: `link-${attachmentID}`,
    company_id: "company-1",
    resource_type: "node",
    resource_id: "node-1",
    attachment_id: attachmentID,
    information_id: "block-1",
    editor_surface: "node_text_block",
    relationship_kind: "file_attachment",
    created_timestamp: "2026-07-10T12:00:00.000Z",
    attachment: {
      company_id: "company-1",
      attachment_id: attachmentID,
      original_filename: `${attachmentID}.txt`,
      mime_type: "text/plain",
      byte_size: 42,
      sha256: `sha-${attachmentID}`,
      storage_bucket: "attachments-test",
      storage_key: `company-1/${attachmentID}`,
      source_kind: "user_upload",
      created_timestamp: "2026-07-10T12:00:00.000Z",
    },
    ...overrides,
  };
}

test("lists resource attachments through the encoded resource endpoint", async () => {
  const expected: MangoResourceAttachmentListResponse = {
    company_id: "company/id",
    resource_type: "node",
    resource_id: "node/with spaces",
    attachments: [resourceAttachment("attachment-1")],
  };
  let requestedPath = "";
  let requestedMethod = "";
  const request: AttachmentRequestJSON = async <T>(path, init) => {
    requestedPath = path;
    requestedMethod = init?.method ?? "GET";
    return expected as unknown as T;
  };

  const result = await listMangoResourceAttachments(request, {
    companyID: "  company/id  ",
    resourceType: "node",
    resourceID: "  node/with spaces  ",
  });

  assert.equal(
    requestedPath,
    "/v1/resources/node/node%2Fwith%20spaces/attachments?company_id=company%2Fid",
  );
  assert.equal(requestedMethod, "GET");
  assert.equal(result, expected);
  assert.equal(result.attachments[0]?.attachment?.original_filename, "attachment-1.txt");
});

test("filters node text-block files without changing the source list", () => {
  const softDeletedAttachment = resourceAttachment("deleted-attachment");
  softDeletedAttachment.attachment = {
    ...softDeletedAttachment.attachment!,
    deleted_timestamp: "2026-07-10T13:00:00.000Z",
  };
  const items = [
    resourceAttachment("file-a", { information_id: "block-a" }),
    resourceAttachment("file-b", { information_id: "block-b" }),
    resourceAttachment("inline-image", { relationship_kind: "inline_image" }),
    resourceAttachment("chat-file", { editor_surface: "node_chat_message" }),
    resourceAttachment("email-file", { relationship_kind: "email_attachment" }),
    resourceAttachment("deleted-link", { deleted_timestamp: "2026-07-10T13:00:00.000Z" }),
    softDeletedAttachment,
    resourceAttachment("missing-metadata", { attachment: undefined }),
  ];
  const originalSnapshot = JSON.stringify(items);

  const filtered = filterMangoResourceAttachments(items, {
    relationshipKind: "file_attachment",
    editorSurface: "node_text_block",
  });

  assert.notEqual(filtered, items);
  assert.deepEqual(filtered.map((item) => item.attachment_id), ["file-a", "file-b"]);
  assert.equal(JSON.stringify(items), originalSnapshot);
});

test("groups attachments by normalized information ID and preserves item order", () => {
  const items = [
    resourceAttachment("block-a-first", { information_id: "block-a" }),
    resourceAttachment("unassigned-blank", { information_id: "   " }),
    resourceAttachment("block-a-second", { information_id: " block-a " }),
    resourceAttachment("unassigned-missing", { information_id: undefined }),
    resourceAttachment("block-b", { information_id: "block-b" }),
  ];

  const grouped = groupMangoResourceAttachmentsByInformationID(items);

  assert.deepEqual([...grouped.keys()], ["block-a", "", "block-b"]);
  assert.deepEqual(grouped.get("block-a")?.map((item) => item.attachment_id), [
    "block-a-first",
    "block-a-second",
  ]);
  assert.deepEqual(grouped.get("")?.map((item) => item.attachment_id), [
    "unassigned-blank",
    "unassigned-missing",
  ]);
  assert.deepEqual(grouped.get("block-b")?.map((item) => item.attachment_id), ["block-b"]);
});
