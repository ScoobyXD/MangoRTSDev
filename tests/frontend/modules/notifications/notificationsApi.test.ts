import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteNotification,
  deleteNotifications,
  markNotificationRead,
  markNotificationsRead,
} from "../../../../frontend/src/modules/notifications/notificationsApi.js";

type MutableTestGlobal = {
  window?: unknown;
  CustomEvent?: unknown;
  fetch: typeof fetch;
};

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function installTestWindow(): { events: CustomEvent<{ companyID?: string }>[]; restore: () => void } {
  const mutableGlobal = globalThis as unknown as MutableTestGlobal;
  const originalWindow = mutableGlobal.window;
  const originalCustomEvent = mutableGlobal.CustomEvent;
  const events: CustomEvent<{ companyID?: string }>[] = [];

  if (!originalCustomEvent) {
    class TestCustomEvent<T = unknown> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    }
    mutableGlobal.CustomEvent = TestCustomEvent as unknown as typeof CustomEvent;
  }

  mutableGlobal.window = {
    location: { origin: "https://app.example.test" },
    dispatchEvent(event: Event): boolean {
      events.push(event as CustomEvent<{ companyID?: string }>);
      return true;
    },
  } as Window;

  return {
    events,
    restore: () => {
      if (originalWindow) {
        mutableGlobal.window = originalWindow;
      } else {
        delete mutableGlobal.window;
      }
      if (originalCustomEvent) {
        mutableGlobal.CustomEvent = originalCustomEvent;
      } else {
        delete mutableGlobal.CustomEvent;
      }
    },
  };
}

test("deleteNotification calls DELETE for one notification and emits an update event", async () => {
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  const calls: Array<{ url: string; method: string }> = [];
  (globalThis as unknown as MutableTestGlobal).fetch = async (input, init) => {
    calls.push({ url: input.toString(), method: init?.method ?? "GET" });
    return jsonResponse({ deleted_count: 1, notification_id: "notification-1" });
  };
  try {
    const count = await deleteNotification(" notification-1 ", "company-1");
    assert.equal(count, 1);
    assert.deepEqual(calls, [{ url: "https://app.example.test/v1/notifications/notification-1", method: "DELETE" }]);
    assert.equal(events.length, 1);
    assert.equal(events[0].detail.companyID, "company-1");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("deleteNotifications clears matching notifications with DELETE query scope", async () => {
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  const calls: Array<{ url: string; method: string }> = [];
  (globalThis as unknown as MutableTestGlobal).fetch = async (input, init) => {
    calls.push({ url: input.toString(), method: init?.method ?? "GET" });
    return jsonResponse({ deleted_count: 3 });
  };
  try {
    const count = await deleteNotifications({
      companyID: " company-1 ",
      type: "mention.created",
      surface: "r_inbox",
      role: "responsible",
      logicGateID: " logic-gate-1 ",
      nodeID: " node-1 ",
    });
    assert.equal(count, 3);
    assert.deepEqual(calls, [{
      url: "https://app.example.test/v1/notifications?company_id=company-1&type=mention.created&surface=r_inbox&role=responsible&logic_gate_id=logic-gate-1&node_id=node-1",
      method: "DELETE",
    }]);
    assert.equal(events.length, 1);
    assert.equal(events[0].detail.companyID, "company-1");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("read and unread helpers still use notification read endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const { restore } = installTestWindow();
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  (globalThis as unknown as MutableTestGlobal).fetch = async (input, init) => {
    calls.push({ url: input.toString(), method: init?.method ?? "GET", body: init?.body?.toString() });
    if (input.toString().endsWith("/read-all")) return jsonResponse({ updated_count: 2 });
    return jsonResponse({
      notification_id: "notification-1",
      company_id: "company-1",
      recipient_user_id: "user-1",
      type: "mention.created",
      source_event_id: "event-1",
      entity_type: "node",
      entity_id: "node-1",
      title: "Mention",
      created_timestamp: "2026-06-03T00:00:00.000Z",
    });
  };
  try {
    await markNotificationRead("notification-1", true);
    await markNotificationRead("notification-1", false);
    await markNotificationsRead({ companyID: "company-1", type: "mention.created" });
    assert.equal(calls[0].url, "https://app.example.test/v1/notifications/notification-1/read");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[1].url, "https://app.example.test/v1/notifications/notification-1/unread");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[2].url, "https://app.example.test/v1/notifications/read-all");
    assert.equal(calls[2].method, "POST");
    assert.match(calls[2].body ?? "", /"company_id":"company-1"/);
    assert.match(calls[2].body ?? "", /"type":"mention.created"/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
