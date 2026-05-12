import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockChatPayload,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
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
    authorID: "user-1",
    authorName: "Ada",
    message: "Check this section",
    createdTimestamp: "2026-05-04T01:00:00.000Z",
  });
  const messages = parseEditorTextBlockChats([
    { information_id: "chat-1", type: "Text block chat", information: payload, created_timestamp: "2026-05-04T01:00:00.000Z" },
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].blockID, "block-1");
  assert.equal(messages[0].authorName, "Ada");
  assert.equal(messages[0].message, "Check this section");
});

test("parses attached email projection payloads", () => {
  const payload = buildEditorAttachedEmailPayload({
    messageID: "message-1",
    threadID: "thread-1",
    subject: "Contract terms",
    from: "Lee <lee@example.test>",
    attachedTimestamp: "2026-05-04T03:00:00.000Z",
  });
  const emails = parseEditorAttachedEmails([
    { information_id: "email-1", type: "Attached email", information: payload, created_timestamp: "2026-05-04T03:00:00.000Z" },
  ]);

  assert.equal(emails.length, 1);
  assert.equal(emails[0].messageID, "message-1");
  assert.equal(emails[0].subject, "Contract terms");
});

