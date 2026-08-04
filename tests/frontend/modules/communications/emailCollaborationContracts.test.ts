import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteEmailDraft,
  ensureEmailCollaboration,
  getEmailCollaboration,
  listEmailDrafts,
  saveEmailDraft,
  sendEmailCollaborationDraft,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("collaboration API preserves exact shared-inbox source identity", async () => {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    });
    return jsonResponse({
      collaboration: {
        company_id: "company-1",
        collaboration_id: "collaboration/1",
        node_id: "node-1",
        attached_email_information_id: "information-1",
        scope_type: "shared",
        shared_inbox_id: "shared-inbox-1",
      },
    });
  };

  try {
    await ensureEmailCollaboration({
      companyID: " company-1 ",
      messageID: "ignored-in-favor-of-message",
      threadID: " source-thread-1 ",
      sharedInboxID: " shared-inbox-1 ",
      accountEmail: " should-be-ignored@example.test ",
      priority: 2,
      message: {
        id: " source-message-1 ",
        thread_id: "message-thread-fallback",
        subject: "Review",
        body: "Full source body",
        unread: false,
        starred: false,
      },
    });
    await getEmailCollaboration(" company-1 ", " collaboration/1 ");

    assert.equal(calls[0]?.path, "/v1/communications/email-collaborations");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(calls[0]?.body, {
      company_id: "company-1",
      message_id: "source-message-1",
      thread_id: "source-thread-1",
      shared_inbox_id: "shared-inbox-1",
      priority: 2,
      message: {
        id: " source-message-1 ",
        thread_id: "message-thread-fallback",
        subject: "Review",
        body: "Full source body",
        unread: false,
        starred: false,
      },
    });
    assert.equal(
      calls[1]?.path,
      "/v1/communications/email-collaborations/collaboration%2F1?company_id=company-1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shared draft API serializes collaboration identity and optimistic revision", async () => {
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    });
    return jsonResponse({
      draft: {
        company_id: "company-1",
        draft_id: "draft:shared/1",
        scope_type: "personal",
        kind: "reply",
        source_message_id: "message-1",
        to_recipients: "recipient@example.test",
        cc_recipients: "",
        bcc_recipients: "",
        subject: "Re: Review",
        body_editor_html: "Updated together",
        collaboration_id: "collaboration-1",
        is_shared: true,
        revision: 8,
        created_timestamp: "2026-07-13T12:00:00Z",
        updated_timestamp: "2026-07-13T12:01:00Z",
      },
    });
  };

  try {
    const draft = await saveEmailDraft({
      companyID: " company-1 ",
      draftID: " draft:shared/1 ",
      kind: "reply",
      sourceMessageID: " message-1 ",
      replyToMessageID: " message-1 ",
      to: "recipient@example.test",
      cc: "",
      bcc: "",
      subject: "Re: Review",
      bodyEditorHTML: "Updated together",
      collaborationID: " collaboration-1 ",
      sharedDraft: true,
      revision: 7.9,
    });

    assert.equal(calls[0]?.path, "/v1/communications/drafts/draft%3Ashared%2F1");
    assert.equal(calls[0]?.method, "PUT");
    assert.equal(calls[0]?.body?.collaboration_id, "collaboration-1");
    assert.equal(calls[0]?.body?.is_shared, true);
    assert.equal(calls[0]?.body?.revision, 7);
    assert.equal(calls[0]?.body?.source_message_id, "message-1");
    assert.equal(draft.revision, 8);
    assert.equal(draft.is_shared, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shared draft send uses immutable collaboration source after the universal undo window", async (t: any) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const responsePayload = {
    message: {
      id: "sent-message-1",
      thread_id: "thread-1",
      subject: "Re: Review",
      unread: false,
      starred: false,
      from: [{ name: "Sender", email: "sender@example.test" }],
    },
    collaboration_id: " ",
    draft_id: " ",
  };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: input.toString(),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
    });
    return jsonResponse(responsePayload);
  };

  try {
    const pendingSend = sendEmailCollaborationDraft({
      companyID: " company/1 ",
      collaborationID: " collaboration/1 ",
      draftID: " draft:shared/1 ",
      expectedRevision: 9.8,
    });
    assert.equal(calls.length, 0);
    t.mock.timers.tick(10_000);
    const sent = await pendingSend;

    assert.deepEqual(calls, [{
      path: "/v1/communications/email-collaborations/collaboration%2F1/drafts/draft%3Ashared%2F1/send?company_id=company%2F1",
      method: "POST",
      body: { expected_revision: 9 },
    }]);
    assert.equal(sent.collaboration_id, "collaboration/1");
    assert.equal(sent.draft_id, "draft:shared/1");
    assert.equal(sent.draft_deleted, false);
    sent.message.from![0]!.name = "Local sender";
    assert.equal(responsePayload.message.from[0]!.name, "Sender");

    await assert.rejects(
      () => sendEmailCollaborationDraft({
        companyID: "company/1",
        collaborationID: "collaboration/1",
        draftID: "draft:shared/1",
        expectedRevision: 0,
      }),
      /email_collaboration_draft_send_input_required/,
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("participant shared-draft list and delete use company-only scope with optimistic revisions", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: input.toString(), method: init?.method ?? "GET" });
    return jsonResponse((init?.method ?? "GET") === "DELETE" ? { status: "deleted" } : { drafts: [] });
  };

  try {
    await listEmailDrafts(" company-1 ", {
      revision: 4.8,
    });
    await deleteEmailDraft(" company-1 ", " draft:shared/1 ", { revision: 8.9 });
    assert.deepEqual(calls, [
      {
        path: "/v1/communications/drafts?company_id=company-1&revision=4",
        method: "GET",
      },
      {
        path: "/v1/communications/drafts/draft%3Ashared%2F1?company_id=company-1&revision=8",
        method: "DELETE",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
