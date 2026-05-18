import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveEmailMessage,
  createMessageQuery,
  emailMessageMatchesListFilters,
  getEmailMessage,
  invalidateCommunicationsCache,
  listEmailMessages,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  unarchiveEmailMessage,
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
