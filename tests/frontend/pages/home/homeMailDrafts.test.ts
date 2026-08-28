import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  deleteHomeMailDraft,
  deleteHomeMailDraftRemote,
  ensureHomeMailDraftAttachmentTarget,
  homeMailDraftFromRemote,
  homeMailDraftMatchesScope,
  homeMailDraftToCompose,
  loadHomeMailDraft,
  loadHomeMailDrafts,
  mergeHomeMailDrafts,
  readHomeMailDraftsForScope,
  saveHomeMailDraftFromCompose,
  syncHomeMailDraftFromCompose,
  type HomeMailDraft,
} from "../../../../frontend/src/pages/home/homeMailDrafts.js";

function draft(overrides: Partial<HomeMailDraft>): HomeMailDraft {
  return {
    kind: "compose",
    id: "draft-1",
    userID: "user-1",
    companyID: "company-1",
    sharedInboxID: "",
    accountEmail: "me@example.com",
    sourceMessageID: "",
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

test("draft merging trusts server IDs instead of rebuilding reply identity in the browser", () => {
  const drafts = mergeHomeMailDrafts([
    draft({ id: "legacy-reply", replyToMessageID: "message-1", body: "old" }),
    draft({ id: "stable-reply", replyToMessageID: "message-1", body: "new", updatedAt: "2026-07-10T11:00:00.000Z" }),
  ], []);

  assert.deepEqual(drafts.map((item) => item.id), ["stable-reply", "legacy-reply"]);
});

test("a draft ID prefix never decides its compose kind", async () => {
  const raw = { ...draft({ id: "draft:reply:client-inference", accountEmail: "me@example.test" }), kind: undefined } as unknown as HomeMailDraft;
  await withDraftBrowserState([raw], async () => {
    const [loaded] = readHomeMailDraftsForScope("company-1", "user-1", "", "me@example.test");
    assert.equal(loaded?.kind, "compose");
  });
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

test("different server draft IDs are never reconciled by a client semantic key", () => {
  const drafts = mergeHomeMailDrafts([
    draft({ id: "summary", kind: "reply", sourceMessageID: "stored-message-1", replyToMessageID: "" }),
    draft({
      id: "exact",
      kind: "reply",
      sourceMessageID: "stored-message-1",
      replyToMessageID: "provider-message-1",
      updatedAt: "2026-07-10T11:00:00.000Z",
    }),
  ], []);

  assert.deepEqual(drafts.map((item) => item.id), ["exact", "summary"]);
});

test("an exact reply draft keeps the source ID but rejects an identity-only message stub", () => {
  const mapped = homeMailDraftFromRemote({
    company_id: "company-1",
    draft_id: "server-draft-1",
    scope_type: "personal",
    personal_account_email: "me@example.test",
    kind: "reply",
    source_message_id: "stored-message-1",
    to_recipients: "sender@example.test",
    cc_recipients: "",
    bcc_recipients: "",
    subject: "Re: Hello",
    body_editor_html: "",
    reply_to_message: {
      id: "provider-message-1",
      email_message_id: "stored-message-1",
      thread_id: "provider-thread-1",
    } as never,
    created_timestamp: "2026-07-10T10:00:00.000Z",
    updated_timestamp: "2026-07-10T10:00:00.000Z",
  }, "company-1", "user-1");

  assert.equal(mapped?.replyToMessageID, "provider-message-1");
  assert.equal(mapped?.replyToMessage, null);
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

for (const failure of [
  { name: "expired Mango session (401)", status: 401, code: "unauthorized" },
  { name: "unclassified forbidden response (403)", status: 403, code: "request_temporarily_forbidden" },
  { name: "provider reauthorization (409)", status: 409, code: "nylas_reauth_required" },
  { name: "disconnected personal account (409)", status: 409, code: "email_account_not_connected" },
  { name: "provider not connected (409)", status: 409, code: "nylas_not_connected" },
  { name: "disconnected shared account (409)", status: 409, code: "shared_inbox_email_account_not_connected" },
  { name: "service failure (503)", status: 503, code: "failed_to_list_email_drafts" },
]) {
  test("local draft retention: " + failure.name, async () => {
    const pending = draft({
      id: "pending-" + failure.status + "-" + failure.code,
      sharedInboxID: "inbox-a",
      accountEmail: "shared@example.test",
      pendingRemoteSync: true,
    });
    await withDraftBrowserState([pending], async ({ storedDrafts }) => {
      globalThis.fetch = async () => errorResponse(failure.status, failure.code);

      const result = await loadHomeMailDrafts("company-1", "user-1", "inbox-a", "shared@example.test");
      assert.deepEqual(result.map((item) => item.id), [pending.id]);
      assert.deepEqual(storedDrafts().map((item) => item.id), [pending.id]);
    });
  });
}

test("a network failure retains an unsynchronized local draft", async () => {
  const pending = draft({
    id: "pending-network",
    sharedInboxID: "inbox-a",
    accountEmail: "shared@example.test",
    pendingRemoteSync: true,
  });
  await withDraftBrowserState([pending], async ({ storedDrafts }) => {
    globalThis.fetch = async () => {
      throw new TypeError("network unavailable");
    };

    const result = await loadHomeMailDrafts("company-1", "user-1", "inbox-a", "shared@example.test");
    assert.deepEqual(result.map((item) => item.id), [pending.id]);
    assert.deepEqual(storedDrafts().map((item) => item.id), [pending.id]);
  });
});

for (const revocation of [
  { name: "scope access revoked", status: 403, code: "access_denied" },
  { name: "company access revoked", status: 403, code: "company_access_denied" },
  { name: "company deleted", status: 404, code: "company_not_found" },
]) {
  test("exact personal draft purge: " + revocation.name, async () => {
    const revoked = draft({ id: "account-a", accountEmail: "a@example.test", pendingRemoteSync: true });
    const retained = draft({ id: "account-b", accountEmail: "b@example.test", pendingRemoteSync: true });
    await withDraftBrowserState([revoked, retained], async ({ storedDrafts }) => {
      globalThis.fetch = async () => errorResponse(revocation.status, revocation.code);

      assert.deepEqual(await loadHomeMailDrafts("company-1", "user-1", "", "a@example.test"), []);
      assert.deepEqual(
        readHomeMailDraftsForScope("company-1", "user-1", "", "b@example.test").map((item) => item.id),
        ["account-b"],
      );
      assert.deepEqual(storedDrafts().map((item) => item.id), ["account-b"]);
    });
  });
}

for (const code of ["shared_inbox_not_found", "shared_inbox_not_mailbox"]) {
  test("exact shared draft purge: " + code, async () => {
    const deleted = draft({
      id: "shared-deleted",
      sharedInboxID: "inbox-deleted",
      accountEmail: "deleted@example.test",
      pendingRemoteSync: true,
    });
    const retainedShared = draft({
      id: "shared-retained",
      sharedInboxID: "inbox-retained",
      accountEmail: "retained@example.test",
      pendingRemoteSync: true,
    });
    const retainedPersonal = draft({ id: "personal-retained", accountEmail: "me@example.test", pendingRemoteSync: true });
    await withDraftBrowserState([deleted, retainedShared, retainedPersonal], async ({ storedDrafts }) => {
      globalThis.fetch = async () => errorResponse(code === "shared_inbox_not_found" ? 404 : 409, code);

      assert.deepEqual(
        await loadHomeMailDrafts("company-1", "user-1", "inbox-deleted", "deleted@example.test"),
        [],
      );
      assert.deepEqual(
        storedDrafts().map((item) => item.id).sort(),
        ["personal-retained", "shared-retained"],
      );
    });
  });
}

test("rapid navigation between personal accounts cannot cross-overwrite storage", async () => {
  const localA = draft({ id: "account-a", accountEmail: "a@example.test", subject: "local A" });
  const localB = draft({ id: "account-b", accountEmail: "b@example.test", subject: "local B" });
  const responseA = deferred<Response>();
  const responseB = deferred<Response>();

  await withDraftBrowserState([localA, localB], async ({ storedDrafts }) => {
    globalThis.fetch = async (input) => {
      const accountEmail = requestURL(input).searchParams.get("account_email");
      if (accountEmail === "a@example.test") return responseA.promise;
      if (accountEmail === "b@example.test") return responseB.promise;
      throw new Error("unexpected draft scope");
    };

    const loadA = loadHomeMailDrafts("company-1", "user-1", "", "a@example.test");
    const loadB = loadHomeMailDrafts("company-1", "user-1", "", "b@example.test");
    responseB.resolve(draftListResponse([
      remoteDraft({ id: "account-b", accountEmail: "b@example.test", subject: "remote B" }),
    ]));
    assert.equal((await loadB)[0]?.subject, "remote B");
    responseA.resolve(draftListResponse([
      remoteDraft({ id: "account-a", accountEmail: "a@example.test", subject: "remote A" }),
    ]));
    assert.equal((await loadA)[0]?.subject, "remote A");

    const storedByID = new Map(storedDrafts().map((item) => [item.id, item]));
    assert.equal(storedByID.get("account-a")?.subject, "remote A");
    assert.equal(storedByID.get("account-b")?.subject, "remote B");
  });
});

test("draft list summaries preserve cached full content while refreshing list fields", async () => {
  const cached = draft({
    id: "reply-summary",
    kind: "reply",
    accountEmail: "me@example.test",
    sourceMessageID: "stored-message-1",
    replyToMessageID: "provider-message-1",
    replyToMessage: {
      id: "provider-message-1",
      email_message_id: "stored-message-1",
      subject: "Source",
      unread: false,
      starred: false,
    },
    subject: "Old subject",
    body: "Full cached body",
    attachments: [{
      id: "attachment-1",
      attachmentID: "attachment-1",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 42,
    }],
    scheduledAt: "2026-07-15T08:00",
  });

  await withDraftBrowserState([cached], async ({ storedDrafts }) => {
    globalThis.fetch = async () => draftListResponse([remoteDraft({
      id: cached.id,
      kind: "reply",
      accountEmail: cached.accountEmail,
      sourceMessageID: cached.sourceMessageID,
      subject: "New subject",
      scheduledAt: "2026-07-16T09:30",
    })]);

    const [loaded] = await loadHomeMailDrafts("company-1", "user-1", "", cached.accountEmail);
    assert.equal(loaded?.subject, "New subject");
    assert.equal(loaded?.scheduledAt, "2026-07-16T09:30");
    assert.equal(loaded?.body, "Full cached body");
    assert.equal(loaded?.replyToMessageID, "provider-message-1");
    assert.deepEqual(loaded?.attachments.map((attachment) => attachment.attachmentID), ["attachment-1"]);
    assert.equal(storedDrafts()[0]?.body, "Full cached body");
  });
});

test("an exact draft read caches the full body, attachments, and provider reply target", async () => {
  const summary = draft({
    id: "scheduled-reply",
    kind: "reply",
    accountEmail: "me@example.test",
    sourceMessageID: "stored-message-1",
    scheduledAt: "2026-07-15T08:00",
  });

  await withDraftBrowserState([summary], async ({ storedDrafts }) => {
    globalThis.fetch = async () => draftSaveResponse(remoteDraft({
      id: summary.id,
      kind: "reply",
      accountEmail: summary.accountEmail,
      sourceMessageID: summary.sourceMessageID,
      replyToMessage: {
        id: "provider-message-1",
        email_message_id: "stored-message-1",
        thread_id: "provider-thread-1",
        subject: "Source",
        unread: false,
        starred: false,
      },
      body: "Full server body",
      attachments: [{
        attachment_id: "attachment-1",
        resource_attachment_id: "draft-resource-1",
        attachment: {
          original_filename: "report.pdf",
          mime_type: "application/pdf",
          byte_size: 42,
        },
      }],
      scheduledAt: "2026-07-15T08:00:00.000Z",
    }));

    const loaded = await loadHomeMailDraft("company-1", "user-1", summary);
    assert.equal(loaded?.replyToMessageID, "provider-message-1");
    assert.equal(loaded?.body, "Full server body");
    assert.deepEqual(loaded?.attachments.map((attachment) => attachment.attachmentID), ["attachment-1"]);
    assert.equal(storedDrafts()[0]?.replyToMessageID, "provider-message-1");
    assert.equal(storedDrafts()[0]?.body, "Full server body");
  });
});

test("an older same-scope load cannot overwrite a newer completed load", async () => {
  const olderResponse = deferred<Response>();
  const newerResponse = deferred<Response>();
  let requestCount = 0;

  await withDraftBrowserState([], async ({ storedDrafts }) => {
    globalThis.fetch = async () => {
      requestCount += 1;
      return requestCount === 1 ? olderResponse.promise : newerResponse.promise;
    };

    const olderLoad = loadHomeMailDrafts("company-1", "user-1", "", "me@example.test");
    const newerLoad = loadHomeMailDrafts("company-1", "user-1", "", "me@example.test");
    newerResponse.resolve(draftListResponse([
      remoteDraft({ id: "newer", accountEmail: "me@example.test", subject: "newer load" }),
    ]));
    assert.deepEqual((await newerLoad).map((item) => item.id), ["newer"]);
    olderResponse.resolve(draftListResponse([
      remoteDraft({ id: "older", accountEmail: "me@example.test", subject: "older load" }),
    ]));
    assert.deepEqual((await olderLoad).map((item) => item.id), ["newer"]);
    assert.deepEqual(storedDrafts().map((item) => item.id), ["newer"]);
  });
});

test("a local save during an older load remains authoritative in return and storage", async () => {
  const local = draft({ id: "draft-save", accountEmail: "me@example.test", subject: "before" });
  const listResponse = deferred<Response>();

  await withDraftBrowserState([local], async ({ storedDrafts }) => {
    globalThis.fetch = async () => listResponse.promise;
    const loading = loadHomeMailDrafts("company-1", "user-1", "", "me@example.test");
    saveHomeMailDraftFromCompose("company-1", "user-1", {
      ...homeMailDraftToCompose(local),
      subject: "edited while loading",
      body: "local body",
    }, "");
    listResponse.resolve(draftListResponse([
      remoteDraft({ id: "draft-save", accountEmail: "me@example.test", subject: "stale remote" }),
    ]));

    const result = await loading;
    assert.equal(result[0]?.subject, "edited while loading");
    assert.equal(result[0]?.pendingRemoteSync, true);
    assert.equal(storedDrafts()[0]?.subject, "edited while loading");
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, true);
  });
});

test("a local deletion during an older load cannot be resurrected", async () => {
  const local = draft({ id: "draft-delete", accountEmail: "me@example.test", subject: "delete me" });
  const listResponse = deferred<Response>();

  await withDraftBrowserState([local], async ({ storedDrafts }) => {
    globalThis.fetch = async () => listResponse.promise;
    const loading = loadHomeMailDrafts("company-1", "user-1", "", "me@example.test");
    deleteHomeMailDraft("company-1", "user-1", "draft-delete");
    listResponse.resolve(draftListResponse([
      remoteDraft({ id: "draft-delete", accountEmail: "me@example.test", subject: "stale remote" }),
    ]));

    assert.deepEqual(await loading, []);
    assert.deepEqual(storedDrafts(), []);
  });
});

test("a stale remote save result cannot overwrite a newer local edit", async () => {
  const local = draft({ id: "draft-sync", accountEmail: "me@example.test", subject: "before" });
  const saveResponse = deferred<Response>();

  await withDraftBrowserState([local], async ({ storedDrafts }) => {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.method, "PUT");
      return saveResponse.promise;
    };
    const firstCompose = {
      ...homeMailDraftToCompose(local),
      subject: "first edit",
      body: "first body",
    };
    const syncing = syncHomeMailDraftFromCompose("company-1", "user-1", firstCompose, "");
    saveHomeMailDraftFromCompose("company-1", "user-1", {
      ...firstCompose,
      subject: "second edit",
      body: "second body",
    }, "");
    saveResponse.resolve(draftSaveResponse(
      remoteDraft({ id: "draft-sync", accountEmail: "me@example.test", subject: "first edit" }),
    ));

    const result = await syncing;
    assert.equal(result[0]?.subject, "second edit");
    assert.equal(result[0]?.pendingRemoteSync, true);
    assert.equal(storedDrafts()[0]?.subject, "second edit");
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, true);
  });
});

test("same-draft remote saves are serialized and the newer save remains authoritative", async () => {
  const local = draft({ id: "draft-serialized", accountEmail: "me@example.test", subject: "before" });
  const firstResponse = deferred<Response>();
  const firstStarted = deferred<void>();
  const secondResponse = deferred<Response>();
  const secondStarted = deferred<void>();
  const subjects: string[] = [];

  await withDraftBrowserState([local], async ({ storedDrafts }) => {
    globalThis.fetch = async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { subject?: string };
      subjects.push(payload.subject ?? "");
      if (subjects.length === 1) {
        firstStarted.resolve(undefined);
        return firstResponse.promise;
      }
      secondStarted.resolve(undefined);
      return secondResponse.promise;
    };
    const firstCompose = { ...homeMailDraftToCompose(local), subject: "first" };
    const first = syncHomeMailDraftFromCompose("company-1", "user-1", firstCompose, "");
    const secondCompose = { ...firstCompose, subject: "second" };
    const second = syncHomeMailDraftFromCompose("company-1", "user-1", secondCompose, "");
    await firstStarted.promise;
    assert.deepEqual(subjects, ["first"]);

    firstResponse.resolve(draftSaveResponse(remoteDraft({
      id: "draft-serialized",
      accountEmail: "me@example.test",
      subject: "first",
    })));
    await secondStarted.promise;
    assert.deepEqual(subjects, ["first", "second"]);
    secondResponse.resolve(draftSaveResponse(remoteDraft({
      id: "draft-serialized",
      accountEmail: "me@example.test",
      subject: "second",
    })));

    assert.equal((await first)[0]?.subject, "second");
    assert.equal((await second)[0]?.subject, "second");
    assert.equal(storedDrafts()[0]?.subject, "second");
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, false);
  });
});

test("attachment preparation creates one live empty draft before concurrent uploads proceed", async () => {
  const saveResponse = deferred<Response>();
  const saveStarted = deferred<void>();
  const compose = homeMailDraftToCompose(draft({
    id: "draft-attachment",
    accountEmail: "me@example.test",
    subject: "",
    body: "",
  }));
  let calls = 0;

  await withDraftBrowserState([], async ({ storedDrafts }) => {
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      assert.equal(init?.method, "PUT");
      saveStarted.resolve(undefined);
      return saveResponse.promise;
    };
    const first = ensureHomeMailDraftAttachmentTarget("company-1", "user-1", compose, "");
    const second = ensureHomeMailDraftAttachmentTarget("company-1", "user-1", compose, "");
    await saveStarted.promise;
    assert.equal(calls, 1);
    assert.equal(storedDrafts()[0]?.id, "draft-attachment");
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, true);

    saveResponse.resolve(draftSaveResponse(remoteDraft({
      id: "draft-attachment",
      accountEmail: "me@example.test",
    })));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(firstResult, secondResult);
    assert.equal(firstResult[0]?.pendingRemoteSync, false);
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, false);
  });
});

test("failed attachment preparation retains the exact pending local draft", async () => {
  const compose = homeMailDraftToCompose(draft({
    id: "draft-attachment-failed",
    accountEmail: "me@example.test",
    subject: "",
    body: "",
  }));

  await withDraftBrowserState([], async ({ storedDrafts }) => {
    globalThis.fetch = async () => errorResponse(503, "provider_temporarily_unavailable");
    await assert.rejects(
      ensureHomeMailDraftAttachmentTarget("company-1", "user-1", compose, ""),
      /provider_temporarily_unavailable/,
    );
    assert.equal(storedDrafts()[0]?.id, "draft-attachment-failed");
    assert.equal(storedDrafts()[0]?.accountEmail, "me@example.test");
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, true);
  });
});

test("closing an empty prepared attachment draft deletes its durable row", async () => {
  const compose = homeMailDraftToCompose(draft({
    id: "draft-attachment-cancelled",
    accountEmail: "me@example.test",
    subject: "",
    body: "",
  }));
  const methods: string[] = [];

  await withDraftBrowserState([], async ({ storedDrafts }) => {
    globalThis.fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "PUT") {
        return draftSaveResponse(remoteDraft({
          id: "draft-attachment-cancelled",
          accountEmail: "me@example.test",
        }));
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return draftListResponse([]);
    };
    await ensureHomeMailDraftAttachmentTarget("company-1", "user-1", compose, "");
    assert.equal(storedDrafts()[0]?.pendingRemoteSync, false);

    assert.deepEqual(await syncHomeMailDraftFromCompose("company-1", "user-1", compose, ""), []);
    assert.deepEqual(methods, ["PUT", "DELETE"]);
    assert.deepEqual(storedDrafts(), []);
  });
});

test("navigation-time empty close queues behind attachment preparation and cannot be resurrected", async () => {
  const compose = homeMailDraftToCompose(draft({
    id: "draft-attachment-navigation",
    accountEmail: "me@example.test",
    subject: "",
    body: "",
  }));
  const putResponse = deferred<Response>();
  const putStarted = deferred<void>();
  const methods: string[] = [];

  await withDraftBrowserState([], async ({ storedDrafts }) => {
    globalThis.fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "PUT") {
        putStarted.resolve(undefined);
        return putResponse.promise;
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return draftListResponse([]);
    };
    const preparing = ensureHomeMailDraftAttachmentTarget("company-1", "user-1", compose, "");
    await putStarted.promise;
    const closing = syncHomeMailDraftFromCompose("company-1", "user-1", compose, "");
    assert.deepEqual(storedDrafts(), []);

    putResponse.resolve(draftSaveResponse(remoteDraft({
      id: "draft-attachment-navigation",
      accountEmail: "me@example.test",
    })));
    assert.deepEqual(await preparing, []);
    assert.deepEqual(await closing, []);
    assert.deepEqual(methods, ["PUT", "DELETE"]);
    assert.deepEqual(storedDrafts(), []);
  });
});

test("navigation autosave downgrades a preloaded Entity chip and preserves other references", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  const body = "<!-- mango-editor-html-v1 --><div>Track <span data-mango-entity-link=\"true\" data-mango-entity-type=\"entity\" data-mango-entity-id=\"entity-1\" data-mango-entity-label=\"Thailand delivery\">Thailand delivery</span> for <span data-mango-entity-link=\"true\" data-mango-entity-type=\"project\" data-mango-entity-id=\"project-1\" data-mango-entity-label=\"Costco order\">Costco order</span></div>";
  const preloaded = draft({
    id: "draft-entity-reference",
    accountEmail: "me@example.test",
    body,
  });

  try {
    await withDraftBrowserState([preloaded], async ({ storedDrafts }) => {
      let outboundBody = "";
      globalThis.fetch = async (_input, init) => {
        const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { body_editor_html?: string };
        outboundBody = payload.body_editor_html ?? "";
        return draftSaveResponse(remoteDraft({
          id: preloaded.id,
          accountEmail: preloaded.accountEmail,
          body: outboundBody,
        }));
      };

      const saved = await syncHomeMailDraftFromCompose(
        "company-1",
        "user-1",
        homeMailDraftToCompose(preloaded),
        "",
      );

      assert.match(outboundBody, /Track Thailand delivery for/);
      assert.doesNotMatch(outboundBody, /data-mango-entity-type="entity"|data-mango-entity-id="entity-1"/);
      assert.match(outboundBody, /data-mango-entity-type="project"/);
      assert.match(outboundBody, /data-mango-entity-id="project-1"/);
      assert.equal(saved[0]?.body, outboundBody);
      assert.equal(storedDrafts()[0]?.body, outboundBody);
    });
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  }
});

test("a delete queued behind a stalled load-time migration removes the remote draft and cannot resurrect local state", async () => {
  const pending = draft({
    id: "draft-load-migration-delete",
    accountEmail: "me@example.test",
    subject: "pending migration",
    pendingRemoteSync: true,
  });
  const putResponse = deferred<Response>();
  const putStarted = deferred<void>();
  const methods: string[] = [];

  await withDraftBrowserState([pending], async ({ storedDrafts }) => {
    globalThis.fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "GET") return draftListResponse([]);
      if (method === "PUT") {
        putStarted.resolve(undefined);
        return putResponse.promise;
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error("unexpected draft request");
    };

    const loading = loadHomeMailDrafts("company-1", "user-1", "", "me@example.test");
    await putStarted.promise;
    const deleting = deleteHomeMailDraftRemote("company-1", "user-1", pending.id);
    assert.deepEqual(storedDrafts(), []);

    putResponse.resolve(draftSaveResponse(remoteDraft({
      id: pending.id,
      accountEmail: "me@example.test",
      subject: "pending migration",
    })));

    assert.deepEqual(await loading, []);
    assert.deepEqual(await deleting, []);
    assert.deepEqual(methods, ["GET", "PUT", "DELETE"]);
    assert.deepEqual(storedDrafts(), []);
  });
});

type DraftBrowserState = {
  storedDrafts: () => HomeMailDraft[];
};

async function withDraftBrowserState<T>(
  drafts: unknown[],
  run: (state: DraftBrowserState) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storageKey = "mangorts.home.mailDrafts.v1:company-1:user-1";
  const values = new Map<string, string>([[
    storageKey,
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
    return await run({
      storedDrafts: () => JSON.parse(values.get(storageKey) ?? "[]") as HomeMailDraft[],
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function draftListResponse(drafts: unknown[]): Response {
  return new Response(JSON.stringify({ drafts }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function draftSaveResponse(draft: unknown): Response {
  return new Response(JSON.stringify({ draft }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function remoteDraft(input: {
  id: string;
  accountEmail: string;
  sharedInboxID?: string;
  kind?: "compose" | "reply" | "forward";
  sourceMessageID?: string;
  replyToMessage?: Record<string, unknown>;
  subject?: string;
  body?: string;
  attachments?: unknown[];
  scheduledAt?: string;
  updatedAt?: string;
}): Record<string, unknown> {
  const sharedInboxID = input.sharedInboxID ?? "";
  return {
    company_id: "company-1",
    draft_id: input.id,
    scope_type: sharedInboxID ? "shared" : "personal",
    personal_user_id: sharedInboxID ? undefined : "user-1",
    personal_account_email: sharedInboxID ? undefined : input.accountEmail,
    shared_inbox_id: sharedInboxID || undefined,
    kind: input.kind ?? "compose",
    source_message_id: input.sourceMessageID ?? "",
    account_email: input.accountEmail,
    to_recipients: "",
    cc_recipients: "",
    bcc_recipients: "",
    subject: input.subject ?? "",
    body_editor_html: input.body ?? "",
    reply_to_message: input.replyToMessage,
    scheduled_send_timestamp: input.scheduledAt ?? "",
    created_timestamp: "2026-07-10T10:00:00.000Z",
    updated_timestamp: input.updatedAt ?? "2026-07-14T10:00:00.000Z",
    attachments: input.attachments ?? [],
  };
}

function requestURL(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), "http://localhost");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
