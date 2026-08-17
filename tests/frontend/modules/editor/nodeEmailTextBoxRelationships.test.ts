import assert from "node:assert/strict";
import test from "node:test";

import {
  compareStoredEmailTimestamps,
  EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME,
  linkedEmailMessageAccents,
  normalizeLinkedEmailMessageIDs,
  parseEmailMessageTextBoxLinkDrag,
  textBoxHasLinkedEmailMessage,
  textBoxMatchesEmailSelection,
  writeEmailMessageTextBoxLinkDrag,
} from "../../../../frontend/src/modules/editor/nodeEmailTextBoxRelationships.js";

class TestDataTransfer {
  effectAllowed = "none";
  private readonly values = new Map<string, string>();

  get types(): string[] {
    return Array.from(this.values.keys());
  }

  getData(type: string): string {
    return this.values.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }
}

function testDataTransfer(): [TestDataTransfer, DataTransfer] {
  const transfer = new TestDataTransfer();
  return [transfer, transfer as unknown as DataTransfer];
}

test("canonical textbox message lists normalize once and drive full membership", () => {
  const linkedEmailMessageIDs = normalizeLinkedEmailMessageIDs([
    " message-a ",
    "message-b",
    "message-a",
    "",
    42,
  ]);
  const textBox = { linkedEmailMessageIDs };

  assert.deepEqual(linkedEmailMessageIDs, ["message-a", "message-b"]);
  assert.equal(textBoxHasLinkedEmailMessage(textBox, "message-a"), true);
  assert.equal(textBoxHasLinkedEmailMessage(textBox, "message-b"), true);
  assert.equal(textBoxHasLinkedEmailMessage(textBox, "provider-message-b"), false);
});

test("staged message identity is presentation-only for a temporary highlighted-chat textbox", () => {
  const persisted = { linkedEmailMessageIDs: [], stagedEmailMessageID: "message-b", temporaryEmailChat: false };
  const temporary = { ...persisted, temporaryEmailChat: true };

  assert.equal(textBoxMatchesEmailSelection(persisted, "message-b"), false);
  assert.equal(textBoxMatchesEmailSelection(temporary, "message-b"), true);
});

test("every exact linked message receives its textbox color and unrelated thread messages remain neutral", () => {
  const accents = linkedEmailMessageAccents([
    { linkedEmailMessageIDs: ["message-a", "message-b"], color: " #0EA5E9 " },
  ]);

  assert.deepEqual(accents, { "message-a": "#0EA5E9", "message-b": "#0EA5E9" });
  assert.equal(accents["message-c"], undefined);
});

test("linked messages sort globally by stored timestamp with deterministic missing-date order", () => {
  const messages = [
    { emailMessageID: "message-c" },
    { emailMessageID: "message-b", date: 20 },
    { emailMessageID: "message-a", date: 10 },
    { emailMessageID: "message-d" },
  ];

  assert.deepEqual(
    messages.sort(compareStoredEmailTimestamps).map((message) => message.emailMessageID),
    ["message-a", "message-b", "message-c", "message-d"],
  );
});

test("exact message-link drag carries only internal relationship identity", () => {
  const [rawTransfer, transfer] = testDataTransfer();
  writeEmailMessageTextBoxLinkDrag(transfer, " internal-message-b ", " textbox-2 ");

  assert.equal(rawTransfer.effectAllowed, "move");
  assert.deepEqual(
    JSON.parse(rawTransfer.getData(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME)),
    { email_message_id: "internal-message-b", source_textbox_id: "textbox-2" },
  );
  assert.deepEqual(parseEmailMessageTextBoxLinkDrag(transfer), {
    emailMessageID: "internal-message-b",
    sourceTextBoxID: "textbox-2",
  });
});

test("whole-email and provider-shaped drag payloads cannot become textbox relationship commands", () => {
  const [, wholeEmailTransfer] = testDataTransfer();
  wholeEmailTransfer.setData("application/x-mango-email-message", JSON.stringify({
    messageID: "provider-message-b",
    emailMessageID: "internal-message-b",
  }));
  assert.equal(parseEmailMessageTextBoxLinkDrag(wholeEmailTransfer), null);

  const [, providerTransfer] = testDataTransfer();
  providerTransfer.setData(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME, JSON.stringify({ message_id: "provider-message-b" }));
  assert.equal(parseEmailMessageTextBoxLinkDrag(providerTransfer), null);
});
