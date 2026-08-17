import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureEmailCollaboration,
  getEmailCollaboration,
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
      newNodeID: "floating-node-1",
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
      new_node_id: "floating-node-1",
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
