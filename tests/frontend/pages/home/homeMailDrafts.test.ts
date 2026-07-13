import test from "node:test";
import assert from "node:assert/strict";
import {
  homeMailDraftMatchesScope,
  loadHomeMailDrafts,
  mergeHomeMailDrafts,
  readHomeMailDraftsForScope,
  supersededHomeMailDraftIDs,
  type HomeMailDraft,
} from "../../../../frontend/src/pages/home/homeMailDrafts.js";

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

test("personal drafts remain separate across account scopes", () => {
  const drafts = mergeHomeMailDrafts([
    draft({ id: "personal-a", accountEmail: "a@example.test", replyToMessageID: "message-1" }),
    draft({ id: "personal-b", accountEmail: "b@example.test", replyToMessageID: "message-1" }),
  ], []);

  assert.deepEqual(drafts.map((item) => item.id).sort(), ["personal-a", "personal-b"]);
});

test("active draft scope never mixes personal and shared inbox rows", () => {
  const personal = draft({ id: "personal", accountEmail: "me@example.test" });
  const sharedA = draft({ id: "shared-a", sharedInboxID: "inbox-a", accountEmail: "a@example.test" });
  const sharedB = draft({ id: "shared-b", sharedInboxID: "inbox-b", accountEmail: "b@example.test" });

  assert.equal(homeMailDraftMatchesScope(personal, "", "ME@example.test"), true);
  assert.equal(homeMailDraftMatchesScope(sharedA, "", "me@example.test"), false);
  assert.equal(homeMailDraftMatchesScope(personal, "inbox-a", "a@example.test"), false);
  assert.equal(homeMailDraftMatchesScope(sharedA, "inbox-a", "a@example.test"), true);
  assert.equal(homeMailDraftMatchesScope(sharedB, "inbox-a", "a@example.test"), false);
  assert.equal(homeMailDraftMatchesScope(personal, "", ""), false);
});

test("remote reconciliation identifies only older semantic reply drafts for deletion", () => {
  const drafts = [
    draft({ id: "legacy-reply", replyToMessageID: "message-1", updatedAt: "2026-07-10T10:00:00.000Z" }),
    draft({ id: "stable-reply", replyToMessageID: "message-1", updatedAt: "2026-07-10T11:00:00.000Z" }),
    draft({ id: "compose-draft", replyToMessageID: "" }),
  ];

  assert.deepEqual(supersededHomeMailDraftIDs(drafts), ["legacy-reply"]);
});

test("an authorization failure purges only the denied draft scope from the local mirror", async () => {
  const denied = draft({ id: "shared-denied", sharedInboxID: "inbox-denied", accountEmail: "shared@example.test" });
  const retained = draft({ id: "personal-retained", accountEmail: "me@example.test" });
  await withDraftBrowserState([denied, retained], async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: "access_denied",
      message: "You do not have access to this resource.",
    }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });

    assert.deepEqual(await loadHomeMailDrafts("company-1", "user-1", "inbox-denied", "shared@example.test"), []);
    assert.deepEqual(readHomeMailDraftsForScope("company-1", "user-1", "inbox-denied", "shared@example.test"), []);
    assert.deepEqual(
      readHomeMailDraftsForScope("company-1", "user-1", "", "me@example.test").map((item) => item.id),
      ["personal-retained"],
    );
  });
});

test("a transient draft-list failure retains the active scope local mirror", async () => {
  const pending = draft({ id: "shared-pending", sharedInboxID: "inbox-a", accountEmail: "shared@example.test", pendingRemoteSync: true });
  await withDraftBrowserState([pending], async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "failed_to_list_email_drafts" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });

    assert.deepEqual(
      (await loadHomeMailDrafts("company-1", "user-1", "inbox-a", "shared@example.test")).map((item) => item.id),
      ["shared-pending"],
    );
    assert.deepEqual(
      readHomeMailDraftsForScope("company-1", "user-1", "inbox-a", "shared@example.test").map((item) => item.id),
      ["shared-pending"],
    );
  });
});

async function withDraftBrowserState(drafts: HomeMailDraft[], run: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>([[
    "mangorts.home.mailDrafts.v1:company-1:user-1",
    JSON.stringify(drafts),
  ]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
