import assert from "node:assert/strict";
import test from "node:test";

import { condenseEmailThreadMessages } from "../../../../frontend/src/modules/communications/emailThreads.js";
import type { EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import { mergeUniversalPickerEmailMessages } from "../../../../frontend/src/modules/editor/UniversalPickerEmailPane.js";

function message(input: Partial<EmailMessage> & Pick<EmailMessage, "id">): EmailMessage {
  return {
    id: input.id,
    subject: input.subject ?? "Subject",
    unread: input.unread ?? false,
    starred: input.starred ?? false,
    ...input,
  };
}

test("provider reconciliation preserves durable Mango IDs and uses provider order", () => {
  const local = [
    message({ id: "message-new", thread_id: "thread-1", email_message_id: "internal-new", subject: "Stored subject", date: 200 }),
    message({ id: "message-old", thread_id: "thread-1", email_message_id: "internal-old", date: 100 }),
  ];
  const provider = [
    message({ id: "message-new", thread_id: "thread-1", subject: "Provider subject", date: 201, unread: true }),
    message({ id: "message-other", thread_id: "thread-2", subject: "Provider only", date: 150 }),
  ];

  const merged = mergeUniversalPickerEmailMessages(local, provider, true);
  assert.deepEqual(merged.map((item) => item.id), ["message-new", "message-other", "message-old"]);
  assert.equal(merged[0]?.subject, "Provider subject");
  assert.equal(merged[0]?.email_message_id, "internal-new", "provider truth must not erase the durable Mango identity");
});

test("the picker condenses merged results with the same helper used by triage", () => {
  const merged = mergeUniversalPickerEmailMessages([
    message({ id: "message-new", thread_id: "thread-1", email_message_id: "internal-new", date: 200, unread: false }),
    message({ id: "message-old", thread_id: "thread-1", email_message_id: "internal-old", date: 100, unread: true }),
  ], [
    message({ id: "message-new", thread_id: "thread-1", date: 201, unread: false }),
    message({ id: "message-other", thread_id: "thread-2", date: 150 }),
  ], true);

  const visible = condenseEmailThreadMessages(merged);
  assert.equal(visible.length, 2);
  assert.equal(visible[0]?.id, "message-new");
  assert.equal(visible[0]?.thread_message_count, 2);
  assert.equal(visible[0]?.unread, true, "an unread older message keeps the condensed thread unread");
});
