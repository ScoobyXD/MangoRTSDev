import test from "node:test";
import assert from "node:assert/strict";
import {
  addLogicGateRaciAssignments,
  archiveEmailMessage,
  createFolderQuery,
  createCommunicationsSharedInbox,
  createMessageQuery,
  deleteCommunicationsSharedInbox,
  emailMessageMatchesListFilters,
  getEmailMessage,
  invalidateCommunicationsCache,
  listCommunicationsSharedInboxes,
  listEmailMessages,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  removeLogicGateRaciAssignments,
  unarchiveEmailMessage,
  updateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxRaciAssignments,
  type EmailMessage,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";

test("communications message query omits empty values and encodes filters", () => {
  assert.equal(
    createMessageQuery({ limit: 25, mailbox: "primary", folderID: "inbox", q: " invoice #42 ", unread: true, pageToken: "next/token" }),
    "?limit=25&page_token=next%2Ftoken&mailbox=primary&folder_id=inbox&q=invoice+%2342&unread=true",
  );
  assert.equal(createMessageQuery({ mailbox: "archive", limit: 10 }), "?limit=10&mailbox=archive");
  assert.equal(createMessageQuery({ mailbox: "starred", limit: 10 }), "?limit=10&mailbox=starred");
  assert.equal(createMessageQuery({ mailbox: "primary", refresh: true }), "?mailbox=primary&refresh=true");
  assert.equal(createMessageQuery({ mailbox: "primary", companyID: " company-1 ", sharedInboxID: " shared-1 " }), "?mailbox=primary&company_id=company-1&shared_inbox_id=shared-1");
  assert.equal(createMessageQuery({ q: "   " }), "");
});

test("communications folder query scopes shared inbox folder reads", () => {
  assert.equal(createFolderQuery({}), "");
  assert.equal(createFolderQuery({ companyID: " company-1 ", sharedInboxID: " shared-1 " }), "?company_id=company-1&shared_inbox_id=shared-1");
});

test("shared inbox helpers use communications shared inbox endpoints", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (path.startsWith("/v1/communications/shared-inboxes?")) {
      return jsonResponse({ shared_inboxes: [sharedInbox("shared-1", { name: "Business" })] });
    }
    if (path.endsWith("/raci")) {
      return jsonResponse({
        raci_assignments: [
          {
            company_id: "company-1",
            folder_id: "shared-1",
            role: "responsible",
            subject_type: "user",
            subject_id: "user-1",
            user_id: "user-1",
            created_timestamp: "2026-05-20T00:00:00.000Z",
          },
        ],
      });
    }
    if (init?.method === "DELETE") {
      return jsonResponse({ status: "deleted" });
    }
    return jsonResponse(sharedInbox(path.includes("shared-1") ? "shared-1" : "shared-2", { name: "Business" }));
  };
  try {
    const listed = await listCommunicationsSharedInboxes(" company-1 ");
    const created = await createCommunicationsSharedInbox({ companyID: "company-1", name: " Business ", accountEmail: "shared@example.com" });
    const updated = await updateCommunicationsSharedInbox({ companyID: "company-1", folderID: " shared-1 ", name: " Client Facing " });
    const access = await updateCommunicationsSharedInboxRaciAssignments("company-1", "shared-1", [{ role: "responsible", subject_type: "user", subject_id: "user-1", user_id: "user-1" }]);
    await deleteCommunicationsSharedInbox("company-1", "shared-1");

    assert.equal(listed[0]?.name, "Business");
    assert.equal(created.folder_id, "shared-2");
    assert.equal(updated.folder_id, "shared-1");
    assert.deepEqual(access.map((item) => [item.role, item.subject_type, item.subject_id, item.user_id]), [["responsible", "user", "user-1", "user-1"]]);
    assert.deepEqual(calls, [
      {
        path: "/v1/communications/shared-inboxes?company_id=company-1",
        method: "GET",
        body: undefined,
      },
      {
        path: "/v1/communications/shared-inboxes",
        method: "POST",
        body: { company_id: "company-1", name: "Business", account_email: "shared@example.com" },
      },
      {
        path: "/v1/communications/shared-inboxes/shared-1",
        method: "PUT",
        body: { company_id: "company-1", name: "Client Facing" },
      },
      {
        path: "/v1/communications/shared-inboxes/shared-1/raci",
        method: "PUT",
        body: { company_id: "company-1", assignments: [{ role: "responsible", subject_type: "user", subject_id: "user-1", user_id: "user-1" }] },
      },
      {
        path: "/v1/communications/shared-inboxes/shared-1?company_id=company-1",
        method: "DELETE",
        body: undefined,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
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

test("message pages are ordered newest first by message date", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    messages: [
      message("older", { date: 100, folders: ["inbox"] }),
      message("newest", { date: 300, folders: ["inbox"] }),
      message("middle", { date: 200, folders: ["inbox"] }),
    ],
  });
  try {
    const page = await listEmailMessages({ mailbox: "primary", limit: 25 });
    assert.deepEqual(page.messages.map((item) => item.id), ["newest", "middle", "older"]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("communications stream helpers insert created messages by message date", () => {
  const existing: EmailMessage[] = [
    message("newest", { date: 300, folders: ["inbox"] }),
    message("oldest", { date: 100, folders: ["inbox"] }),
  ];
  const created = message("middle", { date: 200, folders: ["inbox"], unread: true });

  assert.deepEqual(
    mergeEmailMessageIntoMessageList(existing, created, { limit: 25, mailbox: "primary" }, { prependIfMissing: true }).map((item) => item.id),
    ["newest", "middle", "oldest"],
  );
});

test("archive mailbox filter matches messages outside inbox but not trash or sent", () => {
  assert.equal(emailMessageMatchesListFilters(message("archived", { folders: ["UNREAD", "CATEGORY_PERSONAL"] }), { mailbox: "archive" }), true);
  assert.equal(emailMessageMatchesListFilters(message("inbox", { folders: ["INBOX", "CATEGORY_PERSONAL"] }), { mailbox: "archive" }), false);
  assert.equal(emailMessageMatchesListFilters(message("sent", { folders: ["SENT"] }), { mailbox: "archive" }), false);
});

test("starred mailbox filter only matches starred messages", () => {
  assert.equal(emailMessageMatchesListFilters(message("starred", { starred: true }), { mailbox: "starred" }), true);
  assert.equal(emailMessageMatchesListFilters(message("plain", { starred: false }), { mailbox: "starred" }), false);
});

test("archive helpers call mailbox action endpoints", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: input.toString(), method: init?.method ?? "GET" });
    return jsonResponse({ message: message("msg 1") });
  };
  try {
    await archiveEmailMessage("msg 1");
    await unarchiveEmailMessage("msg 1");
    await archiveEmailMessage("msg 2", "shared-1", "company-1");
    assert.deepEqual(calls, [
      { path: "/v1/communications/messages/msg%201/archive", method: "POST" },
      { path: "/v1/communications/messages/msg%201/unarchive", method: "POST" },
      { path: "/v1/communications/messages/msg%202/archive?company_id=company-1&shared_inbox_id=shared-1", method: "POST" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("email detail fetch ignores preview-only list cache entries", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.startsWith("/v1/communications/messages?")) {
      return jsonResponse({ messages: [message("msg-1", { subject: "Preview only" })] });
    }
    if (path === "/v1/communications/messages/msg-1") {
      return jsonResponse({ message: message("msg-1", { subject: "Preview only", body: "Full email body" }) });
    }
    return jsonResponse({ error: "not_found" }, 404);
  };
  try {
    await listEmailMessages({ mailbox: "primary", limit: 25 });
    const detail = await getEmailMessage("msg-1");
    assert.equal(detail.body, "Full email body");
    assert.deepEqual(calls, [
      "/v1/communications/messages?limit=25&mailbox=primary",
      "/v1/communications/messages/msg-1",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("message list refresh bypasses stale page cache and replaces the normal cache entry", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.includes("refresh=true")) {
      return jsonResponse({ messages: [message("fresh")] });
    }
    return jsonResponse({ messages: [message("stale")] });
  };
  try {
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages[0]?.id, "stale");
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 25, refresh: true })).messages[0]?.id, "fresh");
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages[0]?.id, "fresh");
    assert.deepEqual(calls, [
      "/v1/communications/messages?limit=25&mailbox=primary",
      "/v1/communications/messages?limit=25&mailbox=primary&refresh=true",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("logic gate RACI helpers call add and remove command endpoints", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse({
      operation: input.toString().endsWith("/remove") ? "remove" : "add",
      changed: true,
      raci_assignments: [
        {
          company_id: "company-1",
          logic_gate_id: "gate 1",
          role: "responsible",
          user_id: "user-1",
          created_timestamp: "2026-05-20T00:00:00.000Z",
        },
      ],
    });
  };
  try {
    const addResult = await addLogicGateRaciAssignments("company-1", "gate 1", [{ role: "responsible", user_id: "user-1" }]);
    const removeResult = await removeLogicGateRaciAssignments("company-1", "gate 1", [{ role: "responsible", user_id: "user-1" }]);
    assert.deepEqual(calls, [
      {
        path: "/v1/logic-gates/gate%201/raci/add",
        method: "POST",
        body: { company_id: "company-1", assignments: [{ role: "responsible", user_id: "user-1" }] },
      },
      {
        path: "/v1/logic-gates/gate%201/raci/remove",
        method: "POST",
        body: { company_id: "company-1", assignments: [{ role: "responsible", user_id: "user-1" }] },
      },
    ]);
    assert.deepEqual(addResult.map((item) => [item.role, item.user_id]), [["responsible", "user-1"]]);
    assert.deepEqual(removeResult.map((item) => [item.role, item.user_id]), [["responsible", "user-1"]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});
function message(id: string, patch: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    subject: patch.subject ?? id,
    snippet: patch.snippet,
    body: patch.body,
    date: patch.date,
    unread: patch.unread ?? false,
    starred: patch.starred ?? false,
    folders: patch.folders,
    folder_ids: patch.folder_ids,
    from: patch.from,
    to: patch.to,
  };
}

function sharedInbox(id: string, patch: Record<string, unknown> = {}) {
  return {
    company_id: "company-1",
    folder_id: id,
    folder_kind: "communications",
    name: id,
    position: 1000,
    created_timestamp: "2026-05-20T00:00:00.000Z",
    updated_timestamp: "2026-05-20T00:00:00.000Z",
    ...patch,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
