import assert from "node:assert/strict";
import test from "node:test";

import { TerminalAuthFailureError } from "../../../../frontend/src/modules/api/requestJSON.js";
import { applyKanbanProjectionEnvelope, type KanbanProjectionEnvelope } from "../../../../frontend/src/modules/kanban/kanbanProjectionDeltas.js";
import {
  computeRealtimeReconnectDelayMs,
  parseRealtimeMessage,
  realtimeWebSocketURL,
  MangoRealtimeClient,
  type RealtimeErrorMessage,
  type RealtimeCommunicationsEventMessage,
  type RealtimeNotificationCreatedMessage,
  type RealtimeNotificationDeletedMessage,
  type RealtimeNotificationsClearedMessage,
  type RealtimePermissionRevokedMessage,
  type RealtimeProjectionDeltaMessage,
  type RealtimeSnapshotRefetchMessage,
  type RealtimeSubscriptionAcceptedMessage,
  type RealtimeSubscriptionRejectedMessage,
  type RealtimeWorkspaceEventMessage,
} from "../../../../frontend/src/modules/realtime/realtimeWebSocket.js";

test("parses realtime accepted, rejected, delta, refetch, and error messages", () => {
  const accepted = parseRealtimeMessage(JSON.stringify({ type: "subscription.accepted", scope: "board:A", current_sequence: 7 })) as RealtimeSubscriptionAcceptedMessage;
  assert.equal(accepted.type, "subscription.accepted");
  assert.equal(accepted.scope, "board:A");
  assert.equal(accepted.current_sequence, 7);

  const rejected = parseRealtimeMessage(JSON.stringify({ type: "subscription.rejected", scope: "board:B", error: "access_denied" })) as RealtimeSubscriptionRejectedMessage;
  assert.equal(rejected.type, "subscription.rejected");
  assert.equal(rejected.scope, "board:B");
  assert.equal(rejected.error, "access_denied");

  const delta = parseRealtimeMessage(JSON.stringify({
    type: "projection.delta",
    scope: "board:A",
    sequence: 8,
    projection: "kanban_board",
    projection_sequence: 8,
    resource_type: "logic_gate",
    resource_id: "gate-1",
    affected_scopes: ["my_work:user:user-1", "my_work:user:user-1", ""],
    deltas: [{ operation: "delete", row_key: { board_id: "A", card_id: "card-1" } }],
  })) as RealtimeProjectionDeltaMessage;
  assert.equal(delta.type, "projection.delta");
  assert.equal(delta.scope, "board:A");
  assert.equal(delta.sequence, 8);
  assert.equal(delta.projection_sequence, 8);
  assert.equal(delta.resource_type, "logic_gate");
  assert.equal(delta.resource_id, "gate-1");
  assert.deepEqual(delta.affected_scopes, ["my_work:user:user-1"]);
  assert.equal(delta.deltas.length, 1);

  const workspace = parseRealtimeMessage(JSON.stringify({
    type: "workspace.event",
    company_id: "company-1",
    scope: "workspace:user:user-1",
    sequence: 3,
    event: {
      company_id: "company-1",
      sequence: 3,
      type: "node_updated",
      data: { node_id: "node-1" },
    },
  })) as RealtimeWorkspaceEventMessage;
  assert.equal(workspace.type, "workspace.event");
  assert.equal(workspace.company_id, "company-1");
  assert.equal(workspace.scope, "workspace:user:user-1");
  assert.equal(workspace.sequence, 3);
  assert.equal(workspace.event.type, "node_updated");
  assert.deepEqual(workspace.event.data, { node_id: "node-1" });

  const created = parseRealtimeMessage(JSON.stringify({
    type: "notification.created",
    company_id: "company-1",
    scope: "notifications:user:user-1",
    affected_scopes: ["updates:user:user-1", "updates:user:user-1", ""],
    notification: {
      notification_id: "notification-1",
      company_id: "company-1",
      recipient_user_id: "user-1",
      type: "mention.created",
      source_event_id: "event-1",
      entity_type: "node",
      entity_id: "node-1",
      title: "Mention",
      created_timestamp: "2026-06-03T10:00:00.000Z",
    },
    ts: "2026-06-03T10:00:01.000Z",
  })) as RealtimeNotificationCreatedMessage;
  assert.equal(created.type, "notification.created");
  assert.equal(created.company_id, "company-1");
  assert.equal(created.scope, "notifications:user:user-1");
  assert.deepEqual(created.affected_scopes, ["updates:user:user-1"]);
  assert.equal(created.notification.notification_id, "notification-1");
  assert.equal(created.ts, "2026-06-03T10:00:01.000Z");

  const deleted = parseRealtimeMessage(JSON.stringify({
    type: "notification.deleted",
    company_id: "company-1",
    scope: "notifications:user:user-1",
    notification_id: "notification-1",
    ts: "2026-06-03T10:00:02.000Z",
  })) as RealtimeNotificationDeletedMessage;
  assert.equal(deleted.type, "notification.deleted");
  assert.equal(deleted.company_id, "company-1");
  assert.equal(deleted.scope, "notifications:user:user-1");
  assert.equal(deleted.notification_id, "notification-1");
  assert.equal(deleted.ts, "2026-06-03T10:00:02.000Z");

  const cleared = parseRealtimeMessage(JSON.stringify({
    type: "notifications.cleared",
    company_id: "company-1",
    scope: "notifications:user:user-1",
    deleted_count: 4,
    ts: "2026-06-03T10:00:02.500Z",
  })) as RealtimeNotificationsClearedMessage;
  assert.equal(cleared.type, "notifications.cleared");
  assert.equal(cleared.company_id, "company-1");
  assert.equal(cleared.scope, "notifications:user:user-1");
  assert.equal(cleared.deleted_count, 4);
  assert.equal(cleared.ts, "2026-06-03T10:00:02.500Z");

  const communications = parseRealtimeMessage(JSON.stringify({
    type: "communications.event",
    company_id: "company-1",
    scope: "communications:user:user-1",
    event: {
      user_id: "user-1",
      type: "mailbox_changed",
      trigger: "message.created",
      message_id: "message-1",
      ts: "2026-06-03T10:00:03.000Z",
    },
  })) as RealtimeCommunicationsEventMessage;
  assert.equal(communications.type, "communications.event");
  assert.equal(communications.company_id, "company-1");
  assert.equal(communications.scope, "communications:user:user-1");
  assert.equal(communications.event.type, "mailbox_changed");
  assert.equal(communications.event.trigger, "message.created");
  assert.equal(communications.event.message_id, "message-1");

  const refetch = parseRealtimeMessage(JSON.stringify({ type: "snapshot.refetch", scope: "board:A", sequence: 9, reason: "sequence_unavailable" })) as RealtimeSnapshotRefetchMessage;
  assert.equal(refetch.type, "snapshot.refetch");
  assert.equal(refetch.scope, "board:A");
  assert.equal(refetch.sequence, 9);
  assert.equal(refetch.reason, "sequence_unavailable");

  const revoked = parseRealtimeMessage(JSON.stringify({ type: "permission.revoked", scope: "board:A", resource_type: "logic_gate", resource_id: "gate-1", reason: "permission_revoked" })) as RealtimePermissionRevokedMessage;
  assert.equal(revoked.type, "permission.revoked");
  assert.equal(revoked.scope, "board:A");
  assert.equal(revoked.resource_type, "logic_gate");
  assert.equal(revoked.resource_id, "gate-1");
  assert.equal(revoked.reason, "permission_revoked");

  const error = parseRealtimeMessage(JSON.stringify({ type: "error", error: "invalid_json" })) as RealtimeErrorMessage;
  assert.equal(error.type, "error");
  assert.equal(error.error, "invalid_json");
});

test("websocket URL does not include credential query params", () => {
  const url = new URL(realtimeWebSocketURL("https://api.example.test", "company-1"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.searchParams.get("company_id"), "company-1");
  assert.equal(url.searchParams.has("ticket"), false);
  assert.equal(url.searchParams.has("access_token"), false);
  assert.equal(url.searchParams.has("token"), false);
});

test("realtime reconnect delay uses jittered exponential backoff", () => {
  assert.equal(computeRealtimeReconnectDelayMs(0, { baseDelayMs: 1_000, random: () => 0 }), 500);
  assert.equal(computeRealtimeReconnectDelayMs(1, { baseDelayMs: 1_000, random: () => 1 }), 2_000);
  assert.equal(computeRealtimeReconnectDelayMs(4, { baseDelayMs: 1_000, maxDelayMs: 10_000, random: () => 1 }), 10_000);
});

test("realtime client does not reconnect after terminal auth failure", async () => {
  let ticketRequests = 0;
  const client = new MangoRealtimeClient("https://api.example.test", "company-1", {
    getTicket: async () => {
      ticketRequests += 1;
      throw new TerminalAuthFailureError("http_401");
    },
    reconnectDelayMs: 1,
  });

  const unsubscribe = client.subscribe("board:A");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(ticketRequests, 1);
  unsubscribe();
  client.close();
});

test("realtime client mints cookie before opening websocket without query credentials", async () => {
  const openedURLs: string[] = [];
  const sentMessages: string[] = [];
  let minted = false;
  const originalWebSocket = globalThis.WebSocket;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
      openedURLs.push(url);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      });
    }

    send(message: string): void {
      sentMessages.push(message);
    }

    close(): void {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  try {
    const client = new MangoRealtimeClient("https://api.example.test", "company-1", {
      WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      getTicket: async () => {
        minted = true;
      },
      reconnectDelayMs: 60_000,
    });
    let ready = false;
    const unsubscribe = client.subscribe("board:A", { onReady: () => { ready = true; } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ready, true);
    assert.equal(minted, true);
    assert.equal(openedURLs.length, 1);
    const url = new URL(openedURLs[0]);
    assert.equal(url.searchParams.has("ticket"), false);
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(sentMessages.some((message) => JSON.parse(message).type === "subscribe"), true);
    unsubscribe();
    client.close();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("realtime client ignores stale ticket opens after retain cleanup", async () => {
  const openedURLs: string[] = [];
  const ticketResolvers: Array<() => void> = [];

  class FakeStaleOpenWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeStaleOpenWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
      openedURLs.push(url);
      queueMicrotask(() => {
        this.readyState = FakeStaleOpenWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(_message: string): void {}

    close(): void {
      this.readyState = FakeStaleOpenWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  const client = new MangoRealtimeClient("https://api.example.test", "company-1", {
    WebSocketCtor: FakeStaleOpenWebSocket as unknown as typeof WebSocket,
    getTicket: () => new Promise<void>((resolve) => {
      ticketResolvers.push(resolve);
    }),
    reconnectDelayMs: 60_000,
  });

  const releaseStaleOpen = client.retain();
  releaseStaleOpen();
  const releaseCurrentOpen = client.retain();

  assert.equal(ticketResolvers.length, 2);
  ticketResolvers[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(openedURLs.length, 0);

  ticketResolvers[1]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(openedURLs.length, 1);

  releaseCurrentOpen();
  client.close();
});

test("realtime client reuses one websocket for GVIC matrix and notification scopes", async () => {
  const openedURLs: string[] = [];
  const sentMessages: string[] = [];

  class FakeSharedWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeSharedWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(url: string) {
      openedURLs.push(url);
      queueMicrotask(() => {
        this.readyState = FakeSharedWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      });
    }

    send(message: string): void {
      sentMessages.push(message);
    }

    close(): void {
      this.readyState = FakeSharedWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  const client = new MangoRealtimeClient("https://api.example.test", "company-1", {
    WebSocketCtor: FakeSharedWebSocket as unknown as typeof WebSocket,
    getTicket: async () => undefined,
    reconnectDelayMs: 60_000,
  });
  const unsubscribeNotifications = client.subscribe("notifications:user:user-a");
  const unsubscribeGvic = client.subscribe("gvic_matrix:user:user-a", { getAfterSequence: () => 12 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(openedURLs.length, 1);
  const subscriptions = sentMessages
    .map((message) => JSON.parse(message) as { type: string; scope?: string; after_sequence?: number })
    .filter((message) => message.type === "subscribe");
  assert.deepEqual(subscriptions.map((message) => message.scope).sort(), ["gvic_matrix:user:user-a", "notifications:user:user-a"]);
  assert.equal(subscriptions.find((message) => message.scope === "gvic_matrix:user:user-a")?.after_sequence, 12);

  unsubscribeNotifications();
  unsubscribeGvic();
  client.close();
});

test("realtime client dispatches notification messages only to the exact subscribed scope", async () => {
  const sockets: Array<{ onmessage: ((event: { data: string }) => void) | null }> = [];
  const originalWebSocket = globalThis.WebSocket;

  class FakeNotificationWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeNotificationWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(_url: string) {
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeNotificationWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      });
    }

    send(_message: string): void {}

    close(): void {
      this.readyState = FakeNotificationWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeNotificationWebSocket as unknown as typeof WebSocket;
  try {
    const client = new MangoRealtimeClient("https://api.example.test", "company-1", {
      WebSocketCtor: FakeNotificationWebSocket as unknown as typeof WebSocket,
      getTicket: async () => undefined,
      reconnectDelayMs: 60_000,
    });
    const created: RealtimeNotificationCreatedMessage[] = [];
    const deleted: RealtimeNotificationDeletedMessage[] = [];
    const cleared: RealtimeNotificationsClearedMessage[] = [];
    const unrelated: RealtimeNotificationCreatedMessage[] = [];
    const unsubscribeA = client.subscribe("notifications:user:user-a", {
      onNotificationCreated: (message) => created.push(message),
      onNotificationDeleted: (message) => deleted.push(message),
      onNotificationsCleared: (message) => cleared.push(message),
    });
    const unsubscribeB = client.subscribe("notifications:user:user-b", {
      onNotificationCreated: (message) => unrelated.push(message),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    sockets[0].onmessage?.({ data: JSON.stringify({
      type: "notification.created",
      company_id: "company-1",
      scope: "notifications:user:user-a",
      notification: {
        notification_id: "notification-a",
        company_id: "company-1",
        recipient_user_id: "user-a",
        type: "mention.created",
        source_event_id: "event-a",
        entity_type: "node",
        entity_id: "node-a",
        title: "Mention A",
        created_timestamp: "2026-06-03T10:00:00.000Z",
      },
    }) });
    sockets[0].onmessage?.({ data: JSON.stringify({
      type: "notification.deleted",
      company_id: "company-1",
      scope: "notifications:user:user-a",
      notification_id: "notification-a",
    }) });
    sockets[0].onmessage?.({ data: JSON.stringify({
      type: "notifications.cleared",
      company_id: "company-1",
      scope: "notifications:user:user-a",
      deleted_count: 3,
    }) });

    assert.equal(created.length, 1);
    assert.equal(created[0].notification.notification_id, "notification-a");
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].notification_id, "notification-a");
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0].deleted_count, 3);
    assert.equal(unrelated.length, 0);
    unsubscribeA();
    unsubscribeB();
    client.close();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("applies Kanban upsert and delete from realtime projection delta without refetch", () => {
  const versions = new Map<string, number>();
  const upsert = parseRealtimeMessage(JSON.stringify({
    type: "projection.delta",
    company_id: "company-1",
    scope: "board:board-A",
    sequence: 1,
    projection: "kanban_board",
    projection_scope: "board:board-A",
    projection_sequence: 1,
    projected_timestamp: "2026-06-03T10:00:00.000Z",
    deltas: [{
      operation: "upsert",
      row_key: { board_id: "board-A", card_id: "card-1", node_id: "node-1" },
      row: {
        company_id: "company-1",
        board_id: "board-A",
        card_id: "card-1",
        column_id: "pending",
        node_id: "node-1",
        logic_gate_id: "gate-1",
        node_title: "Realtime card",
        description_snapshot: "",
        is_issue: false,
        position: 1000,
        created_timestamp: "2026-06-03T10:00:00.000Z",
        updated_timestamp: "2026-06-03T10:00:00.000Z",
        projection_updated_timestamp: "2026-06-03T10:00:00.000Z",
      },
    }],
  })) as RealtimeProjectionDeltaMessage;

  const upserted = applyKanbanProjectionEnvelope({
    envelope: upsert as unknown as KanbanProjectionEnvelope,
    companyID: "company-1",
    boardID: "board-A",
    cards: [],
    versions,
  });
  assert.equal(upserted.fallback, false);
  assert.equal(upserted.changed, true);
  assert.equal(upserted.cards.length, 1);
  assert.equal(upserted.cards[0].card_id, "card-1");

  const deleted = applyKanbanProjectionEnvelope({
    envelope: parseRealtimeMessage(JSON.stringify({
      type: "projection.delta",
      company_id: "company-1",
      scope: "board:board-A",
      sequence: 2,
      projection: "kanban_board",
      projection_scope: "board:board-A",
      projection_sequence: 2,
      projected_timestamp: "2026-06-03T10:00:01.000Z",
      deltas: [{ operation: "delete", row_key: { board_id: "board-A", card_id: "card-1" } }],
    })) as unknown as KanbanProjectionEnvelope,
    companyID: "company-1",
    boardID: "board-A",
    cards: upserted.cards,
    versions,
    lastSequence: upserted.lastSequence,
  });

  assert.equal(deleted.fallback, false);
  assert.equal(deleted.changed, true);
  assert.equal(deleted.cards.length, 0);
  assert.deepEqual(deleted.removedCardIDs, ["card-1"]);
});
