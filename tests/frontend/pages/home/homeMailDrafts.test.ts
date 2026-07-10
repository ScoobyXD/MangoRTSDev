import test from "node:test";
import assert from "node:assert/strict";
import { mergeHomeMailDrafts, supersededHomeMailDraftIDs, type HomeMailDraft } from "../../../../frontend/src/pages/home/homeMailDrafts.js";

function draft(overrides: Partial<HomeMailDraft>): HomeMailDraft {
  return {
    id: "draft-1",
    userID: "user-1",
    companyID: "company-1",
    sharedInboxID: "",
    accountEmail: "me@example.com",
    replyToMessageID: "",
    replyToMessage: null,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachments: [],
    scheduledAt: "",
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    ...overrides,
  };
}

test("reply drafts are unique per mailbox and source message", () => {
  const drafts = mergeHomeMailDrafts([
    draft({ id: "legacy-reply", replyToMessageID: "message-1", body: "old" }),
    draft({ id: "stable-reply", replyToMessageID: "message-1", body: "new", updatedAt: "2026-07-10T11:00:00.000Z" }),
  ], []);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.id, "stable-reply");
  assert.equal(drafts[0]?.body, "new");
});

test("reply drafts remain separate across shared inbox scopes", () => {
  const drafts = mergeHomeMailDrafts([
    draft({ id: "shared-a", sharedInboxID: "inbox-a", replyToMessageID: "message-1" }),
    draft({ id: "shared-b", sharedInboxID: "inbox-b", replyToMessageID: "message-1" }),
  ], []);

  assert.deepEqual(drafts.map((item) => item.id).sort(), ["shared-a", "shared-b"]);
});

test("remote reconciliation identifies only older semantic reply drafts for deletion", () => {
  const drafts = [
    draft({ id: "legacy-reply", replyToMessageID: "message-1", updatedAt: "2026-07-10T10:00:00.000Z" }),
    draft({ id: "stable-reply", replyToMessageID: "message-1", updatedAt: "2026-07-10T11:00:00.000Z" }),
    draft({ id: "compose-draft", replyToMessageID: "" }),
  ];

  assert.deepEqual(supersededHomeMailDraftIDs(drafts), ["legacy-reply"]);
});
