import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmailLinkedNodeTextBlockContent,
  defaultOpenTextBlockChatIDs,
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
