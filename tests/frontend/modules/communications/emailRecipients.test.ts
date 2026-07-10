import test from "node:test";
import assert from "node:assert/strict";
import { buildReplyAllRecipients } from "../../../../frontend/src/modules/communications/emailRecipients.js";

test("reply all includes visible participants once and excludes the active mailbox", () => {
  const recipients = buildReplyAllRecipients({
    id: "message-1",
    subject: "Thread",
    unread: false,
    starred: false,
    from: [{ name: "Sender", email: "sender@example.com" }],
    to: [
      { email: "me@example.com" },
      { name: "Person", email: "person@example.com" },
    ],
    cc: [
      { email: "PERSON@example.com" },
      { email: "copy@example.com" },
    ],
    bcc: [{ email: "hidden@example.com" }],
  }, ["ME@example.com"]);

  assert.deepEqual(recipients, {
    to: [{ name: "Sender", email: "sender@example.com" }],
    cc: [
      { name: "Person", email: "person@example.com" },
      { email: "copy@example.com" },
    ],
  });
});

test("reply-to replaces from and Bcc is never propagated", () => {
  const recipients = buildReplyAllRecipients({
    id: "message-2",
    subject: "Thread",
    unread: false,
    starred: false,
    from: [{ email: "sender@example.com" }],
    reply_to: [{ email: "reply@example.com" }],
    to: [{ email: "recipient@example.com" }],
    bcc: [{ email: "hidden@example.com" }],
  });

  assert.deepEqual(recipients, {
    to: [{ email: "reply@example.com" }],
    cc: [{ email: "recipient@example.com" }],
  });
});
