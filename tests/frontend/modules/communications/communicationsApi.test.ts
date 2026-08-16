import test from "node:test";
import assert from "node:assert/strict";
import {
  addLogicGateRACIAssignments,
  addLocalEmailReply,
  archiveEmailMessagesBatch,
  createFolderQuery,
  createCommunicationsSharedInbox,
  createMessageQuery,
  convertTriageMessagesToExplorerTarget,
  deleteCommunicationsSharedInbox,
  downloadEmailAttachment,
  deleteEmailDraft,
  emailMessageMatchesListFilters,
  ensureEmailMessageIngested,
  ensureEmailCollaboration,
  fetchCommunicationsStatus,
  getCalendarInviteEvent,
  getCommunicationsArchiveJob,
  getEmailMessage,
  getStoredEmailThread,
  getEmailCollaborationThread,
  getNodeEmailThread,
  getEmailSignature,
  invalidateCommunicationsCache,
  invalidateCommunicationsMailboxCache,
  invalidateEmailMessageCache,
  listCompanyUsers,
  listCompanyUserGroups,
  listLogicGates,
  listCommunicationsSharedInboxes,
  listEmailDrafts,
  listEmailFolders,
  listEmailMessages,
  listStoredEmailMessages,
  listNodes,
  markCommunicationsWorkspaceResourcesStale,
  markCommunicationsArchiveJobsStaleForMailboxChange,
  mergeEmailMessageIntoMessageList,
  parseEmailAddressList,
  patchEmailMessagesLogicGatePlacement,
  removeCommunicationsSharedInbox,
  removeLogicGateRACIAssignments,
  respondToCalendarInvite,
  listEmailCollaborations,
  listEmailThreadChatGroups,
  saveEmailSignature,
  saveEmailDraft,
  sendEmail,
  settleCommunicationsMailboxMessageOverlays,
  unarchiveEmailMessage,
  updateEmailMessage,
  updateCommunicationsSharedInbox,
  updateCommunicationsSharedInboxRACIAssignments,
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
  assert.equal(createMessageQuery({ mailbox: "all", limit: 12, order: "oldest" }), "?limit=12&order=oldest&mailbox=all");
  assert.equal(createMessageQuery({ mailbox: "primary", refresh: true }), "?mailbox=primary&refresh=true");
  assert.equal(createMessageQuery({ mailbox: "primary", companyID: " company-1 ", sharedInboxID: " shared-1 " }), "?mailbox=primary&company_id=company-1&shared_inbox_id=shared-1");
  assert.equal(createMessageQuery({ q: "   " }), "");
});

test("communications folder query scopes shared inbox folder reads", () => {
  assert.equal(createFolderQuery({}), "");
  assert.equal(createFolderQuery({ companyID: " company-1 ", sharedInboxID: " shared-1 " }), "?company_id=company-1&shared_inbox_id=shared-1");
});

test("stored search and selected-message ingestion preserve the exact mailbox scope", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string }> = [];
  invalidateCommunicationsCache();
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, method: init?.method ?? "GET" });
    if (path.includes("/stored-messages")) return jsonResponse({ messages: [{ ...message("stored"), email_message_id: "internal-stored" }] });
    if (path.includes("/messages?") && path.includes("other%40example.com")) {
      return jsonResponse({ messages: [message("provider-only")] });
    }
    if (path.includes("/messages?")) return jsonResponse({ messages: [message("provider-only")] });
    return jsonResponse({ message: { ...message("provider-only"), email_message_id: "internal-provider", email_thread_id: "internal-thread" } });
  };
  try {
    const page = await listStoredEmailMessages({
      companyID: "company-1", accountEmail: "Owner@Example.com", mailbox: "primary", limit: 12, q: "invoice",
    });
    assert.equal(page.messages[0]?.email_message_id, "internal-stored");
    const ownerScope = {
      companyID: "company-1", accountEmail: "Owner@Example.com", mailbox: "primary" as const, limit: 12,
    };
    const otherScope = {
      companyID: "company-1", accountEmail: "other@example.com", mailbox: "primary" as const, limit: 12,
    };
    assert.equal((await listEmailMessages(ownerScope)).messages[0]?.email_message_id, undefined);
    assert.equal((await listEmailMessages(otherScope)).messages[0]?.email_message_id, undefined);
    const stored = await ensureEmailMessageIngested("provider-only", {
      companyID: "company-1", accountEmail: "Owner@Example.com",
    });
    assert.equal(stored.email_message_id, "internal-provider");
    assert.equal((await listEmailMessages(ownerScope)).messages[0]?.email_message_id, "internal-provider");
    assert.equal((await listEmailMessages(ownerScope)).messages[0]?.email_thread_id, "internal-thread");
    assert.equal((await listEmailMessages(otherScope)).messages[0]?.email_message_id, undefined);
    assert.deepEqual(calls, [
      {
        path: "/v1/communications/stored-messages?limit=12&mailbox=primary&company_id=company-1&account_email=owner%40example.com&q=invoice",
        method: "GET",
      },
      {
        path: "/v1/communications/messages?limit=12&mailbox=primary&company_id=company-1&account_email=owner%40example.com",
        method: "GET",
      },
      {
        path: "/v1/communications/messages?limit=12&mailbox=primary&company_id=company-1&account_email=other%40example.com",
        method: "GET",
      },
      {
        path: "/v1/communications/messages/provider-only/ingest?company_id=company-1&account_email=owner%40example.com",
        method: "POST",
      },
    ]);
  } finally {
    invalidateCommunicationsCache();
    globalThis.fetch = originalFetch;
  }
});

test("email collaboration ensure sends distinct new-node and existing-node identities", async () => {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    });
    const collaboration = {
      company_id: "company-1",
      collaboration_id: "collab-1",
      node_id: "node-1",
      attached_email_information_id: "email-info-1",
    };
    return jsonResponse((init?.method ?? "GET") === "GET"
      ? { collaborations: [collaboration] }
      : { collaboration });
  };
  try {
    const listed = await listEmailCollaborations({
      companyID: "company-1",
      messageID: "message-1",
      threadID: "thread-1",
      accountEmail: "ME@Example.test",
    });
    await ensureEmailCollaboration({
      companyID: "company-1",
      messageID: "message-1",
      threadID: "thread-1",
      accountEmail: "ME@Example.test",
      newNodeID: "node-new",
      message: { id: "message-1", thread_id: "thread-1", subject: "Review", body: "Full body", unread: false, starred: false },
    });
    await ensureEmailCollaboration({
      companyID: "company-1",
      messageID: "message-1",
      threadID: "thread-1",
      accountEmail: "ME@Example.test",
      targetNodeID: "node-existing",
      message: { id: "message-1", thread_id: "thread-1", subject: "Review", body: "Full body", unread: false, starred: false },
    });
    assert.equal(listed.length, 1);
    assert.equal(calls[0]?.method, "GET");
    assert.equal(calls[0]?.path, "/v1/communications/email-collaborations?company_id=company-1&message_id=message-1&thread_id=thread-1&account_email=me%40example.test");
    assert.equal(calls[1]?.method, "POST");
    assert.equal(calls[1]?.path, "/v1/communications/email-collaborations");
    assert.equal(calls[1]?.body?.new_node_id, "node-new");
    assert.equal("target_node_id" in (calls[1]?.body ?? {}), false);
    assert.equal("priority" in (calls[1]?.body ?? {}), false);
    assert.equal((calls[1]?.body?.message as { body?: string }).body, "Full body");
    assert.equal(calls[2]?.body?.target_node_id, "node-existing");
    assert.equal("new_node_id" in (calls[2]?.body ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email thread chat groups use one direct mailbox-scoped read", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requested = input.toString();
    return jsonResponse({ collaborations: [{
      company_id: "company-1",
      collaboration_id: "collaboration-1",
      node_id: "node-1",
      attached_email_information_id: "relationship-wide-1",
    }], groups: [{
      node_id: "node-1",
      node_name: "Inbox work",
      textbox_id: "textbox-1",
      textbox_title: "First review",
      textbox_display_order: 0,
      email_thread_id: "thread-internal-1",
      linked_messages: [{
        email_message_id: "message-internal-1",
        provider_message_id: "message-1",
        message_timestamp: "2026-08-11T10:00:00Z",
      }],
      chats: [],
    }], textbox_links: [{
      node_id: "node-1",
      textbox_id: "textbox-1",
      email_message_id: "message-internal-1",
      provider_message_id: "message-1",
    }] });
  };
  try {
    const result = await listEmailThreadChatGroups({
      companyID: " company-1 ",
      messageID: " message-1 ",
      threadID: " thread-1 ",
      accountEmail: "ME@Example.test",
    });
    assert.equal(requested, "/v1/communications/email-thread-chats?company_id=company-1&message_id=message-1&thread_id=thread-1&account_email=me%40example.test");
    assert.equal(result.collaborations[0]?.node_id, "node-1");
    assert.equal(result.groups[0]?.textbox_id, "textbox-1");
    assert.equal(result.textbox_links[0]?.email_message_id, "message-internal-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email collaboration thread reads durable participant-visible messages without mailbox scope", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requested = input.toString();
    return jsonResponse({
      collaboration_id: "collab-1",
      thread_id: "thread-1",
      messages: [{ id: "message-2", thread_id: "thread-1", subject: "Latest", unread: false, starred: false }],
      history_complete: false,
    });
  };
  try {
    const thread = await getEmailCollaborationThread(" company-1 ", " collab-1 ");
    assert.equal(requested, "/v1/communications/email-collaborations/collab-1/thread?company_id=company-1");
    assert.equal(thread.messages[0]?.subject, "Latest");
    assert.equal(thread.messages[0]?.collaboration_id, "collab-1");
    assert.equal(thread.history_complete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
      accountEmail: "ignored@example.com",
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

test("calendar event details use the exact mailbox and message identity", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return jsonResponse({ event: { id: "event-1", title: "Planning review", conference_url: "https://meet.google.com/abc" } });
  };
  try {
    const event = await getCalendarInviteEvent({
      messageID: " message-1 ",
      companyID: " company-1 ",
      accountEmail: " OWNER@Example.Test ",
    });
    assert.equal(event.title, "Planning review");
    assert.deepEqual(calls, [
      "/v1/communications/calendar-invites/event?company_id=company-1&account_email=owner%40example.test&message_id=message-1",
    ]);
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
      accountEmail: "ignored@example.test",
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

test("existing-node email import serializes linked text and chat in one conversion request", async () => {
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
      target: { mode: "existing_node", node_id: "node-1" },
      nodes: [],
      deleted_message_ids: ["msg-1"],
      attached_email_information_ids: ["attached-1"],
      email_thread_ids: ["thread-1"],
      linked_text_block_id: "text-1",
      initial_chat_id: "chat-1",
    }, 201);
  };
  try {
    await convertTriageMessagesToExplorerTarget({
      companyID: "company-1",
      accountEmail: " OWNER@example.test ",
      target: { mode: "existing_node", nodeID: "node-1" },
      messageIDs: [" msg-1 "],
      linkedTextBlock: { type: "Text box", informationID: "text-1", information: "{\"email_message_id\":\"msg-1\"}" },
      initialChat: { type: "Text block chat", informationID: "chat-1", information: "{\"block_id\":\"text-1\"}" },
    });
    assert.deepEqual(calls, [{
      path: "/v1/communications/triage/convert?account_email=owner%40example.test",
      method: "POST",
      body: {
        company_id: "company-1",
        target: { mode: "existing_node", node_id: "node-1" },
        message_ids: ["msg-1"],
        linked_text_block: { type: "Text box", information: "{\"email_message_id\":\"msg-1\"}", information_id: "text-1" },
        initial_chat: { type: "Text block chat", information: "{\"block_id\":\"text-1\"}", information_id: "chat-1" },
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
  let sharedRACIAssignments: Array<{ role: string; principal_type: string; principal_id: string }> = [];
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
    if (path === "/v1/resources/shared_inbox/shared-1/gvic" && (init?.method ?? "GET") === "GET") {
      return jsonResponse({ revision: "shared-revision-1", gvic_assignments: sharedRACIAssignments });
    }
    if (path === "/v1/resources/shared_inbox/shared-1/gvic" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { gvic_assignments?: typeof sharedRACIAssignments };
      sharedRACIAssignments = body.gvic_assignments ?? [];
      return jsonResponse({ revision: "shared-revision-2", gvic_assignments: sharedRACIAssignments });
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
    const access = await updateCommunicationsSharedInboxRACIAssignments("company-1", "shared-1", [{ role: "responsible", principal_type: "user", principal_id: "user-1", user_id: "user-1" }]);
    await deleteCommunicationsSharedInbox("company-1", "shared-1");
    await removeCommunicationsSharedInbox("company-1", "shared-1");

    assert.equal(listed[0]?.name, "Business");
    assert.equal(created.folder_id, "shared-2");
    assert.equal(updated.folder_id, "shared-1");
    assert.deepEqual(access.map((item) => [item.role, item.principal_type, item.principal_id, item.user_id]), [["responsible", "user", "user-1", "user-1"]]);
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
        path: "/v1/resources/shared_inbox/shared-1/gvic?company_id=company-1",
        method: "GET",
        body: undefined,
      },
      {
        path: "/v1/resources/shared_inbox/shared-1/gvic",
        method: "PUT",
        body: { company_id: "company-1", assignment_mode: "customized", descendant_action: "inherited_only", gvic_assignments: [{ role: "responsible", principal_type: "user", principal_id: "user-1" }] },
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

test("local list merge helpers prepend one new inbox message without replacing the page", () => {
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

test("workspace resource scoped stale refetches only matching resource caches", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.startsWith("/v1/logic-gates?")) return jsonResponse({ logic_gates: [{ company_id: "company-1", logic_gate_id: "gate-1", header: "Gate 1", created_timestamp: "2026-01-01T00:00:00Z" }] });
    if (path.startsWith("/v1/nodes?")) return jsonResponse({ nodes: [{ company_id: "company-1", node_id: `node-${calls.filter((call) => call.startsWith("/v1/nodes?")).length}`, name: "Node", created_timestamp: "2026-01-01T00:00:00Z" }] });
    return jsonResponse({ folders: [], shortcuts: [], users: [] });
  };
  try {
    await listLogicGates("company-1");
    await listNodes("company-1");
    markCommunicationsWorkspaceResourcesStale("company-1", { nodes: true });
    await listLogicGates("company-1");
    await listNodes("company-1");

    assert.deepEqual(calls, [
      "/v1/logic-gates?company_id=company-1",
      "/v1/nodes?company_id=company-1",
      "/v1/nodes?company_id=company-1",
    ]);
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

    markCommunicationsWorkspaceResourcesStale("company-1", { userGroups: true });
    assert.equal((await listCompanyUserGroups("company-1")).groups[0]?.group_id, "group-2");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("local list merge helpers do not inject new messages into paged or searched lists", () => {
  const existing = [message("old-1", { subject: "Old", folders: ["inbox"] })];
  const created = message("new-1", { subject: "Fresh", folders: ["inbox"] });

  assert.deepEqual(
    mergeEmailMessageIntoMessageList(existing, created, { limit: 25, mailbox: "primary", pageToken: "next-page" }, { prependIfMissing: true }).map((item) => item.id),
    ["old-1"],
  );
  assert.equal(emailMessageMatchesListFilters(created, { mailbox: "primary", q: "invoice" }), false);
});

test("local list merge helpers remove updated messages that no longer match the active filter", () => {
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

test("local list merge helpers insert created messages by message date", () => {
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

test("account-only cache helpers never patch another personal account with the same provider message id", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = new URL(input.toString(), "http://mango.test");
    const accountEmail = url.searchParams.get("account_email") ?? "";
    const scopedMessage = message("same-provider-message-id", {
      body: `Body for ${accountEmail}`,
      folders: ["INBOX"],
      thread_id: "same-thread-id",
    });
    if (url.pathname.endsWith("/same-provider-message-id")) return jsonResponse({ message: scopedMessage });
    return jsonResponse({ messages: [scopedMessage] });
  };
  const accountA = { accountEmail: "account-a@example.test" };
  const accountB = { accountEmail: "account-b@example.test" };
  try {
    await Promise.all([
      listEmailMessages({ ...accountA, mailbox: "primary" }),
      listEmailMessages({ ...accountB, mailbox: "primary" }),
      getEmailMessage("same-provider-message-id", undefined, undefined, accountA),
      getEmailMessage("same-provider-message-id", undefined, undefined, accountB),
    ]);
    patchEmailMessagesLogicGatePlacement(["same-provider-message-id"], "gate-a", accountA);
    addLocalEmailReply("same-provider-message-id", message("sent-a", { folders: ["sent"] }), accountA);

    const [detailA, detailB, pageA, pageB] = await Promise.all([
      getEmailMessage("same-provider-message-id", undefined, undefined, accountA),
      getEmailMessage("same-provider-message-id", undefined, undefined, accountB),
      listEmailMessages({ ...accountA, mailbox: "primary" }),
      listEmailMessages({ ...accountB, mailbox: "primary" }),
    ]);
    assert.deepEqual(detailA.logic_gate_ids, ["gate-a"]);
    assert.deepEqual(detailA.local_replies?.map((reply) => reply.id), ["sent-a"]);
    assert.equal(detailB.logic_gate_ids, undefined);
    assert.equal(detailB.local_replies, undefined);
    assert.deepEqual(pageA.messages[0]?.logic_gate_ids, ["gate-a"]);
    assert.equal(pageB.messages[0]?.logic_gate_ids, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("star updates survive a stale primary refresh and populate starred and all buckets", async () => {
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
    assert.deepEqual(
      (await listEmailMessages({ mailbox: "primary", limit: 25, refresh: true })).messages.map((item) => [item.id, item.starred]),
      [["msg-1", true]],
      "a stale provider refresh cannot undo a committed star",
    );
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "all", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("unstar updates survive stale primary and starred refreshes", async () => {
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
    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25, refresh: true })).messages.map((item) => [item.id, item.starred]), [["msg-1", false]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25, refresh: true })).messages, []);
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
    if (path.includes("archive-batch")) {
		return jsonResponse({ archive_job: archiveJob(["collision-1"]) });
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

		await archiveEmailMessagesBatch(["collision-1"], "shared-1", "company-1");
    assert.deepEqual((await listEmailMessages(personalParams)).messages.map((item) => item.subject), ["Personal"]);
    assert.deepEqual((await listEmailMessages(sharedParams)).messages.map((item) => item.id), []);
    assert.equal(personalFetches, 1);
    assert.equal(sharedFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("realtime settlement lets canonical mail win only for the exact personal account or shared inbox", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const accountA = { mailbox: "primary" as const, limit: 25, companyID: "company-1", accountEmail: "a@example.com" };
  const accountB = { mailbox: "primary" as const, limit: 25, companyID: "company-1", accountEmail: "b@example.com" };
  const shared = { mailbox: "primary" as const, limit: 25, companyID: "company-1", sharedInboxID: "shared-1" };
  const requestMailbox = (path: string) => {
    const url = new URL(path, "https://mangorts.invalid");
    return url.searchParams.get("shared_inbox_id")
      ? `shared:${url.searchParams.get("shared_inbox_id")}`
      : `personal:${url.searchParams.get("account_email")}`;
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    const mailbox = requestMailbox(path);
    if (path.includes("/unarchive")) {
      return jsonResponse({ message: message("primary-only", { subject: `Optimistic primary ${mailbox}`, folders: ["INBOX"] }) });
    }
    if (path.includes("archive-batch")) {
		return jsonResponse({ archive_job: archiveJob(["collision-1"]) });
    }
    if (init?.method === "PUT") {
      return jsonResponse({ message: message("collision-1", { subject: `Optimistic starred ${mailbox}`, folders: ["INBOX"], starred: true }) });
    }
    if (path.includes("mailbox=starred")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=primary")) {
      return jsonResponse({ messages: [message("collision-1", { subject: `Canonical ${mailbox}`, folders: ["INBOX"] })] });
    }
    return jsonResponse({ messages: [] });
  };
  try {
    await Promise.all([listEmailMessages(accountA), listEmailMessages(accountB), listEmailMessages(shared)]);
    await Promise.all([
      archiveEmailMessagesBatch(["collision-1"], undefined, "company-1", { accountEmail: "a@example.com" }),
      archiveEmailMessagesBatch(["collision-1"], undefined, "company-1", { accountEmail: "b@example.com" }),
      archiveEmailMessagesBatch(["collision-1"], "shared-1", "company-1"),
    ]);

    settleCommunicationsMailboxMessageOverlays(accountA, "collision-1");
    invalidateCommunicationsMailboxCache(accountA, { messagePages: true });
    invalidateCommunicationsMailboxCache(accountB, { messagePages: true });
    invalidateCommunicationsMailboxCache(shared, { messagePages: true });

    assert.deepEqual(
      (await listEmailMessages({ ...accountA, refresh: true })).messages.map((item) => item.subject),
      ["Canonical personal:a@example.com"],
      "the hinted account accepts its canonical provider result",
    );
    assert.deepEqual(
      (await listEmailMessages({ ...accountB, refresh: true })).messages,
      [],
      "settling account A does not remove account B's optimistic archive",
    );
    assert.deepEqual(
      (await listEmailMessages({ ...shared, refresh: true })).messages,
      [],
      "settling a personal account does not remove a shared-inbox overlay",
    );

    settleCommunicationsMailboxMessageOverlays(shared, "collision-1");
    invalidateCommunicationsMailboxCache(shared, { messagePages: true });
    assert.deepEqual(
      (await listEmailMessages({ ...shared, refresh: true })).messages.map((item) => item.subject),
      ["Canonical shared:shared-1"],
      "the exact shared inbox can settle independently",
    );
    assert.deepEqual(
      (await listEmailMessages({ ...accountB, refresh: true })).messages,
      [],
      "shared settlement still leaves the other personal account untouched",
    );

    await unarchiveEmailMessage("primary-only", undefined, "company-1", "a@example.com");
    assert.equal(
      (await listEmailMessages(accountA)).messages.some((item) => item.id === "primary-only"),
      true,
      "a successful local unarchive remains optimistic before a newer hint settles it",
    );
    settleCommunicationsMailboxMessageOverlays(accountA, "primary-only");
    invalidateCommunicationsMailboxCache(accountA, { messagePages: true });
    assert.equal(
      (await listEmailMessages({ ...accountA, refresh: true })).messages.some((item) => item.id === "primary-only"),
      false,
      "canonical primary absence wins after settlement",
    );

    await updateEmailMessage("collision-1", { starred: true }, undefined, "company-1", "a@example.com");
    assert.deepEqual(
      (await listEmailMessages({ ...accountA, mailbox: "starred" })).messages.map((item) => item.id),
      ["collision-1"],
      "a successful local star remains optimistic before a newer hint settles it",
    );
    assert.equal(
      (await listEmailMessages({ ...accountA, refresh: true })).messages[0]?.starred,
      true,
      "personal triage keeps the committed star across a stale refresh",
    );
    await updateEmailMessage("collision-1", { starred: true }, "shared-1", "company-1");
    assert.equal(
      (await listEmailMessages({ ...shared, refresh: true })).messages[0]?.starred,
      true,
      "shared triage keeps the committed star across a stale refresh",
    );

    settleCommunicationsMailboxMessageOverlays(accountA, "collision-1");
    invalidateCommunicationsMailboxCache(accountA, { messagePages: true });
    assert.deepEqual(
      (await listEmailMessages({ ...accountA, mailbox: "starred", refresh: true })).messages,
      [],
      "canonical starred absence wins after settlement",
    );
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
    if (path.includes("archive-batch")) {
		return jsonResponse({ archive_job: archiveJob(["msg-1"]) });
    }
    if (path.includes("mailbox=primary")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"], starred: true })] });
    if (path.includes("mailbox=archive")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=all")) return jsonResponse({ messages: [] });
    if (path.includes("mailbox=starred")) return jsonResponse({ messages: [] });
    return jsonResponse({ messages: [] });
  };
  try {
    await listEmailMessages({ mailbox: "primary", limit: 25 });
		await archiveEmailMessagesBatch(["msg-1"]);

    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), []);
    assert.deepEqual((await listEmailMessages({ mailbox: "archive", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "all", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("archive job acceptance keeps cached starred messages out of Inbox", async () => {
  invalidateCommunicationsCache();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    calls.push(path);
    if (path.includes("archive-batch")) {
      assert.equal(init?.method, "POST");
			return jsonResponse({ archive_job: archiveJob(["msg-1"], "job-1") });
    }
    if (path.includes("mailbox=primary")) return jsonResponse({ messages: [message("msg-1", { date: 300, folders: ["INBOX"], starred: true }), message("msg-2", { date: 200, folders: ["INBOX"] })] });
    return jsonResponse({ messages: [] });
  };
  try {
    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), ["msg-1", "msg-2"]);
		const accepted = await archiveEmailMessagesBatch(["msg-1"]);

		assert.equal(accepted.job_id, "job-1");
		assert.deepEqual(accepted.accepted_message_ids, ["msg-1"]);
    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), ["msg-2"]);
    assert.deepEqual((await listEmailMessages({ mailbox: "starred", limit: 25 })).messages.map((item) => [item.id, item.starred]), [["msg-1", true]]);
    assert.deepEqual((await listEmailMessages({ mailbox: "primary", limit: 25 })).messages.map((item) => item.id), ["msg-2"]);
    assert.equal(calls.filter((path) => path.includes("mailbox=primary")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("archive job cache becomes stale only for its exact mailbox message and revalidates with ETag", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const job = archiveJob(["message-1"], "job-cache-1");
  const statusRequests: Headers[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    if (path.includes("archive-batch")) return jsonResponse({ archive_job: job });
    if (path.includes("archive-jobs/job-cache-1")) {
      const headers = new Headers(init?.headers);
      statusRequests.push(headers);
      if (headers.get("If-None-Match") === '"archive-v1"') {
        return new Response(null, { status: 304, headers: { ETag: '"archive-v1"' } });
      }
      return new Response(JSON.stringify({ archive_job: job }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"archive-v1"' },
      });
    }
    return jsonResponse({});
  };
  try {
    await archiveEmailMessagesBatch(["message-1"], undefined, "company-1", { accountEmail: "owner@example.com" });
    await getCommunicationsArchiveJob("job-cache-1");
    assert.equal(statusRequests.length, 1, "queue acceptance is followed by one canonical status read");

    assert.deepEqual(markCommunicationsArchiveJobsStaleForMailboxChange({
      companyID: "company-1", accountEmail: "other@example.com",
    }, "message-1"), []);
    assert.deepEqual(markCommunicationsArchiveJobsStaleForMailboxChange({
      companyID: "company-1", accountEmail: "owner@example.com",
    }, "unrelated-message"), []);
    assert.equal(statusRequests.length, 1, "unrelated hints perform no archive read");

    assert.deepEqual(markCommunicationsArchiveJobsStaleForMailboxChange({
      companyID: "company-1", accountEmail: "owner@example.com",
    }, "message-1"), ["job-cache-1"]);
    assert.equal(statusRequests.length, 1, "inactive cache invalidation does not fetch immediately");
    await getCommunicationsArchiveJob("job-cache-1");
    assert.equal(statusRequests.length, 2);
    assert.equal(statusRequests[1]?.get("If-None-Match"), '"archive-v1"');
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("archive batch and unarchive helpers call the canonical mailbox endpoints", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ path: input.toString(), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
		if (input.toString().includes("archive-batch")) {
			const ids = (init?.body ? JSON.parse(String(init.body)) : { message_ids: [] }).message_ids as string[];
			return jsonResponse({ archive_job: archiveJob(ids) });
		}
		return jsonResponse({ message: message("msg 1") });
	};
	try {
		await archiveEmailMessagesBatch(["msg 1"]);
		await unarchiveEmailMessage("msg 1");
		const batch = await archiveEmailMessagesBatch(["msg 2", "msg 3", "msg 2", "msg 4"], "shared-1", "company-1");
		assert.deepEqual(batch.accepted_message_ids, ["msg 2", "msg 3", "msg 4"]);
		assert.deepEqual(calls, [
			{ path: "/v1/communications/messages/archive-batch", method: "POST", body: { message_ids: ["msg 1"] } },
			{ path: "/v1/communications/messages/msg%201/unarchive", method: "POST", body: undefined },
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

test("sendEmail scopes shared inbox sends through query params after the universal undo window", async (t: any) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
    const pendingSend = sendEmail({
      to: [{ email: "customer@example.test" }],
      subject: "Hello",
      body: "Body",
      company_id: " company-1 ",
      shared_inbox_id: " shared-1 ",
    });
    assert.equal(calls.length, 0);
    t.mock.timers.tick(10_000);
    const sent = await pendingSend;
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

test("sendEmail leaves reply-history persistence to the caller", async (t: any) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
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
    const pendingSend = sendEmail({
      to: [{ email: "customer@example.test" }],
      subject: "Re: Hello",
      body: "Sent reply",
      reply_to_message_id: "inbound-1",
      company_id: "company-1",
      shared_inbox_id: "shared-1",
    });
    t.mock.timers.tick(10_000);
    await pendingSend;

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

test("durable draft API preserves mailbox scopes and exposes the participant collaboration branch", async () => {
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
    await listEmailDrafts("company-1", {});
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
      ["GET", "/v1/communications/drafts?company_id=company-1"],
      ["GET", "/v1/communications/drafts?company_id=company-1&account_email=me%40example.test"],
      ["GET", "/v1/communications/drafts?company_id=company-1&shared_inbox_id=shared-1"],
      ["PUT", "/v1/communications/drafts/draft-1"],
      ["DELETE", "/v1/communications/drafts/draft-1?company_id=company-1&shared_inbox_id=shared-1"],
    ]);
    assert.equal(calls[3]?.body?.shared_inbox_id, "shared-1");
    assert.equal(calls[3]?.body?.company_id, "company-1");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("duplicate draft and stored Node thread reads share one request while realtime refresh bypasses cache", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = input.toString();
    calls.push(path);
    if (path.startsWith("/v1/communications/drafts?")) return jsonResponse({ drafts: [] });
    return jsonResponse({
      email_thread_id: "email-thread-1",
      thread_id: "provider-thread-1",
      messages: [message("message-1")],
      history_complete: true,
    });
  };
  try {
    await Promise.all(Array.from({ length: 12 }, () => listEmailDrafts("company-1", {})));
    await listEmailDrafts("company-1", {});
    assert.equal(calls.filter((path) => path.startsWith("/v1/communications/drafts?")).length, 1);

    await Promise.all(Array.from({ length: 6 }, () => getNodeEmailThread("company-1", "node-1", "email-thread-1")));
    await getNodeEmailThread("company-1", "node-1", "email-thread-1");
    assert.equal(calls.filter((path) => path.includes("/email-threads/email-thread-1?")).length, 1);

    await getNodeEmailThread("company-1", "node-1", "email-thread-1", { refresh: true });
    assert.equal(calls.filter((path) => path.includes("/email-threads/email-thread-1?")).length, 2);
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

test("stored thread detail returns every durable message row in stored order", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPath = "";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requestedPath = input.toString();
    return jsonResponse({
      thread: {
        email_thread_id: "stored-thread-1",
        thread_id: "thread-1",
        history_complete: true,
        messages: [
          { ...message("message-1", { body: "First" }), thread_id: "thread-1", message_order: 0 },
          { ...message("message-2", { body: "Second" }), thread_id: "thread-1", message_order: 1 },
          { ...message("message-3", { body: "Third with quoted history" }), thread_id: "thread-1", message_order: 2 },
        ],
      },
    });
  };
  try {
    const result = await getStoredEmailThread("stored-thread-1", "company-1", undefined, { accountEmail: "owner@example.com" });
    assert.equal(requestedPath, "/v1/communications/threads/stored-thread-1?company_id=company-1&account_email=owner%40example.com");
    assert.deepEqual(result.messages.map((storedMessage) => storedMessage.id), ["message-1", "message-2", "message-3"]);
    assert.deepEqual(result.messages.map((storedMessage) => storedMessage.message_order), [0, 1, 2]);
    assert.equal(result.messages.every((storedMessage) => storedMessage.detail_fetched), true);
  } finally {
    globalThis.fetch = originalFetch;
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
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    paths.push(input.toString());
    calls += 1;
    return calls === 1 ? staleResponse.promise : freshResponse.promise;
  }) as typeof fetch;
  try {
    const scope = { companyID: "company-1", accountEmail: "owner@example.com" };
    const staleRead = listEmailFolders(scope);
    invalidateCommunicationsMailboxCache(scope, { folders: true });
    const freshRead = listEmailFolders({ ...scope, refresh: true });

    freshResponse.resolve(jsonResponse({ folders: [{ id: "inbox", name: "Inbox", unread_count: 1 }] }));
    assert.equal((await freshRead)[0]?.unread_count, 1);
    staleResponse.resolve(jsonResponse({ folders: [{ id: "inbox", name: "Inbox", unread_count: 9 }] }));
    assert.equal((await staleRead)[0]?.unread_count, 9);

    assert.equal((await listEmailFolders(scope))[0]?.unread_count, 1);
    assert.equal(calls, 2);
    assert.equal(paths[1], "/v1/communications/folders?company_id=company-1&account_email=owner%40example.com&refresh=true");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("personal triage conversion selects the exact normalized account", async () => {
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
      accountEmail: " SECOND@Example.TEST ",
      target: { mode: "existing_logic_gate", logicGateID: "gate-1" },
      messageIDs: ["msg-1"],
    });
    assert.deepEqual(calls, [{
      path: "/v1/communications/triage/convert?account_email=second%40example.test",
      method: "POST",
      body: {
        company_id: "company-1",
        target: { mode: "existing_logic_gate", logic_gate_id: "gate-1" },
        message_ids: ["msg-1"],
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mailbox hint invalidation is exact across personal accounts and shared inboxes", async () => {
  invalidateCommunicationsCache();
  const originalFetch = globalThis.fetch;
  const calls = new Map<string, number>();
  const accountA = { companyID: "company-1", accountEmail: "a@example.com" };
  const accountB = { companyID: "company-1", accountEmail: "b@example.com" };
  const shared = { companyID: "company-1", sharedInboxID: "shared-1" };
  const requestKey = (url: URL) => {
    const mailbox = url.searchParams.get("shared_inbox_id")
      ? `shared:${url.searchParams.get("shared_inbox_id")}`
      : `personal:${url.searchParams.get("account_email")}`;
    return `${url.pathname}|${mailbox}`;
  };
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), "https://mangorts.invalid");
    const key = requestKey(url);
    calls.set(key, (calls.get(key) ?? 0) + 1);
    if (url.pathname === "/v1/communications/messages") {
      return jsonResponse({ messages: [{ id: "same", subject: key, unread: false, starred: false }] });
    }
    if (url.pathname === "/v1/communications/messages/same") {
      return jsonResponse({ message: { id: "same", subject: key, unread: false, starred: false, body: key } });
    }
    throw new Error(`unexpected_request:${url}`);
  }) as typeof fetch;
  try {
    await Promise.all([
      listEmailMessages(accountA),
      listEmailMessages(accountB),
      listEmailMessages(shared),
      getEmailMessage("same", "company-1", undefined, { accountEmail: "a@example.com" }),
      getEmailMessage("same", "company-1", undefined, { accountEmail: "b@example.com" }),
      getEmailMessage("same", "company-1", "shared-1"),
    ]);

    invalidateCommunicationsMailboxCache(accountA, { messagePages: true });
    await Promise.all([listEmailMessages(accountA), listEmailMessages(accountB), listEmailMessages(shared)]);
    assert.equal(calls.get("/v1/communications/messages|personal:a@example.com"), 2);
    assert.equal(calls.get("/v1/communications/messages|personal:b@example.com"), 1);
    assert.equal(calls.get("/v1/communications/messages|shared:shared-1"), 1);

    invalidateEmailMessageCache("same", "company-1", undefined, "a@example.com");
    await Promise.all([
      getEmailMessage("same", "company-1", undefined, { accountEmail: "a@example.com" }),
      getEmailMessage("same", "company-1", undefined, { accountEmail: "b@example.com" }),
      getEmailMessage("same", "company-1", "shared-1"),
    ]);
    assert.equal(calls.get("/v1/communications/messages/same|personal:a@example.com"), 2);
    assert.equal(calls.get("/v1/communications/messages/same|personal:b@example.com"), 1);
    assert.equal(calls.get("/v1/communications/messages/same|shared:shared-1"), 1);

  } finally {
    globalThis.fetch = originalFetch;
    invalidateCommunicationsCache();
  }
});

test("calendar RSVP selects the exact personal account", async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return jsonResponse({ status: "responded", rsvp_status: "yes", event_id: "event-1", calendar_id: "primary" });
  };
  try {
    await respondToCalendarInvite({
      messageID: "message-1",
      status: "yes",
      companyID: "company-1",
      accountEmail: " SECOND@Example.COM ",
    });
    assert.deepEqual(calls, [{
      path: "/v1/communications/calendar-invites/respond?company_id=company-1&account_email=second%40example.com",
      method: "POST",
      body: { message_id: "message-1", status: "yes" },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
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

test("provider attachment downloads preserve exact personal and shared mailbox scope", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const calls: Array<{ path: string; signal: AbortSignal | null | undefined }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: input.toString(), signal: init?.signal });
    return new Response(new Blob(["attachment-bytes"]), { status: 200 });
  };
  try {
    const blob = await downloadEmailAttachment("message-1", "attachment-1", "company-1", undefined, {
      signal: controller.signal,
      accountEmail: " SECOND@Example.COM ",
      collaborationID: "collab-1",
    });
    assert.equal(await blob.text(), "attachment-bytes");
    await downloadEmailAttachment("message-1", "attachment-1", "company-1", "shared-1", {
      accountEmail: "ignored@example.com",
      collaborationID: "collab-1",
    });
    assert.deepEqual(calls, [
      {
        path: "/v1/communications/messages/message-1/attachments/attachment-1?company_id=company-1&account_email=second%40example.com&collaboration_id=collab-1",
        signal: controller.signal,
      },
      {
        path: "/v1/communications/messages/message-1/attachments/attachment-1?company_id=company-1&shared_inbox_id=shared-1&collaboration_id=collab-1",
        signal: undefined,
      },
    ]);
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

test("logic gate RACI helpers read then replace one complete V2 policy", async () => {
  invalidateCommunicationsCache();
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  let currentAssignments: Array<{ role: string; principal_type: string; principal_id: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if ((init?.method ?? "GET") === "GET") return jsonResponse({ revision: `revision-${calls.length}`, gvic_assignments: currentAssignments });
    const body = JSON.parse(String(init?.body)) as { gvic_assignments?: typeof currentAssignments };
    currentAssignments = body.gvic_assignments ?? [];
    return jsonResponse({ revision: `revision-${calls.length}`, gvic_assignments: currentAssignments });
  };
  try {
    const addResult = await addLogicGateRACIAssignments("company-1", "gate 1", [{ role: "responsible", user_id: "user-1" }]);
    const removeResult = await removeLogicGateRACIAssignments("company-1", "gate 1", [{ role: "responsible", user_id: "user-1" }]);
    await addLogicGateRACIAssignments("company-1", "gate 1", [{ role: "consulted", principal_type: "group", principal_id: "group-1" }], true);
    assert.deepEqual(calls, [
      { path: "/v1/resources/logic_gate/gate%201/gvic?company_id=company-1", method: "GET", body: undefined },
      {
        path: "/v1/resources/logic_gate/gate%201/gvic",
        method: "PUT",
        body: { company_id: "company-1", assignment_mode: "customized", descendant_action: "inherited_only", gvic_assignments: [{ role: "responsible", principal_type: "user", principal_id: "user-1" }] },
      },
      { path: "/v1/resources/logic_gate/gate%201/gvic?company_id=company-1", method: "GET", body: undefined },
      {
        path: "/v1/resources/logic_gate/gate%201/gvic",
        method: "PUT",
        body: { company_id: "company-1", assignment_mode: "customized", descendant_action: "inherited_only", gvic_assignments: [] },
      },
      { path: "/v1/resources/logic_gate/gate%201/gvic?company_id=company-1", method: "GET", body: undefined },
      {
        path: "/v1/resources/logic_gate/gate%201/gvic",
        method: "PUT",
        body: { company_id: "company-1", assignment_mode: "customized", descendant_action: "including_customized", gvic_assignments: [{ role: "consulted", principal_type: "group", principal_id: "group-1" }] },
      },
    ]);
    assert.deepEqual(addResult.map((item) => [item.role, item.user_id]), [["responsible", "user-1"]]);
    assert.deepEqual(removeResult.map((item) => [item.role, item.user_id]), []);
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

function archiveJob(messageIDs: string[], jobID = "archive-job-1") {
	const ids = Array.from(new Set(messageIDs));
	return {
		job_id: jobID,
		status: "pending",
		requested_count: ids.length,
		accepted_message_ids: ids,
		items: ids.map((messageID, index) => ({
			job_item_id: `${jobID}-item-${index + 1}`,
			job_id: jobID,
			message_id: messageID,
			status: "pending",
			provider_attempt_count: 0,
		})),
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
