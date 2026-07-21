import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmailLinkedNodeTextBlockContent,
  defaultOpenTextBlockChatIDs,
  resolveLegacyEmailChatHostBlockID,
  createOrdinaryNodeTextBlockContent,
} from "../../../../frontend/src/modules/editor/nodeTextBlockCreation.js";

test("ordinary Node plus creates an unlinked empty text box", () => {
  const content = createOrdinaryNodeTextBlockContent();
  assert.equal(content.document, "");
  assert.deepEqual(content.attachments, []);
  assert.equal(content.emailMessageID, undefined);
  assert.equal(content.emailAccent, undefined);
  assert.equal(content.title, "Hello I am a title");
});

test("explicit email action creates an email-linked text box", () => {
  const content = createEmailLinkedNodeTextBlockContent({
    title: "Email: Quarterly update",
    document: "<p>Selected quote</p>",
    messageID: " provider-message-1 ",
    accent: " #4f46e5 ",
  });
  assert.equal(content.emailMessageID, "provider-message-1");
  assert.equal(content.emailAccent, "#4f46e5");
  assert.equal(content.title, "Email: Quarterly update");
  assert.equal(content.document, "<p>Selected quote</p>");
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
