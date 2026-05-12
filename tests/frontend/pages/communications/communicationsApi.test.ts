import test from "node:test";
import assert from "node:assert/strict";
import {
  createMessageQuery,
  emailMessageMatchesListFilters,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  type EmailMessage,
} from "../../../../frontend/src/pages/communications/communicationsApi.js";

test("communications message query omits empty values and encodes filters", () => {
  assert.equal(
    createMessageQuery({ limit: 25, mailbox: "primary", folderID: "inbox", q: " invoice #42 ", unread: true, pageToken: "next/token" }),
    "?limit=25&page_token=next%2Ftoken&mailbox=primary&folder_id=inbox&q=invoice+%2342&unread=true",
  );
  assert.equal(createMessageQuery({ q: "   " }), "");
});

test("email address parser supports comma and semicolon lists with display names", () => {
  assert.deepEqual(parseEmailAddressList('Jane Doe <Jane@Example.com>, bad-value; ops@example.com; jane@example.com'), [
    { name: "Jane Doe", email: "jane@example.com" },
    { email: "ops@example.com" },
  ]);
});

test("communications stream helpers prepend one new inbox message without replacing the page", () => {
  const existing: EmailMessage[] = [
    message("old-1", { subject: "Old", folders: ["inbox"] }),
    message("old-2", { subject: "Older", folders: ["inbox"] }),
  ];
  const created = message("new-1", { subject: "Fresh", folders: ["inbox"], unread: true });

  assert.deepEqual(
    mergeEmailMessageIntoMessageList(existing, created, { limit: 2, mailbox: "primary" }, { prependIfMissing: true }).map((item) => item.id),
    ["new-1", "old-1"],
  );
});

test("communications stream helpers do not inject new messages into paged or searched lists", () => {
  const existing = [message("old-1", { subject: "Old", folders: ["inbox"] })];
  const created = message("new-1", { subject: "Fresh", folders: ["inbox"] });

  assert.deepEqual(
    mergeEmailMessageIntoMessageList(existing, created, { limit: 25, mailbox: "primary", pageToken: "next-page" }, { prependIfMissing: true }).map((item) => item.id),
    ["old-1"],
  );
  assert.equal(emailMessageMatchesListFilters(created, { mailbox: "primary", q: "invoice" }), false);
});

test("communications stream helpers remove updated messages that no longer match the active filter", () => {
  const existing = [message("read-1", { subject: "Read", unread: true, folders: ["inbox"] })];
  const updated = message("read-1", { subject: "Read", unread: false, folders: ["inbox"] });

  assert.deepEqual(
    mergeEmailMessageIntoMessageList(existing, updated, { limit: 25, mailbox: "primary", unread: true }).map((item) => item.id),
    [],
  );
});

function message(id: string, patch: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    subject: patch.subject ?? id,
    snippet: patch.snippet,
    body: patch.body,
    unread: patch.unread ?? false,
    starred: patch.starred ?? false,
    folders: patch.folders,
    folder_ids: patch.folder_ids,
    from: patch.from,
    to: patch.to,
  };
}
