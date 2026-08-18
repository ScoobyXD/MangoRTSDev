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
  assert.equal("emailMessageID" in content, false);
  assert.equal(content.color, undefined);
  assert.equal(content.title, "Hello I am a title");
});

test("explicit email action creates presentation content without relationship metadata", () => {
  const content = createEmailLinkedNodeTextBlockContent({
    title: "Email: Quarterly update",
    document: "<p>Selected quote</p>",
    color: " #14b8a6 ",
  });
  assert.equal("emailMessageID" in content, false);
  assert.equal("linkedEmailMessageIDs" in content, false);
  assert.equal(content.color, "#14B8A6");
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
