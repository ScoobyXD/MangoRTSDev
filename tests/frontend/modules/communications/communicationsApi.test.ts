import test from "node:test";
import assert from "node:assert/strict";
import {
  addLogicGateGVICAssignments,
  addLocalEmailReply,
  archiveEmailMessage,
  archiveEmailMessagesBatch,
  createFolderQuery,
  createCommunicationsSharedInbox,
  createMessageQuery,
  convertTriageMessagesToExplorerTarget,
  deleteCommunicationsSharedInbox,
  downloadEmailAttachment,
  deleteEmailDraft,
  emailMessageMatchesListFilters,
  fetchCommunicationsStatus,
  getEmailMessage,
  getEmailSignature,
  getEmailThread,
  invalidateCommunicationsCache,
  invalidateCommunicationsFolderCache,
  invalidateEmailMessageCache,
  listCompanyUsers,
  listCompanyUserGroups,
  listLogicGates,
  listLogicGateFolderItems,
  listCommunicationsSharedInboxes,
  listEmailDrafts,
  listEmailFolders,
  listEmailMessages,
  listNodeFolderItems,
  listNodes,
  markCommunicationsWorkspacePanelStale,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  patchEmailMessagesLogicGatePlacement,
  removeCommunicationsSharedInbox,
  removeLogicGateGVICAssignments,
  respondToCalendarInvite,
  saveEmailSignature,
  saveEmailDraft,
  sendEmail,
  unarchiveEmailMessage,
  updateEmailMessage,
  updateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxGVICAssignments,
  type EmailMessage,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";
import { logout } from "../../../../frontend/src/auth/cognitoAuth.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test("communications message query omits empty values and encodes filters", () => {
  assert.equal(
    createMessageQuery({ limit: 25, mailbox: "primary", folderID: "inbox", q: " invoice #42 ", unread: true, pageToken: "next/token" }),
    "?limit=25&page_token=next%2Ftoken&mailbox=primary&folder_id=inbox&q=invoice+%2342&unread=true",
  );
  assert.equal(createMessageQuery({ mailbox: "archive", limit: 10 }), "?limit=10&mailbox=archive");
  assert.equal(createMessageQuery({ mailbox: "starred", limit: 10 }), "?limit=10&mailbox=starred");
  assert.equal(createMessageQuery({ mailbox: "spam", limit: 10 }), "?limit=10&mailbox=spam");
  assert.equal(createMessageQuery({ mailbox: "primary", refresh: true }), "?mailbox=primary&refresh=true");
  assert.equal(createMessageQuery({ mailbox: "primary", companyID: " company-1 ", sharedInboxID: " shared-1 " }), "?mailbox=primary&company_id=company-1&shared_inbox_id=shared-1");
  assert.equal(createMessageQuery({ q: "   " }), "");
});

test("communications folder query scopes shared inbox folder reads", () => {
  assert.equal(createFolderQuery({}), "");
  assert.equal(createFolderQuery({ companyID: " company-1 ", sharedInboxID: " shared-1 " }), "?company_id=company-1&shared_inbox_id=shared-1");
});

test("calendar RSVP uses message identity and shared mailbox scope", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse({ status: "responded", rsvp_status: "maybe", event_id: "event-1", calendar_id: "primary" });
  };
  try {
    const response = await respondToCalendarInvite({
      messageID: " message-1 ",
      status: "maybe",
      companyID: " company-1 ",
      sharedInboxID: " shared-1 ",
    });
    assert.equal(response.rsvp_status, "maybe");
    assert.deepEqual(calls, [{
      path: "/v1/communications/calendar-invites/respond?company_id=company-1&shared_inbox_id=shared-1",
      method: "POST",
      body: { message_id: "message-1", status: "maybe" },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email signature helpers preserve exact personal and shared mailbox scope", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse({
      signature: {
        company_id: "company-1",
        signature_id: "signature-1",
        scope_type: "personal",
        name: "Default",
        body_editor_html: "Regards",
        is_default: true,
        created_timestamp: "2026-07-10T00:00:00Z",
        updated_timestamp: "2026-07-10T00:00:00Z",
      },
    });
  };
  try {
    await getEmailSignature(" company-1 ", "", " person@example.test ");
    await getEmailSignature("company-1", " shared-1 ", "ignored@example.test");
    await saveEmailSignature({ companyID: "company-1", accountEmail: " person@example.test ", bodyEditorHTML: "Regards" });
    await saveEmailSignature({ companyID: "company-1", sharedInboxID: " shared-1 ", accountEmail: "ignored@example.test", bodyEditorHTML: "Shared regards" });

    assert.deepEqual(calls, [
      {
        path: "/v1/communications/signature?company_id=company-1&account_email=person%40example.test",
        method: "GET",
        body: undefined,
      },
      {
        path: "/v1/communications/signature?company_id=company-1&shared_inbox_id=shared-1",
        method: "GET",
        body: undefined,
      },
      {
        path: "/v1/communications/signature",
        method: "PUT",
        body: { company_id: "company-1", account_email: "person@example.test", body_editor_html: "Regards", is_default: true },
      },
      {
        path: "/v1/communications/signature",
        method: "PUT",
        body: { company_id: "company-1", shared_inbox_id: "shared-1", body_editor_html: "Shared regards", is_default: true },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("triage conversion payload can target a specific Kanban column", async () => {
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
      target: { mode: "existing_logic_gate", logic_gate_id: "gate-1" },
      board: { company_id: "company-1", board_id: "logic-gate:gate-1", logic_gate_id: "gate-1", title: "Gate", position: 1000, created_timestamp: "2026-05-20T00:00:00.000Z", updated_timestamp: "2026-05-20T00:00:00.000Z" },
      cards: [],
      nodes: [],
      deleted_message_ids: ["msg-1"],
    }, 201);
  };
  try {
    await convertTriageMessagesToExplorerTarget({
      companyID: "company-1",
      sharedInboxID: " shared-1 ",
      target: { mode: "existing_logic_gate", logicGateID: "gate-1" },
      messageIDs: [" msg-1 "],
      columnID: " review ",
    });
    assert.deepEqual(calls, [{
      path: "/v1/communications/triage/convert",
      method: "POST",
      body: {
        company_id: "company-1",
        shared_inbox_id: "shared-1",
        target: { mode: "existing_logic_gate", logic_gate_id: "gate-1" },
        message_ids: ["msg-1"],
        column_id: "review",
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    await removeCommunicationsSharedInbox("company-1", "shared-1");

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
      {
        path: "/v1/communications/shared-inboxes/shared-1?company_id=company-1&remove_only=true",
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

test("listCompanyUserGroups shares node-open reference reads and honors scoped invalidation", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({
      groups: [{ company_id: "company-1", group_id: `group-${calls}`, name: "Team", position: 1 }],
      members: [],
    });
  }) as typeof fetch;
  try {
    const [first, strictModeReplay] = await Promise.all([
      listCompanyUserGroups("company-1"),
      listCompanyUserGroups("company-1"),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.groups[0]?.group_id, "group-1");
    assert.equal(strictModeReplay.groups[0]?.group_id, "group-1");
    assert.equal((await listCompanyUserGroups("company-1")).groups[0]?.group_id, "group-1");
    assert.equal(calls, 1);

    markCommunicationsWorkspacePanelStale("company-1", { userGroups: true });
    assert.equal((await listCompanyUserGroups("company-1")).groups[0]?.group_id, "group-2");
    assert.equal(calls, 2);
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
  assert.equal(emailMessageMatchesListFilters(message("social", { folders: ["INBOX", "CATEGORY_SOCIAL"] }), { mailbox: "primary" }), false);
  assert.equal(emailMessageMatchesListFilters(message("promotions", { folder_ids: ["INBOX", "CATEGORY_PROMOTIONS"] }), { mailbox: "primary" }), false);
  assert.equal(emailMessageMatchesListFilters(message("archived-category", { folders: ["CATEGORY_PERSONAL"] }), { mailbox: "primary" }), false);
  assert.equal(emailMessageMatchesListFilters(message("sent", { folders: ["SENT", "INBOX"] }), { mailbox: "primary" }), false);
});

test("primary cache overlays never insert or retain social and promotions messages", () => {
  for (const category of ["CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS"]) {
    const categorized = message(category, { folders: ["INBOX", category], starred: false });
    assert.deepEqual(
      mergeEmailMessageIntoMessageList([], categorized, { limit: 25, mailbox: "primary" }, { prependIfMissing: true }),
      [],
    );
    assert.deepEqual(
      mergeEmailMessageIntoMessageList([categorized], { ...categorized, starred: true }, { limit: 25, mailbox: "primary" }),
      [],
    );
  }
});

test("starred mailbox filter only matches starred messages", () => {
  assert.equal(emailMessageMatchesListFilters(message("starred", { starred: true }), { mailbox: "starred" }), true);
  assert.equal(emailMessageMatchesListFilters(message("plain", { starred: false }), { mailbox: "starred" }), false);
});

test("spam mailbox filter matches spam and junk messages only", () => {
  assert.equal(emailMessageMatchesListFilters(message("spam", { folders: ["SPAM"] }), { mailbox: "spam" }), true);
  assert.equal(emailMessageMatchesListFilters(message("junk", { folders: ["JUNK"] }), { mailbox: "spam" }), true);
  assert.equal(emailMessageMatchesListFilters(message("inbox", { folders: ["INBOX"] }), { mailbox: "spam" }), false);
});

test("logic gate placement patch keeps cached email rows visible", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  let primaryFetches = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    if (path.includes("mailbox=primary")) {
      primaryFetches += 1;
      return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"] })] });
    }
    if (path.includes("mailbox=all")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"] })] });
    return jsonResponse({ messages: [] });
  };
  try {
    await listEmailMessages({ mailbox: "primary", limit: 25 });
    await listEmailMessages({ mailbox: "all", limit: 25 });
    patchEmailMessagesLogicGatePlacement(["msg-1"], "gate-1");

    const primary = await listEmailMessages({ mailbox: "primary", limit: 25 });
    const all = await listEmailMessages({ mailbox: "all", limit: 25 });
    assert.equal(primaryFetches, 1);
    assert.deepEqual(primary.messages.map((item) => [item.id, item.logic_gate_count, item.logic_gate_ids]), [["msg-1", 1, ["gate-1"]]]);
    assert.deepEqual(all.messages.map((item) => [item.id, item.logic_gate_count, item.logic_gate_ids]), [["msg-1", 1, ["gate-1"]]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
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

test("read and archive overlays never cross personal and shared mailbox cache scopes with colliding provider ids", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  let personalFetches = 0;
  let sharedFetches = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    if (init?.method === "PUT") {
      return jsonResponse({ message: message("collision-1", { subject: "Shared", folders: ["INBOX"], unread: true }) });
    }
    if (path.includes("/archive")) {
      return jsonResponse({ message: message("collision-1", { subject: "Shared", folders: ["INBOX"], unread: false }) });
    }
    if (path.includes("mailbox=primary") && path.includes("shared_inbox_id=shared-1")) {
      sharedFetches += 1;
      return jsonResponse({ messages: [message("collision-1", { subject: "Shared", folders: ["INBOX"], unread: true })] });
    }
    if (path.includes("mailbox=primary") && path.includes("company_id=company-1")) {
      personalFetches += 1;
      return jsonResponse({ messages: [message("collision-1", { subject: "Personal", folders: ["INBOX"], unread: true })] });
    }
    return jsonResponse({ messages: [] });
  };
  try {
    const personalParams = { mailbox: "primary" as const, limit: 25, companyID: "company-1" };
    const sharedParams = { ...personalParams, sharedInboxID: "shared-1" };
    await listEmailMessages(personalParams);
    await listEmailMessages(sharedParams);

    await updateEmailMessage("collision-1", { unread: false }, "shared-1", "company-1");
    assert.deepEqual(
      (await listEmailMessages(personalParams)).messages.map((item) => [item.subject, item.unread]),
      [["Personal", true]],
    );
    assert.deepEqual(
      (await listEmailMessages(sharedParams)).messages.map((item) => [item.subject, item.unread]),
      [["Shared", false]],
    );

    await archiveEmailMessage("collision-1", "shared-1", "company-1");
    assert.deepEqual((await listEmailMessages(personalParams)).messages.map((item) => item.subject), ["Personal"]);
    assert.deepEqual((await listEmailMessages(sharedParams)).messages.map((item) => item.id), []);
    assert.equal(personalFetches, 1);
    assert.equal(sharedFetches, 1);
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
    assert.equal(sent.body, "Body");
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

test("sendEmail leaves reply-history persistence to the caller", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.includes("/messages/send")) {
      return jsonResponse({ message: message("sent-reply", { thread_id: "thread-1", body: "Sent reply" }) });
    }
    return jsonResponse({ message: message("inbound-1", { thread_id: "thread-1", body: "Inbound body" }) });
  };
  try {
    await getEmailMessage("inbound-1", "company-1", "shared-1");
    await sendEmail({
      to: [{ email: "customer@example.test" }],
      subject: "Re: Hello",
      body: "Sent reply",
      reply_to_message_id: "inbound-1",
      company_id: "company-1",
      shared_inbox_id: "shared-1",
    });

    const cachedInbound = await getEmailMessage("inbound-1", "company-1", "shared-1");
    assert.equal(cachedInbound.local_replies, undefined);
    assert.deepEqual(calls, [
      "/v1/communications/messages/inbound-1?company_id=company-1&shared_inbox_id=shared-1",
      "/v1/communications/messages/send?company_id=company-1&shared_inbox_id=shared-1",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("durable draft API requires and preserves one exact personal or shared scope", async () => {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  const draft = {
    company_id: "company-1",
    draft_id: "draft-1",
    scope_type: "personal",
    personal_user_id: "user-1",
    personal_account_email: "me@example.test",
    kind: "compose",
    to_recipients: "",
    cc_recipients: "",
    bcc_recipients: "",
    subject: "Scoped",
    body_editor_html: "",
    created_timestamp: "2026-07-13T12:00:00Z",
    updated_timestamp: "2026-07-13T12:00:00Z",
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    });
    if ((init?.method ?? "GET") === "DELETE") return jsonResponse({ status: "deleted" });
    if (path.includes("/drafts/draft-1") && init?.method === "PUT") {
      return jsonResponse({ draft: { ...draft, scope_type: "shared", shared_inbox_id: "shared-1" } });
    }
    if (path.includes("/drafts/draft-1")) return jsonResponse({ draft });
    return jsonResponse({ drafts: [draft] });
  };
  try {
    await assert.rejects(() => listEmailDrafts("company-1", {}), /email_draft_scope_required/);
    await listEmailDrafts("company-1", { accountEmail: " Me@Example.Test " });
    await listEmailDrafts("company-1", { sharedInboxID: " shared-1 " });
    await saveEmailDraft({
      companyID: "company-1",
      draftID: "draft-1",
      sharedInboxID: "shared-1",
      to: "",
      cc: "",
      bcc: "",
      subject: "Scoped",
      bodyEditorHTML: "",
    });
    await deleteEmailDraft("company-1", "draft-1", { sharedInboxID: "shared-1" });

    assert.deepEqual(calls.map((call) => [call.method, call.path]), [
      ["GET", "/v1/communications/drafts?company_id=company-1&account_email=me%40example.test"],
      ["GET", "/v1/communications/drafts?company_id=company-1&shared_inbox_id=shared-1"],
      ["PUT", "/v1/communications/drafts/draft-1"],
      ["DELETE", "/v1/communications/drafts/draft-1?company_id=company-1&shared_inbox_id=shared-1"],
    ]);
    assert.equal(calls[2]?.body?.shared_inbox_id, "shared-1");
    assert.equal(calls[2]?.body?.company_id, "company-1");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("locally persisted sent replies are isolated by authenticated mailbox scope", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.fetch = async () => jsonResponse({
    message: message("inbound-1", { thread_id: "thread-1", body: "Inbound" }),
  });
  const sentReply = message("sent-1", {
    thread_id: "thread-1",
    body: "User reply",
    folders: ["sent"],
    unread: false,
  });
  try {
    addLocalEmailReply("inbound-1", sentReply, {
      companyID: "company-1",
      userID: "user-a",
      accountEmail: "a@example.test",
    });
    invalidateCommunicationsCache();
    const owner = await getEmailMessage("inbound-1", "company-1", undefined, {
      userID: "user-a",
      accountEmail: "a@example.test",
    });
    assert.deepEqual(owner.local_replies?.map((reply) => reply.id), ["sent-1"]);

    invalidateCommunicationsCache();
    const otherUser = await getEmailMessage("inbound-1", "company-1", undefined, {
      userID: "user-b",
      accountEmail: "b@example.test",
    });
    assert.equal(otherUser.local_replies, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
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

test("email detail invalidation keeps the replacement request in flight and authoritative", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const staleResponse = deferred<Response>();
  const freshResponse = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? staleResponse.promise : freshResponse.promise;
  }) as typeof fetch;
  try {
    const staleRead = getEmailMessage("race-message", "company-1");
    assert.equal(calls, 1);

    invalidateEmailMessageCache("race-message", "company-1");
    const freshRead = getEmailMessage("race-message", "company-1");
    assert.equal(calls, 2);

    staleResponse.resolve(jsonResponse({ message: message("race-message", { subject: "Obsolete detail", body: "Old" }) }));
    assert.equal((await staleRead).subject, "Obsolete detail");

    const coalescedRead = getEmailMessage("race-message", "company-1");
    assert.equal(calls, 2);

    freshResponse.resolve(jsonResponse({ message: message("race-message", { subject: "Fresh detail", body: "New" }) }));
    assert.equal((await freshRead).subject, "Fresh detail");
    assert.equal((await coalescedRead).subject, "Fresh detail");
    assert.equal((await getEmailMessage("race-message", "company-1")).subject, "Fresh detail");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("status invalidation prevents an obsolete request from replacing the current session cache", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const staleResponse = deferred<Response>();
  const freshResponse = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? staleResponse.promise : freshResponse.promise;
  }) as typeof fetch;
  try {
    const staleRead = fetchCommunicationsStatus();
    invalidateCommunicationsCache({ status: true });
    const freshRead = fetchCommunicationsStatus();

    freshResponse.resolve(jsonResponse({ configured: true, connected: true, status: "connected" }));
    assert.equal((await freshRead).connected, true);
    staleResponse.resolve(jsonResponse({ configured: true, connected: false, status: "disconnected" }));
    assert.equal((await staleRead).connected, false);

    assert.equal((await fetchCommunicationsStatus()).connected, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("folder invalidation keeps the replacement unread counts authoritative", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const staleResponse = deferred<Response>();
  const freshResponse = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? staleResponse.promise : freshResponse.promise;
  }) as typeof fetch;
  try {
    const staleRead = listEmailFolders({ companyID: "company-1" });
    invalidateCommunicationsFolderCache();
    const freshRead = listEmailFolders({ companyID: "company-1" });

    freshResponse.resolve(jsonResponse({ folders: [{ id: "inbox", name: "Inbox", unread_count: 1 }] }));
    assert.equal((await freshRead)[0]?.unread_count, 1);
    staleResponse.resolve(jsonResponse({ folders: [{ id: "inbox", name: "Inbox", unread_count: 9 }] }));
    assert.equal((await staleRead)[0]?.unread_count, 9);

    assert.equal((await listEmailFolders({ companyID: "company-1" }))[0]?.unread_count, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("message-page invalidation prevents an obsolete arrival snapshot from replacing the refresh", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const staleResponse = deferred<Response>();
  const freshResponse = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1 ? staleResponse.promise : freshResponse.promise;
  }) as typeof fetch;
  const params = { mailbox: "primary" as const, limit: 25, companyID: "company-1" };
  try {
    const staleRead = listEmailMessages(params);
    invalidateCommunicationsCache({ messagePages: true });
    const freshRead = listEmailMessages(params);

    freshResponse.resolve(jsonResponse({ messages: [message("new-arrival", { date: 200 })] }));
    assert.equal((await freshRead).messages[0]?.id, "new-arrival");
    staleResponse.resolve(jsonResponse({ messages: [message("older-snapshot", { date: 100 })] }));
    assert.equal((await staleRead).messages[0]?.id, "older-snapshot");

    assert.equal((await listEmailMessages(params)).messages[0]?.id, "new-arrival");
    assert.equal(calls, 2);
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

test("identical forced message-list refreshes share one in-flight request", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    await gate;
    return jsonResponse({ messages: [message("fresh")] });
  }) as typeof fetch;
  try {
    const first = listEmailMessages({ mailbox: "primary", limit: 12, refresh: true });
    const second = listEmailMessages({ mailbox: "primary", limit: 12, refresh: true });
    releaseGate();
    const [firstPage, secondPage] = await Promise.all([first, second]);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls, ["/v1/communications/messages?limit=12&mailbox=primary&refresh=true"]);
    assert.deepEqual(firstPage.messages.map((item) => item.id), ["fresh"]);
    assert.deepEqual(secondPage.messages.map((item) => item.id), ["fresh"]);
    assert.equal((await listEmailMessages({ mailbox: "primary", limit: 12 })).messages[0]?.id, "fresh");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("email thread reads coalesce, cache, clone, and preserve mailbox scope", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (calls.length === 1) await gate;
    return jsonResponse({
      thread: {
        id: "thread-1",
        message_ids: path.includes("shared_inbox_id") ? ["shared-message"] : ["personal-message"],
        participants: [{ email: "person@example.test" }],
      },
    });
  }) as typeof fetch;
  try {
    const first = getEmailThread("thread-1", "company-1");
    const second = getEmailThread("thread-1", "company-1");
    releaseGate();
    const [firstThread, secondThread] = await Promise.all([first, second]);
    firstThread.message_ids?.push("caller-only");

    assert.deepEqual(secondThread.message_ids, ["personal-message"]);
    assert.deepEqual((await getEmailThread("thread-1", "company-1")).message_ids, ["personal-message"]);
    assert.deepEqual((await getEmailThread("thread-1", "company-1", "shared-1")).message_ids, ["shared-message"]);
    assert.deepEqual(calls, [
      "/v1/communications/threads/thread-1?company_id=company-1",
      "/v1/communications/threads/thread-1?company_id=company-1&shared_inbox_id=shared-1",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("a fetched empty email body remains a valid detail-cache entry", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return jsonResponse({ message: message("empty-body") });
  };
  try {
    const first = await getEmailMessage("empty-body");
    const second = await getEmailMessage("empty-body");
    assert.equal(first.body, undefined);
    assert.equal(first.detail_fetched, true);
    assert.equal(second.detail_fetched, true);
    assert.deepEqual(calls, ["/v1/communications/messages/empty-body"]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("provider attachment downloads forward cancellation signals", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let observedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedSignal = init?.signal;
    return new Response(new Blob(["attachment-bytes"]), { status: 200 });
  };
  try {
    const blob = await downloadEmailAttachment("message-1", "attachment-1", "company-1", "shared-1", { signal: controller.signal });
    assert.equal(observedSignal, controller.signal);
    assert.equal(await blob.text(), "attachment-bytes");
  } finally {
    globalThis.fetch = originalFetch;
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
    await addLogicGateGVICAssignments("company-1", "gate 1", [{ role: "consulted", principal_type: "group", principal_id: "group-1" }], true);
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
      {
        path: "/v1/resources/logic_gate/gate%201/gvic/add",
        method: "POST",
        body: { company_id: "company-1", gvic_assignments: [{ role: "consulted", principal_type: "group", principal_id: "group-1" }], apply_to_descendants: true },
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
