import test from "node:test";
import assert from "node:assert/strict";
import {
  createHomeMailSharedReplyDraftID,
  homeMailDraftMatchesScope,
  homeMailDraftToCompose,
  loadHomeMailDrafts,
  mergeHomeMailDrafts,
  readHomeMailDraftsForScope,
  syncHomeMailDraftFromCompose,
  supersededHomeMailDraftIDs,
  type HomeMailDraft,
} from "../../../../frontend/src/pages/home/homeMailDrafts.js";
import type { ComposeState } from "../../../../frontend/src/pages/home/homeTypes.js";

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
    collaborationID: "",
    sharedDraft: false,
    revision: 0,
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

test("shared reply drafts use one collaboration-scoped identity across participants", () => {
  assert.equal(
    createHomeMailSharedReplyDraftID("collaboration-1", "message-1"),
    "draft:shared-reply:collaboration-1:message-1",
  );
  const drafts = mergeHomeMailDrafts([
    draft({
      id: "first-client-id",
      userID: "user-a",
      collaborationID: "collaboration-1",
      sharedDraft: true,
      replyToMessageID: "message-1",
      body: "earlier",
    }),
    draft({
      id: "second-client-id",
      userID: "user-b",
      collaborationID: "collaboration-1",
      sharedDraft: true,
      replyToMessageID: "message-1",
      body: "latest",
      revision: 2,
      updatedAt: "2026-07-10T12:00:00.000Z",
    }),
  ], []);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.body, "latest");
  assert.equal(drafts[0]?.revision, 2);
});

test("canonical shared revision beats a newer local timestamp after an optimistic conflict", () => {
  const drafts = mergeHomeMailDrafts([
    draft({
      id: "draft:shared-reply:collaboration-1:message-1",
      collaborationID: "collaboration-1",
      sharedDraft: true,
      replyToMessageID: "message-1",
      body: "canonical revision",
      revision: 4,
      updatedAt: "2026-07-10T12:00:00.000Z",
    }),
  ], [
    draft({
      id: "draft:shared-reply:collaboration-1:message-1",
      collaborationID: "collaboration-1",
      sharedDraft: true,
      replyToMessageID: "message-1",
      body: "unsent local edit",
      revision: 3,
      updatedAt: "2026-07-10T13:00:00.000Z",
      pendingRemoteSync: true,
    }),
  ]);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.revision, 4);
  assert.equal(drafts[0]?.body, "canonical revision");
});

test("legacy scheduled timestamps are cleared when a shared draft opens", () => {
  assert.equal(homeMailDraftToCompose(draft({ sharedDraft: true, scheduledAt: "2026-07-14T10:00" })).scheduledAt, "");
  assert.equal(homeMailDraftToCompose(draft({ sharedDraft: false, scheduledAt: "2026-07-14T10:00" })).scheduledAt, "2026-07-14T10:00");
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

  const collaborationDraft = draft({
    id: "shared-collaboration-draft",
    sharedInboxID: "source-inbox",
    accountEmail: "source@example.test",
    collaborationID: "collaboration-1",
    sharedDraft: true,
  });
  assert.equal(homeMailDraftMatchesScope(collaborationDraft, "", "me@example.test"), true);
  assert.equal(homeMailDraftMatchesScope(collaborationDraft, "another-inbox", "other@example.test"), true);
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

test("shared-draft save reconciliation lists by participant instead of requiring the source mailbox", async () => {
  const remoteDraft = {
    company_id: "company-1",
    draft_id: "draft:shared-reply:collaboration-1:message-1",
    scope_type: "shared",
    shared_inbox_id: "source-inbox",
    account_email: "source@example.test",
    kind: "reply",
    source_message_id: "message-1",
    collaboration_id: "collaboration-1",
    is_shared: true,
    revision: 2,
    to_recipients: "recipient@example.test",
    cc_recipients: "",
    bcc_recipients: "",
    subject: "Re: Source",
    body_editor_html: "<div>Updated</div>",
    created_timestamp: "2026-07-10T10:00:00.000Z",
    updated_timestamp: "2026-07-10T12:00:00.000Z",
    attachments: [],
  };
  const requests: string[] = [];
  await withDraftBrowserState([], async () => {
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify(requests.length === 1 ? { draft: remoteDraft } : { drafts: [remoteDraft] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const compose: ComposeState = {
      open: true,
      draftID: remoteDraft.draft_id,
      sharedInboxID: remoteDraft.shared_inbox_id,
      accountEmail: remoteDraft.account_email,
      replyToMessageID: remoteDraft.source_message_id,
      replyToMessage: null,
      focusRequestID: 0,
      to: remoteDraft.to_recipients,
      cc: "",
      bcc: "",
      subject: remoteDraft.subject,
      body: remoteDraft.body_editor_html,
      attachments: [],
      scheduledAt: "",
      collaborationID: remoteDraft.collaboration_id,
      sharedDraft: true,
      draftRevision: 1,
    };

    const reconciled = await syncHomeMailDraftFromCompose("company-1", "user-1", compose, "");

    assert.equal(reconciled[0]?.revision, 2);
    const listURL = new URL(requests[1]!, "https://mango.test");
    assert.equal(listURL.searchParams.get("company_id"), "company-1");
    assert.equal(listURL.searchParams.has("shared_inbox_id"), false);
    assert.equal(listURL.searchParams.has("account_email"), false);
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
