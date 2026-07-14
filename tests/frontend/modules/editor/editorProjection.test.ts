import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockContentPayload,
  buildEditorTextBlockChatPayload,
  canDeleteEditorTextBlockChatMessage,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockContent,
  parseEditorTextBlockChats,
  selectCurrentEditorTextProjection,
} from "../../../../frontend/src/modules/editor/editorProjection.js";

test("selects the newest text-box projection for the single editor document", () => {
  const selected = selectCurrentEditorTextProjection([
    { information_id: "older", type: "Text box", information: "old text", updated_timestamp: "2026-05-04T01:00:00.000Z" },
    { information_id: "status", type: "Status", information: "open", updated_timestamp: "2026-05-04T03:00:00.000Z" },
    { information_id: "newer", type: "Text box", information: "new text", updated_timestamp: "2026-05-04T02:00:00.000Z" },
  ]);

  assert.equal(selected?.information_id, "newer");
  assert.equal(selected?.information, "new text");
});

test("does not load non-text projections into the editor document", () => {
  const selected = selectCurrentEditorTextProjection([
    { information_id: "status", type: "Status", information: "open", updated_timestamp: "2026-05-04T03:00:00.000Z" },
    { information_id: "link", type: "Hyperlink", information: "https://example.test", updated_timestamp: "2026-05-04T04:00:00.000Z" },
  ]);

  assert.equal(selected, null);
});

test("lists every text-box projection newest first", () => {
  const blocks = listEditorTextBlockProjections([
    { information_id: "b", type: "Text box", information: "second", created_timestamp: "2026-05-04T02:00:00.000Z" },
    { information_id: "status", type: "Status", information: "open", created_timestamp: "2026-05-04T01:30:00.000Z" },
    { information_id: "a", type: "Text box", information: "first", created_timestamp: "2026-05-04T01:00:00.000Z" },
  ]);

  assert.deepEqual(blocks.map((block) => block.information_id), ["b", "a"]);
});

test("parses node text block chat projection payloads", () => {
  const payload = buildEditorTextBlockChatPayload({
    blockID: "block-1",
    parentID: "chat-parent",
    authorID: "user-1",
    authorName: "Ada",
    message: "Check this section",
    createdTimestamp: "2026-05-04T01:00:00.000Z",
    selectionQuote: "selected text",
    selectionStart: 12,
    selectionEnd: 25,
    mentionedUserIDs: ["user-2", "user-2", ""],
    mentionedGroupIDs: ["group-1"],
    attachments: [{ id: "local-draft-1", attachmentID: "attachment-1", name: "notes.csv", type: "text/csv", size: 42, transferState: "processing" }],
  });
  assert.equal(payload.includes("attachment_id"), true);
  assert.equal(payload.includes("data_url"), false);
  assert.equal(payload.includes("data:text/csv"), false);
  assert.equal(payload.includes("transfer_state"), false);
  const messages = parseEditorTextBlockChats([
    { information_id: "chat-1", type: "Text block chat", information: payload, created_timestamp: "2026-05-04T01:00:00.000Z" },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].blockID, "block-1");
  assert.equal(messages[0].parentID, "chat-parent");
  assert.equal(messages[0].selectionQuote, "selected text");
  assert.equal(messages[0].selectionStart, 12);
  assert.equal(messages[0].selectionEnd, 25);
  assert.equal(messages[0].authorName, "Ada");
  assert.equal(messages[0].message, "Check this section");
  assert.deepEqual(messages[0].mentionedUserIDs, ["user-2"]);
  assert.deepEqual(messages[0].mentionedGroupIDs, ["group-1"]);
  assert.deepEqual(messages[0].attachments, [{ id: "attachment-1", attachmentID: "attachment-1", name: "notes.csv", type: "text/csv", size: 42, dataURL: undefined }]);
});

test("keeps legacy chat payloads valid without parent or attachments", () => {
  const messages = parseEditorTextBlockChats([
    {
      information_id: "chat-legacy",
      type: "Text block chat",
      information: JSON.stringify({
        block_id: "block-1",
        author_name: "Ada",
        message: "Legacy message",
        created_timestamp: "2026-05-04T01:00:00.000Z",
      }),
      created_timestamp: "2026-05-04T01:00:00.000Z",
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].parentID, undefined);
  assert.deepEqual(messages[0].attachments, []);
});

test("parses legacy data-url chat attachments without emitting them from new builds", () => {
  const messages = parseEditorTextBlockChats([
    {
      information_id: "chat-legacy-attachment",
      type: "Text block chat",
      information: JSON.stringify({
        block_id: "block-1",
        author_name: "Ada",
        message: "Legacy attachment",
        created_timestamp: "2026-05-04T01:00:00.000Z",
        attachments: [
          { id: "legacy-attachment-1", name: "notes.csv", mime_type: "text/csv", byte_size: 42, data_url: "data:text/csv;base64,YSxi" },
        ],
      }),
      created_timestamp: "2026-05-04T01:00:00.000Z",
    },
  ]);

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].attachments, [{ id: "legacy-attachment-1", attachmentID: undefined, name: "notes.csv", type: "text/csv", size: 42, dataURL: "data:text/csv;base64,YSxi" }]);
});

test("parses attachment-only chat payloads", () => {
  const payload = buildEditorTextBlockChatPayload({
    blockID: "block-1",
    authorName: "Ada",
    message: "",
    createdTimestamp: "2026-05-04T01:00:00.000Z",
    attachments: [{ id: "attachment-1", name: "image.png", type: "image/png", size: 128 }],
  });
  const messages = parseEditorTextBlockChats([
    { information_id: "chat-attachment", type: "Text block chat", information: payload, created_timestamp: "2026-05-04T01:00:00.000Z" },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].message, "");
  assert.equal(messages[0].attachments[0].name, "image.png");
});

test("chat message deletion is limited to the author", () => {
  assert.equal(canDeleteEditorTextBlockChatMessage({ authorID: "user-a" }, "user-a"), true);
  assert.equal(canDeleteEditorTextBlockChatMessage({ authorID: "user-a" }, "user-b"), false);
  assert.equal(canDeleteEditorTextBlockChatMessage({ authorID: "" }, "user-a"), false);
});

test("parses titled node text block content payloads with legacy fallback", () => {
  const payload = buildEditorTextBlockContentPayload({
    title: "Decision notes",
    document: "<!-- mango-editor-html-v1 --><b>Ship it</b>",
    attachments: [{ id: "local-draft-2", attachmentID: "attachment-2", name: "diagram.png", type: "image/png", size: 128 }],
  });
  assert.equal(payload.includes("attachment_id"), true);
  assert.equal(payload.includes("data_url"), false);

  assert.deepEqual(parseEditorTextBlockContent(payload), {
    title: "Decision notes",
    document: "<!-- mango-editor-html-v1 --><b>Ship it</b>",
    attachments: [{ id: "attachment-2", attachmentID: "attachment-2", name: "diagram.png", type: "image/png", size: 128, dataURL: undefined }],
  });
  assert.deepEqual(parseEditorTextBlockContent("legacy text"), {
    title: "",
    document: "legacy text",
    attachments: [],
  });
});

test("parses attached email projection payloads", () => {
  const payload = buildEditorAttachedEmailPayload({
    collaborationID: "collaboration-1",
    messageID: "message-1",
    threadID: "thread-1",
    sharedInboxID: "shared-1",
    accountEmail: "shared@example.test",
    subject: "Contract terms",
    from: "Lee <lee@example.test>",
    attachedTimestamp: "2026-05-04T03:00:00.000Z",
  });
  const emails = parseEditorAttachedEmails([
    { information_id: "email-1", type: "Attached email", information: payload, created_timestamp: "2026-05-04T03:00:00.000Z" },
  ]);

  assert.equal(emails.length, 1);
  assert.equal(emails[0].messageID, "message-1");
  assert.equal(emails[0].collaborationID, "collaboration-1");
  assert.equal(emails[0].sharedInboxID, "shared-1");
  assert.equal(emails[0].accountEmail, "shared@example.test");
  assert.equal(emails[0].subject, "Contract terms");
});

