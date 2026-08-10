import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmailLinkedNodeTextBlockContent,
  defaultOpenTextBlockChatIDs,
  nextNodeTextBlockColor,
  resolveLegacyEmailChatHostBlockID,
  createOrdinaryNodeTextBlockContent,
} from "../../../../frontend/src/modules/editor/nodeTextBlockCreation.js";

test("ordinary Node plus creates an unlinked empty text box", () => {
  const content = createOrdinaryNodeTextBlockContent();
  assert.equal(content.document, "");
  assert.deepEqual(content.attachments, []);
  assert.equal(content.emailMessageID, undefined);
  assert.equal(content.color, undefined);
  assert.equal(content.title, "Hello I am a title");
});

test("explicit email action creates an email-linked text box", () => {
  const content = createEmailLinkedNodeTextBlockContent({
    title: "Email: Quarterly update",
    document: "<p>Selected quote</p>",
    messageID: " provider-message-1 ",
    color: " #14b8a6 ",
  });
  assert.equal(content.emailMessageID, "provider-message-1");
  assert.equal(content.color, "#14B8A6");
  assert.equal(content.title, "Email: Quarterly update");
  assert.equal(content.document, "<p>Selected quote</p>");
});

test("new email-linked Node text boxes receive an explicit non-red palette color without hashing", () => {
  assert.equal(nextNodeTextBlockColor([]), "#0EA5E9");
  assert.equal(nextNodeTextBlockColor(["#0ea5e9"]), "#14B8A6");
  assert.equal(nextNodeTextBlockColor(["#0EA5E9", "#14B8A6"]), "#8B5CF6");
  assert.notEqual(nextNodeTextBlockColor([]), "#EF4444");
});

test("new and chat-free text boxes stay editor-only", () => {
  assert.deepEqual(defaultOpenTextBlockChatIDs(
    ["new-block", "existing-block"],
    [{ blockID: "existing-block" }],
  ), ["existing-block"]);
  assert.deepEqual(defaultOpenTextBlockChatIDs(["new-block"], []), []);
});

test("legacy email chat stays with its stable original text box", () => {
  const origin = { messageID: "message-1", blockID: "original-block" };
  const originalBlocks = [
    { id: "new-block", createdTimestamp: "2026-07-20T12:00:00.000Z" },
    { id: "original-block", createdTimestamp: "2026-07-19T12:00:00.000Z" },
  ];
  const hostID = resolveLegacyEmailChatHostBlockID(originalBlocks, origin);

  assert.equal(hostID, "original-block");
  assert.deepEqual(defaultOpenTextBlockChatIDs(
    originalBlocks.map((block) => block.id),
    [{ blockID: "attached-email-projection" }],
    "attached-email-projection",
    hostID,
  ), ["original-block"]);
});

test("linked message identity wins over legacy position fallbacks", () => {
  assert.equal(resolveLegacyEmailChatHostBlockID([
    { id: "newest", createdTimestamp: "2026-07-20T12:00:00.000Z" },
    { id: "linked", emailMessageID: "message-1", createdTimestamp: "2026-07-19T12:00:00.000Z" },
    { id: "declared", createdTimestamp: "2026-07-18T12:00:00.000Z" },
  ], { messageID: "message-1", blockID: "declared" }), "linked");

  assert.equal(resolveLegacyEmailChatHostBlockID([
    { id: "newest", createdTimestamp: "2026-07-20T12:00:00.000Z" },
    { id: "oldest", createdTimestamp: "2026-07-18T12:00:00.000Z" },
  ], { messageID: "message-1" }), "oldest");
});
