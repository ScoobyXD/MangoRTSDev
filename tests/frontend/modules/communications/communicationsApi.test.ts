import test from "node:test";
import assert from "node:assert/strict";
import {
  addLogicGateGVICAssignments,
  archiveEmailMessage,
  archiveEmailMessagesBatch,
  createFolderQuery,
  createCommunicationsSharedInbox,
  createMessageQuery,
  deleteCommunicationsSharedInbox,
  emailMessageMatchesListFilters,
  getEmailMessage,
  invalidateCommunicationsCache,
  listCompanyUsers,
  listLogicGates,
  listLogicGateFolderItems,
  listCommunicationsSharedInboxes,
  listEmailMessages,
  listNodeFolderItems,
  listNodes,
  markCommunicationsWorkspacePanelStale,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  removeLogicGateGVICAssignments,
  sendEmail,
  unarchiveEmailMessage,
  updateEmailMessage,
  updateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxGVICAssignments,
  type EmailMessage,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";
import { logout } from "../../../../frontend/src/auth/cognitoAuth.js";

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
    if (path === "/v1/resources/shared_inbox/shared-1/gvic") {
      return jsonResponse({
        gvic_assignments: [
          {
            company_id: "company-1",
            resource_type: "shared_inbox",
            resource_id: "shared-1",
            role: "generated",
            principal_type: "user",
            principal_id: "user-1",
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
    const access = await updateCommunicationsSharedInboxGVICAssignments("company-1", "shared-1", [{ role: "generated", principal_type: "user", principal_id: "user-1", user_id: "user-1" }]);
    await deleteCommunicationsSharedInbox("company-1", "shared-1");

    assert.equal(listed[0]?.name, "Business");
    assert.equal(created.folder_id, "shared-2");
    assert.equal(updated.folder_id, "shared-1");
    assert.deepEqual(access.map((item) => [item.role, item.principal_type, item.principal_id, item.user_id]), [["generated", "user", "user-1", "user-1"]]);
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
        path: "/v1/resources/shared_inbox/shared-1/gvic",
        method: "PUT",
        body: { company_id: "company-1", gvic_assignments: [{ role: "generated", principal_type: "user", principal_id: "user-1" }] },
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

test("workspace panel scoped stale refetches only matching resource caches", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.startsWith("/v1/logic-gates?")) return jsonResponse({ logic_gates: [{ company_id: "company-1", logic_gate_id: "gate-1", header: "Gate 1", created_timestamp: "2026-01-01T00:00:00Z" }] });
    if (path.startsWith("/v1/nodes?")) return jsonResponse({ nodes: [{ company_id: "company-1", node_id: `node-${calls.filter((call) => call.startsWith("/v1/nodes?")).length}`, name: "Node", created_timestamp: "2026-01-01T00:00:00Z" }] });
    if (path.startsWith("/v1/company-explorer/roots?")) return jsonResponse({ rows: [] });
    return jsonResponse({ folders: [], shortcuts: [], users: [] });
  };
  try {
    await listLogicGates("company-1");
    await listNodes("company-1");
    await listNodeFolderItems("company-1");
    markCommunicationsWorkspacePanelStale("company-1", { nodes: true });
    await listLogicGates("company-1");
    await listNodes("company-1");
    await listNodeFolderItems("company-1");

    assert.deepEqual(calls, [
      "/v1/logic-gates?company_id=company-1",
      "/v1/nodes?company_id=company-1",
      "/v1/company-explorer/roots?company_id=company-1",
      "/v1/nodes?company_id=company-1",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("company explorer folder item helpers do not walk collapsed child branches", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.startsWith("/v1/company-explorer/children?")) {
      assert.fail(`unexpected company explorer children request: ${path}`);
    }
    if (path.startsWith("/v1/company-explorer/roots?")) {
      return jsonResponse({
        rows: [
          {
            company_id: "company-1",
            entity_id: "folder-1",
            entity_type: "folder",
            name: "Folder",
            position: 1000,
            has_children: true,
            created_timestamp: "2026-01-01T00:00:00Z",
            updated_timestamp: "2026-01-01T00:00:00Z",
          },
          {
            company_id: "company-1",
            entity_id: "gate-entity-1",
            entity_type: "logic_gate",
            resource_id: "gate-1",
            name: "Gate 1",
            parent_entity_id: "folder-1",
            edge_id: "edge-gate-1",
            position: 1000,
            has_children: false,
            created_timestamp: "2026-01-01T00:00:00Z",
            updated_timestamp: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    return jsonResponse({});
  };
  try {
    const [nodeItems, logicGateItems] = await Promise.all([
      listNodeFolderItems("company-1"),
      listLogicGateFolderItems("company-1"),
    ]);

    assert.deepEqual(nodeItems, []);
    assert.deepEqual(logicGateItems.map((item) => [item.folder_id, item.item_id]), [["folder-1", "gate-1"]]);
    assert.deepEqual(calls, ["/v1/company-explorer/roots?company_id=company-1"]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("listCompanyUsers shares concurrent requests and caches per auth session company", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    await gate;
    return jsonResponse({ users: [{ company_id: "company-1", user_id: "user-1", email: "user@example.test", role: "company_user" }] });
  }) as typeof fetch;

  try {
    const first = listCompanyUsers("company-1");
    const second = listCompanyUsers("company-1");
    releaseGate();
    const [firstUsers, secondUsers] = await Promise.all([first, second]);
    const cachedUsers = await listCompanyUsers("company-1");

    assert.equal(calls.length, 1);
    assert.deepEqual(firstUsers.map((user) => user.user_id), ["user-1"]);
    assert.deepEqual(secondUsers.map((user) => user.user_id), ["user-1"]);
    assert.deepEqual(cachedUsers.map((user) => user.user_id), ["user-1"]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
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
  assert.equal(emailMessageMatchesListFilters(message("starred-archived", { folders: ["CATEGORY_PERSONAL"], starred: true }), { mailbox: "archive" }), true);
  assert.equal(emailMessageMatchesListFilters(message("inbox", { folders: ["INBOX", "CATEGORY_PERSONAL"] }), { mailbox: "archive" }), false);
  assert.equal(emailMessageMatchesListFilters(message("sent", { folders: ["SENT"] }), { mailbox: "archive" }), false);
});

test("primary mailbox filter matches real inbox labels, not archived Gmail category labels", () => {
  assert.equal(emailMessageMatchesListFilters(message("inbox", { folders: ["INBOX", "CATEGORY_PERSONAL"] }), { mailbox: "primary" }), true);
  assert.equal(emailMessageMatchesListFilters(message("starred-inbox", { folders: ["INBOX", "CATEGORY_PERSONAL"], starred: true }), { mailbox: "primary" }), true);
  assert.equal(emailMessageMatchesListFilters(message("archived-category", { folders: ["CATEGORY_PERSONAL"] }), { mailbox: "primary" }), false);
  assert.equal(emailMessageMatchesListFilters(message("sent", { folders: ["SENT", "INBOX"] }), { mailbox: "primary" }), false);
});

test("starred mailbox filter only matches starred messages", () => {
  assert.equal(emailMessageMatchesListFilters(message("starred", { starred: true }), { mailbox: "starred" }), true);
  assert.equal(emailMessageMatchesListFilters(message("plain", { starred: false }), { mailbox: "starred" }), false);
});

test("star updates keep inbox messages visible and add them to cached starred and all buckets", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    if (init?.method === "PUT") {
      return jsonResponse({ message: message("msg-1", { date: 300, folders: ["INBOX"], starred: false }) });
    }
    if (path.includes("mailbox=primary")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"] })] });
    if (path.includes("mailbox=starred")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=all")) return jsonResponse({ messages: [] });
    return jsonResponse({ messages: [] });
  };
  try {
    await listEmailMessages({ mailbox: "primary", limit: 25 });
    await updateEmailMessage("msg-1", { starred: true });

    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "all", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("unstar updates return cached inbox messages to primary and remove them from starred", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    if (init?.method === "PUT") {
      return jsonResponse({ message: message("msg-1", { date: 300, folders: ["INBOX"], starred: true }) });
    }
    if (path.includes("mailbox=primary")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=starred")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"], starred: true })] });
    if (path.includes("mailbox=all")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"], starred: true })] });
    return jsonResponse({ messages: [] });
  };
  try {
    await listEmailMessages({ mailbox: "primary", limit: 25 });
    await listEmailMessages({ mailbox: "starred", limit: 25 });
    await listEmailMessages({ mailbox: "all", limit: 25 });
    await updateEmailMessage("msg-1", { starred: false });

    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), ["msg-1"]);
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25 })).messages.map((item) => item.id), []);
    assert.deepEqual((await listEmailMessages({ mailbox: "all", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", false]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("archive updates add messages to archive and all overlays even before those tabs are cached", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    if (path.includes("/archive")) {
      return jsonResponse({ message: message("msg-1", { date: 300, folders: ["INBOX"], starred: true }) });
    }
    if (path.includes("mailbox=primary")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"], starred: true })] });
    if (path.includes("mailbox=archive")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=all")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=starred")) return jsonResponse({ messages: [] });
    return jsonResponse({ messages: [] });
  };
  try {
    await listEmailMessages({ mailbox: "primary", limit: 25 });
    await archiveEmailMessage("msg-1");

    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), []);
    assert.deepEqual((await listEmailMessages({ mailbox: "archive", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "all", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("background archive acceptance does not remove messages from cached primary pages", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    calls.push(path);
    if (path.includes("archive-batch")) {
      assert.equal(init?.method, "POST");
      return jsonResponse({ job_id: "job-1", accepted_ids: ["msg-1"], archived_ids: [], failed: [] });
    }
    if (path.includes("mailbox=primary")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"] }), message("msg-2", { date: 200, folders: ["INBOX"] })] });
    return jsonResponse({ messages: [] });
  };
  try {
    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), ["msg-1", "msg-2"]);
    const accepted = await archiveEmailMessagesBatch(["msg-1"], undefined, undefined, { background: true });

    assert.equal(accepted.job_id, "job-1");
    assert.deepEqual(accepted.accepted_ids, ["msg-1"]);
    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), ["msg-1", "msg-2"]);
    assert.equal(calls.filter((path) => path.includes("mailbox=primary")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("archive helpers call mailbox action endpoints", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: input.toString(), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (input.toString().includes("archive-batch")) {
      return jsonResponse({ archived_ids: ["msg 2", "msg 3"], failed: [{ message_id: "msg 4", error: "nylas_rate_limited" }] });
    }
    return jsonResponse({ message: message("msg 1") });
  };
  try {
    await archiveEmailMessage("msg 1");
    await unarchiveEmailMessage("msg 1");
    await archiveEmailMessage("msg 2", "shared-1", "company-1");
    const batch = await archiveEmailMessagesBatch(["msg 2", "msg 3", "msg 2", "msg 4"], "shared-1", "company-1");
    assert.deepEqual(batch, {
      accepted_ids: [],
      archived_ids: ["msg 2", "msg 3"],
      failed: [{ message_id: "msg 4", error: "nylas_rate_limited" }],
      job_id: undefined,
    });
    assert.deepEqual(calls, [
      { path: "/v1/communications/messages/msg%201/archive", method: "POST", body: undefined },
      { path: "/v1/communications/messages/msg%201/unarchive", method: "POST", body: undefined },
      { path: "/v1/communications/messages/msg%202/archive?company_id=company-1&shared_inbox_id=shared-1", method: "POST", body: undefined },
      {
        path: "/v1/communications/messages/archive-batch?company_id=company-1&shared_inbox_id=shared-1",
        method: "POST",
        body: { message_ids: ["msg 2", "msg 3", "msg 4"] },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("sendEmail scopes shared inbox sends through query params", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse({ message: message("sent-1", { subject: "Hello" }) });
  };
  try {
    const sent = await sendEmail({
      to: [{ email: "customer@example.test" }],
      subject: "Hello",
      body: "Body",
      company_id: " company-1 ",
      shared_inbox_id: " shared-1 ",
    });
    assert.equal(sent.id, "sent-1");
    assert.deepEqual(calls, [{
      path: "/v1/communications/messages/send?company_id=company-1&shared_inbox_id=shared-1",
      method: "POST",
      body: {
        company_id: "company-1",
        to: [{ email: "customer@example.test" }],
        subject: "Hello",
        body: "Body",
      },
    }]);
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

test("message page cache is scoped to the active auth session", async () => {
  invalidateCommunicationsCache();
  const restoreSessionStorage = installSessionStorageStub();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    return jsonResponse({ messages: [message(`message-${calls.length}`, { folders: ["inbox"] })] });
  };
  try {
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages[0]?.id, "message-1");
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages[0]?.id, "message-1");
    logout();
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages[0]?.id, "message-2");
    assert.deepEqual(calls, [
      "/v1/communications/messages?limit=25&mailbox=primary",
      "/v1/communications/messages?limit=25&mailbox=primary",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSessionStorage();
    invalidateCommunicationsCache();
  }
});

test("logic gate GVIC helpers call add and remove command endpoints", async () => {
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
      gvic_assignments: [
        {
          company_id: "company-1",
          resource_type: "logic_gate",
          resource_id: "gate 1",
          role: "generated",
          principal_type: "user",
          principal_id: "user-1",
          user_id: "user-1",
          created_timestamp: "2026-05-20T00:00:00.000Z",
        },
      ],
    });
  };
  try {
    const addResult = await addLogicGateGVICAssignments("company-1", "gate 1", [{ role: "generated", user_id: "user-1" }]);
    const removeResult = await removeLogicGateGVICAssignments("company-1", "gate 1", [{ role: "generated", user_id: "user-1" }]);
    assert.deepEqual(calls, [
      {
        path: "/v1/resources/logic_gate/gate%201/gvic/add",
        method: "POST",
        body: { company_id: "company-1", gvic_assignments: [{ role: "generated", principal_type: "user", principal_id: "user-1" }] },
      },
      {
        path: "/v1/resources/logic_gate/gate%201/gvic/remove",
        method: "POST",
        body: { company_id: "company-1", gvic_assignments: [{ role: "generated", principal_type: "user", principal_id: "user-1" }] },
      },
    ]);
    assert.deepEqual(addResult.map((item) => [item.role, item.user_id]), [["generated", "user-1"]]);
    assert.deepEqual(removeResult.map((item) => [item.role, item.user_id]), [["generated", "user-1"]]);
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

function installSessionStorageStub(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  };
}
