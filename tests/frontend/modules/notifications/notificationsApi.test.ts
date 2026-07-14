import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationRealtimeHandlers } from "../../../../frontend/src/modules/notifications/notificationRealtimeCoordinator.js";
import { updatesNotificationEventRequiresReload } from "../../../../frontend/src/pages/home/updatesSelection.js";
import {
  claimLocalNotificationClearReconciliation,
  claimLocalNotificationDeleteReconciliation,
  deleteNotification,
  deleteNotifications,
  EVENT_NOTIFICATIONS_UPDATED,
  markNotificationRead,
  markNotificationsRead,
  NOTIFICATION_UPDATE_SOURCE_REALTIME_ACCEPTED,
  NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
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

function installTestWindow(): { events: CustomEvent<{ companyID?: string; source?: string }>[]; testWindow: Window; restore: () => void } {
  const mutableGlobal = globalThis as unknown as MutableTestGlobal;
  const originalWindow = mutableGlobal.window;
  const originalCustomEvent = mutableGlobal.CustomEvent;
  const events: CustomEvent<{ companyID?: string; source?: string }>[] = [];

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

  const eventTarget = new EventTarget();
  const testWindow = {
    location: { origin: "https://app.example.test" },
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent(event: Event): boolean {
      events.push(event as CustomEvent<{ companyID?: string; source?: string }>);
      return eventTarget.dispatchEvent(event);
    },
  } as Window;
  mutableGlobal.window = testWindow;

  return {
    events,
    testWindow,
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
  const { events, testWindow, restore } = installTestWindow();
  const calls: Array<{ url: string; method: string }> = [];
  (globalThis as unknown as MutableTestGlobal).fetch = async (input, init) => {
    calls.push({ url: input.toString(), method: init?.method ?? "GET" });
    return jsonResponse({ deleted_count: 1, notification_id: "notification-1" });
  };
  let summaryLoads = 0;
  let openFeedLoads = 0;
  testWindow.addEventListener(EVENT_NOTIFICATIONS_UPDATED, () => { summaryLoads += 1; });
  testWindow.addEventListener(EVENT_NOTIFICATIONS_UPDATED, () => { openFeedLoads += 1; });
  try {
    const count = await deleteNotification(" notification-1 ", "company-1");
    assert.equal(count, 1);
    const handlers = createNotificationRealtimeHandlers("company-1");
    handlers.onNotificationDeleted({
      company_id: "company-1",
      notification_id: "notification-1",
    });
    assert.equal(events.length, 1, "the local socket echo must not emit a second reconciliation event");
    assert.equal(summaryLoads, 1, "HTTP plus matching socket echo must request one summary reconciliation");
    assert.equal(openFeedLoads, 1, "HTTP plus matching socket echo must request one mounted Updates reconciliation");
    assert.deepEqual(calls, [{ url: "https://app.example.test/v1/notifications/notification-1", method: "DELETE" }]);
    assert.equal(events[0].detail.companyID, "company-1");
    assert.equal(events[0].detail.source, "");
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
      role: "generated",
      logicGateID: " logic-gate-1 ",
      nodeID: " node-1 ",
    });
    assert.equal(count, 3);
    assert.deepEqual(calls, [{
      url: "https://app.example.test/v1/notifications?company_id=company-1&type=mention.created&surface=r_inbox&role=generated&logic_gate_id=logic-gate-1&node_id=node-1",
      method: "DELETE",
    }]);
    assert.equal(events.length, 1);
    createNotificationRealtimeHandlers("company-1").onNotificationsCleared({ company_id: "company-1" });
    assert.equal(events.length, 1, "the local clear socket echo must not emit a second reconciliation event");
    assert.equal(events[0].detail.companyID, "company-1");
    assert.equal(events[0].detail.source, "");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("delete helpers can tag notification update event source", async () => {
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  (globalThis as unknown as MutableTestGlobal).fetch = async () => jsonResponse({ deleted_count: 1 });
  try {
    await deleteNotification("notification-1", "company-1", { source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN });
    await deleteNotifications({ companyID: "company-1", source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN });
    assert.deepEqual(events.map((event) => event.detail), [
      { companyID: "company-1", source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN },
      { companyID: "company-1", source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN },
    ]);
    assert.deepEqual(claimLocalNotificationDeleteReconciliation("company-1", "notification-1"), {
      source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
      shouldReconcile: false,
    });
    assert.deepEqual(claimLocalNotificationClearReconciliation("company-1"), {
      source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
      shouldReconcile: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a committed delete reconciles from its socket echo when the HTTP response is lost", async () => {
  const originalFetch = globalThis.fetch;
  const { events, testWindow, restore } = installTestWindow();
  let summaryLoads = 0;
  let mountedFeedLoads = 0;
  testWindow.addEventListener(EVENT_NOTIFICATIONS_UPDATED, (event) => {
    summaryLoads += 1;
    const detail = (event as CustomEvent<{ companyID?: string; source?: string }>).detail;
    if (updatesNotificationEventRequiresReload({
      activeCompanyID: "company-1",
      eventCompanyID: detail.companyID,
      source: detail.source,
      localSeenSource: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
    })) {
      mountedFeedLoads += 1;
    }
  });
  let rejectResponse: ((reason?: unknown) => void) | undefined;
  (globalThis as unknown as MutableTestGlobal).fetch = () => new Promise<Response>((_resolve, reject) => {
    rejectResponse = reject;
  });
  try {
    const pendingDelete = deleteNotification("notification-lost-response", "company-1", {
      source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
    });
    await Promise.resolve();
    const handlers = createNotificationRealtimeHandlers("company-1");
    handlers.onNotificationDeleted({ company_id: "company-1", notification_id: "notification-lost-response" });
    assert.deepEqual(events.map((event) => event.detail), [{
      companyID: "company-1",
      source: "",
    }]);
    assert.equal(summaryLoads, 1, "the socket winner reconciles notification summary once");
    assert.equal(mountedFeedLoads, 1, "the socket winner uses a canonical source so mounted Updates reconciles once");
    handlers.onNotificationDeleted({ company_id: "company-1", notification_id: "notification-lost-response" });
    assert.equal(events.length, 1, "duplicate socket delivery must not request another reconciliation");
    rejectResponse?.(new TypeError("response_lost"));
    await assert.rejects(pendingDelete, /response_lost/);
    assert.equal(events.length, 1, "a rejected HTTP observer must not undo or duplicate the socket reconciliation");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a socket-first clear and its later HTTP completion request one reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  let resolveResponse: ((response: Response) => void) | undefined;
  (globalThis as unknown as MutableTestGlobal).fetch = () => new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  try {
    const pendingClear = deleteNotifications({ companyID: "company-socket-first", source: "test-local-clear" });
    await Promise.resolve();
    const handlers = createNotificationRealtimeHandlers("company-socket-first");
    handlers.onNotificationsCleared({ company_id: "company-socket-first" });
    assert.deepEqual(events.map((event) => event.detail), [{ companyID: "company-socket-first", source: "" }]);
    resolveResponse?.(jsonResponse({ deleted_count: 2 }));
    assert.equal(await pendingClear, 2);
    assert.equal(events.length, 1, "the later HTTP completion must observe the claimed marker without reloading again");
    handlers.onNotificationsCleared({ company_id: "company-socket-first" });
    assert.equal(events.length, 2, "after both observers claim the local clear, a distinct later clear must reconcile");
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("a failed clear releases its marker so a later socket event reconciles", async () => {
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  (globalThis as unknown as MutableTestGlobal).fetch = async () => {
    throw new TypeError("clear_failed");
  };
  try {
    await assert.rejects(
      deleteNotifications({ companyID: "company-failed-clear", source: "test-local-clear" }),
      /clear_failed/,
    );
    createNotificationRealtimeHandlers("company-failed-clear")
      .onNotificationsCleared({ company_id: "company-failed-clear" });
    assert.deepEqual(events.map((event) => event.detail), [{ companyID: "company-failed-clear", source: "" }]);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("an accepted notification subscription reconciles summary without reloading the mounted Updates feed", () => {
  const { events, restore } = installTestWindow();
  try {
    const handlers = createNotificationRealtimeHandlers("company-1");
    handlers.onAccepted();
    assert.deepEqual(events.map((event) => event.detail), [
      { companyID: "company-1", source: NOTIFICATION_UPDATE_SOURCE_REALTIME_ACCEPTED },
    ]);
    assert.equal(updatesNotificationEventRequiresReload({
      activeCompanyID: "company-1",
      eventCompanyID: events[0].detail.companyID,
      source: events[0].detail.source,
      localSeenSource: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
      summaryOnlySource: NOTIFICATION_UPDATE_SOURCE_REALTIME_ACCEPTED,
    }), false);
  } finally {
    restore();
  }
});


test("read and unread helpers still use notification read endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
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
    assert.deepEqual(events.map((event) => event.detail.companyID), ["company-1", "company-1", "company-1"]);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
