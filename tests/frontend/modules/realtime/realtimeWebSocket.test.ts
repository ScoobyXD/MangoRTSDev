import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { TerminalAuthFailureError } from "../../../../frontend/src/modules/api/requestJSON.js";
import { createCoalescedCanonicalRefresh } from "../../../../frontend/src/modules/realtime/coalescedCanonicalRefresh.js";
import { shouldBlockRealtimeMutation, type RealtimeHealthStatus } from "../../../../frontend/src/modules/realtime/realtimeHealth.js";
import {
  computeRealtimeReconnectDelayMs,
  isSupportedRealtimeScope,
  matchesHuddleActionItemsRealtimeMessage,
  MangoRealtimeClient,
  parseRealtimeMessage,
  realtimeEditorScope,
  realtimeEditorJSONScope,
  realtimeHuddleActionItemsScope,
  realtimeHuddleBoardActionItemsScope,
  realtimePersonalMailboxScope,
  realtimeSharedMailboxScope,
  realtimeWebSocketURL,
  type RealtimeChatMessageCreatedMessage,
  type RealtimeChatMessageUpdatedMessage,
  type RealtimeChatMessageDeletedMessage,
  type RealtimeProcessWorkChangedMessage,
  type RealtimeHuddleActionItemsChangedMessage,
  type RealtimeLogicGateQDRatingUpdatedMessage,
  type RealtimeMailboxFolderChangedMessage,
  type RealtimeMailboxMessageChangedMessage,
  type RealtimeNotificationCreatedMessage,
  type RealtimeProcessMapChangedMessage,
} from "../../../../frontend/src/modules/realtime/realtimeWebSocket.js";

test("parses retained product and scoped mailbox message families", () => {
  const ready = parseRealtimeMessage(JSON.stringify({
    type: "ready",
    connection_id: " connection-1 ",
    connection_correlation: " correlation-1 ",
  }));
  assert.equal(ready.type, "ready");
  if (ready.type !== "ready") throw new Error("expected_ready_message");
  assert.equal(ready.connection_id, "connection-1");
  assert.equal(ready.connection_correlation, "correlation-1");

  const notification = parseRealtimeMessage(JSON.stringify({
    type: "notification.created",
    company_id: "company-1",
    scope: "notifications:user:user-1",
    notification: {
      notification_id: "notification-1",
      recipient_user_id: "user-1",
      type: "mention.created",
      source_event_id: "event-1",
      entity_type: "node",
      entity_id: "node-1",
      title: "Mention",
      created_timestamp: "2026-07-12T12:00:00.000Z",
    },
  })) as RealtimeNotificationCreatedMessage;
  assert.equal(notification.notification.notification_id, "notification-1");

  const created = parseRealtimeMessage(JSON.stringify({
    type: "chat.message.created",
    company_id: "company-1",
    scope: "chat:node:node-1",
    node_id: "node-1",
    block_id: "block-1",
    message_id: "message-1",
  })) as RealtimeChatMessageCreatedMessage;
  assert.equal(created.block_id, "block-1");
  assert.equal(created.message_id, "message-1");

  const updated = parseRealtimeMessage(JSON.stringify({
    type: "chat.message.updated",
    company_id: "company-1",
    scope: "chat:node:node-1",
    node_id: "node-1",
    block_id: "block-1",
    message_id: "message-1",
  })) as RealtimeChatMessageUpdatedMessage;
  assert.equal(updated.block_id, "block-1");
  assert.equal(updated.message_id, "message-1");

  const deleted = parseRealtimeMessage(JSON.stringify({
    type: "chat.message.deleted",
    company_id: "company-1",
    scope: "chat:node:node-1",
    node_id: "node-1",
    block_id: "block-1",
    message_id: "message-1",
  })) as RealtimeChatMessageDeletedMessage;
  assert.equal(deleted.node_id, "node-1");

  const board = parseRealtimeMessage(JSON.stringify({
    type: "process.work.changed",
    company_id: "company-1",
    scope: "process:gate-1",
    logic_gate_id: "gate-1",
    change_type: "node.moved",
  })) as RealtimeProcessWorkChangedMessage;
  assert.equal(board.logic_gate_id, "gate-1");
  assert.equal(board.change_type, "node.moved");

  const processMap = parseRealtimeMessage(JSON.stringify({
    type: "process_map.changed",
    company_id: "company-1",
    scope: "process-map:company",
    origin_connection_id: " connection-1 ",
    protected_geometry_changed: false,
    ts: "2026-08-24T12:00:00Z",
  })) as RealtimeProcessMapChangedMessage;
  assert.equal(processMap.company_id, "company-1");
  assert.equal(processMap.scope, "process-map:company");
  assert.equal(processMap.origin_connection_id, "connection-1");
  assert.equal(processMap.protected_geometry_changed, false);

  const protectedProcessMap = parseRealtimeMessage(JSON.stringify({
    type: "process_map.changed",
    company_id: "company-1",
    scope: "process-map:company",
    protected_geometry_changed: true,
  })) as RealtimeProcessMapChangedMessage;
  assert.equal(protectedProcessMap.protected_geometry_changed, true);
  for (const protectedGeometryChanged of [undefined, "true", 1, null]) {
    const conservativelyProtected = parseRealtimeMessage(JSON.stringify({
      type: "process_map.changed",
      company_id: "company-1",
      scope: "process-map:company",
      ...(protectedGeometryChanged === undefined ? {} : { protected_geometry_changed: protectedGeometryChanged }),
    })) as RealtimeProcessMapChangedMessage;
    assert.equal(conservativelyProtected.protected_geometry_changed, true, "missing or invalid protection metadata must conservatively purge geometry");
  }

  const qdRating = parseRealtimeMessage(JSON.stringify({
    type: "logic_gate_qd_rating_updated",
    company_id: "company-1",
    scope: "editor-json:logic_gate:gate-1:qd-ratings",
    logic_gate_id: " gate-1 ",
  })) as RealtimeLogicGateQDRatingUpdatedMessage;
  assert.equal(qdRating.logic_gate_id, "gate-1");

  const huddleNodeActionItems = parseRealtimeMessage(JSON.stringify({
    type: "huddle_action_items.changed",
    company_id: "company-1",
    scope: "huddle-action-items:node-1",
    huddle_node_id: " node-1 ",
  })) as RealtimeHuddleActionItemsChangedMessage;
  assert.equal(huddleNodeActionItems.huddle_node_id, "node-1");

  const huddleBoardActionItems = parseRealtimeMessage(JSON.stringify({
    type: "huddle_action_items.changed",
    company_id: "company-1",
    scope: "huddle-board-action-items:board-1",
    huddle_logic_gate_id: " board-1 ",
  })) as RealtimeHuddleActionItemsChangedMessage;
  assert.equal(huddleBoardActionItems.huddle_logic_gate_id, "board-1");
  assert.equal(matchesHuddleActionItemsRealtimeMessage(
    huddleBoardActionItems,
    "company-1",
    "huddle-board-action-items:board-1",
    "board-1",
  ), true);
  assert.equal(matchesHuddleActionItemsRealtimeMessage(
    huddleBoardActionItems,
    "other-company",
    "huddle-board-action-items:board-1",
    "board-1",
  ), false, "a different company cannot invalidate the open Board");
  assert.equal(matchesHuddleActionItemsRealtimeMessage(
    huddleBoardActionItems,
    "company-1",
    "huddle-board-action-items:other-board",
    "board-1",
  ), false, "a sibling realtime scope cannot invalidate the open Board");
  assert.throws(() => parseRealtimeMessage(JSON.stringify({
    type: "huddle_action_items.changed",
    company_id: "company-1",
    scope: "huddle-board-action-items:board-1",
    huddle_node_id: "node-1",
  })), /realtime_huddle_logic_gate_id_required/);

  const mailboxMessage = parseRealtimeMessage(JSON.stringify({
    type: "mailbox.message.changed",
    company_id: "company-1",
    scope: "mailbox:personal:account:user-1:owner@example.com",
    trigger: "message.created",
    message_id: "message-2",
    thread_id: "thread-1",
    occurred_at: "2026-07-13T12:00:00Z",
  })) as RealtimeMailboxMessageChangedMessage;
  assert.equal(mailboxMessage.message_id, "message-2");
  assert.equal(mailboxMessage.thread_id, "thread-1");

  const mailboxFolder = parseRealtimeMessage(JSON.stringify({
    type: "mailbox.folder.changed",
    company_id: "company-1",
    scope: "mailbox:shared:shared-1",
    trigger: "folder.updated",
    shared_inbox_id: "shared-1",
  })) as RealtimeMailboxFolderChangedMessage;
  assert.equal(mailboxFolder.shared_inbox_id, "shared-1");
});

test("parses editor snapshots, tombstones, and application heartbeats", () => {
  const snapshotRequired = parseRealtimeMessage(JSON.stringify({
    type: "editor.snapshot.required",
    company_id: "company-1",
    scope: "editor:node:node-1:document-1",
    event_id: "event-restore-1",
    resource_type: "node",
    resource_id: "node-1",
    document_id: "document-1",
    resource_revision: 3,
    operation_id: "restore-operation-1",
    client_id: "server-save-version",
    reason: "canonical_snapshot_replaced",
  }));
  assert.equal(snapshotRequired.type, "editor.snapshot.required");
  assert.equal("patch" in snapshotRequired, false, "snapshot replacement events never fan out a full document body");
  const heartbeat = parseRealtimeMessage(JSON.stringify({ type: "heartbeat.confirmed", nonce: "nonce-1" }));
  assert.equal(heartbeat.type, "heartbeat.confirmed");
});

test("parses canonical editor events for Huddle, KPI, and Process Step documents", () => {
  for (const resourceType of ["huddle_node", "huddle_logic_gate", "kpi", "process_step"] as const) {
    const message = parseRealtimeMessage(JSON.stringify({
      type: "editor.snapshot.required",
      company_id: "company-1",
      scope: `editor-json:${resourceType}:resource-1:document-1`,
      event_id: `event-${resourceType}`,
      resource_type: resourceType,
      resource_id: "resource-1",
      document_id: "document-1",
      resource_revision: 4,
      operation_id: `operation-${resourceType}`,
      client_id: "remote-client",
    }));
    assert.equal(message.type, "editor.snapshot.required");
    assert.equal(message.resource_type, resourceType);
    assert.equal(isSupportedRealtimeScope(`editor-json:${resourceType}:resource-1:document-1`), true);
    assert.equal(parseRealtimeMessage(JSON.stringify({ ...message, type: "editor.document.deleted" })).type, "editor.document.deleted");
  }
});

test("rejects deleted broad protocol messages", () => {
  for (const type of ["projection.delta", "workspace.event", "communications.event", "snapshot.refetch", "permission.revoked", "editor.delta.committed"]) {
    assert.throws(() => parseRealtimeMessage(JSON.stringify({ type, company_id: "company-1", scope: "board:A" })), /unknown_realtime_message_type/);
  }
});

test("allows only exact notification, mailbox, node-chat, board, and editor scope families", () => {
  assert.equal(isSupportedRealtimeScope("notifications:user:user-1"), true);
  assert.equal(isSupportedRealtimeScope("chat:node:node-1"), true);
  assert.equal(isSupportedRealtimeScope("process:gate-1"), true);
  assert.equal(realtimeHuddleActionItemsScope(" node-1 "), "huddle-action-items:node-1");
  assert.equal(realtimeHuddleBoardActionItemsScope(" board-1 "), "huddle-board-action-items:board-1");
  assert.equal(isSupportedRealtimeScope("huddle-action-items:node-1"), true);
  assert.equal(isSupportedRealtimeScope("huddle-board-action-items:board-1"), true);
  assert.equal(isSupportedRealtimeScope("huddle-board-action-items:board-1:extra"), false);
  assert.equal(isSupportedRealtimeScope("raci-tabs:company"), false);
  assert.equal(isSupportedRealtimeScope("process-map:company"), true);
  assert.equal(isSupportedRealtimeScope("process-map:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("raci-tabs:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("mailbox:personal:account:user-1:owner@example.com"), true);
  assert.equal(isSupportedRealtimeScope("mailbox:shared:shared-1"), true);
  assert.equal(realtimePersonalMailboxScope(" user-1 ", " OWNER@example.com "), "mailbox:personal:account:user-1:owner@example.com");
  assert.equal(realtimePersonalMailboxScope("user-1", ""), "");
  assert.equal(isSupportedRealtimeScope("mailbox:personal:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("mailbox:personal:account:user-1:not-an-email"), false);
  assert.equal(realtimeSharedMailboxScope(" shared-1 "), "mailbox:shared:shared-1");
  assert.equal(isSupportedRealtimeScope("workspace:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("communications:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("editor:node:node-1:document-1"), true);
  assert.equal(realtimeEditorScope("node", " node-1 ", " document-1 "), "editor:node:node-1:document-1");
  assert.equal(
    realtimeEditorJSONScope("email_draft", " personal:user:mail@example.test ", " body:main "),
    "editor-json:email_draft:personal%3Auser%3Amail%40example.test:body%3Amain",
  );
  assert.equal(isSupportedRealtimeScope("editor-json:email_draft:personal%3Auser:body%3Amain"), true);
  assert.equal(isSupportedRealtimeScope("editor:node:node-1"), false);
  assert.equal(isSupportedRealtimeScope("editor:node:node-1:document-1:extra"), false);
  assert.equal(isSupportedRealtimeScope("board:"), false);
});

test("websocket URL has no credential query parameter", () => {
  const url = new URL(realtimeWebSocketURL("https://api.example.test", "company-1"));
  assert.equal(url.protocol, "wss:");
  assert.equal(url.searchParams.get("company_id"), "company-1");
  assert.equal(url.searchParams.has("ticket"), false);
  assert.equal(url.searchParams.has("access_token"), false);
  assert.equal(url.searchParams.has("token"), false);
});

test("reconnect delay uses bounded jittered exponential backoff", () => {
  assert.equal(computeRealtimeReconnectDelayMs(0, { baseDelayMs: 1_000, random: () => 0 }), 500);
  assert.equal(computeRealtimeReconnectDelayMs(1, { baseDelayMs: 1_000, random: () => 1 }), 2_000);
  assert.equal(computeRealtimeReconnectDelayMs(4, { baseDelayMs: 1_000, maxDelayMs: 10_000, random: () => 1 }), 10_000);
});

test("one client shares a socket and dispatches compact messages to exact scopes", async () => {
  const sockets: FakeWebSocket[] = [];
  const originalWebSocket = globalThis.WebSocket;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(_url: string) {
      sockets.push(this);
      const connectionID = `connection-${sockets.length}`;
      const connectionCorrelation = `correlation-${sockets.length}`;
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready", connection_id: connectionID, connection_correlation: connectionCorrelation }) });
      });
    }

    send(message: string): void {
      this.sent.push(message);
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
      getTicket: async () => undefined,
      reconnectDelayMs: 60_000,
    });
    let notifications = 0;
    let notificationAcceptances = 0;
    let chat = 0;
    let chatAcceptances = 0;
    let board = 0;
    let boardAcceptances = 0;
    let mailbox = 0;
    let huddleNodeActionItems = 0;
    let huddleBoardActionItems = 0;
    const unsubNotifications = client.subscribe("notifications:user:user-1", { onAccepted: () => { notificationAcceptances += 1; }, onNotificationCreated: () => { notifications += 1; } });
    const unsubChat = client.subscribe("chat:node:node-1", {
      onAccepted: () => { chatAcceptances += 1; },
      onChatMessageCreated: () => { chat += 1; },
      onChatMessageUpdated: () => { chat += 1; },
    });
    const unsubBoard = client.subscribe("process:gate-1", { onAccepted: () => { boardAcceptances += 1; }, onProcessWorkChanged: () => { board += 1; } });
    const unsubMailbox = client.subscribe("mailbox:personal:account:user-1:owner@example.com", { onMailboxMessageChanged: () => { mailbox += 1; } });
    const unsubHuddleNodeActionItems = client.subscribe("huddle-action-items:huddle-node-1", {
      onHuddleActionItemsChanged: () => { huddleNodeActionItems += 1; },
    });
    const unsubHuddleBoardActionItems = client.subscribe("huddle-board-action-items:huddle-board-1", {
      onHuddleActionItemsChanged: () => { huddleBoardActionItems += 1; },
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    assert.equal(sockets.length, 1);
    assert.equal(client.currentConnectionID(), "connection-1");
    assert.equal(client.currentConnectionCorrelation(), "correlation-1");
    const subscriptions = sockets[0].sent.map((raw) => JSON.parse(raw) as { type: string; scope?: string }).filter((message) => message.type === "subscribe");
    assert.deepEqual(subscriptions.map((message) => message.scope).sort(), ["chat:node:node-1", "huddle-action-items:huddle-node-1", "huddle-board-action-items:huddle-board-1", "mailbox:personal:account:user-1:owner@example.com", "notifications:user:user-1", "process:gate-1"]);

    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "notifications:user:user-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "chat:node:node-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "process:gate-1" }) });
    assert.equal(notificationAcceptances, 1);
    assert.equal(chatAcceptances, 1);
    assert.equal(boardAcceptances, 1);
    let lateChatAcceptances = 0;
    let lateBoardAcceptances = 0;
    const wireSubscribeCount = sockets[0].sent.filter((raw) => JSON.parse(raw).type === "subscribe").length;
    const unsubLateChat = client.subscribe("chat:node:node-1", {
      onAccepted: () => { lateChatAcceptances += 1; },
    });
    const unsubLateBoard = client.subscribe("process:gate-1", {
      onAccepted: () => { lateBoardAcceptances += 1; },
    });
    assert.equal(lateChatAcceptances, 1, "a second mounted editor immediately reconciles an already accepted node scope");
    assert.equal(lateBoardAcceptances, 1, "a second mounted work surface immediately reconciles an already accepted Process scope");
    assert.equal(sockets[0].sent.filter((raw) => JSON.parse(raw).type === "subscribe").length, wireSubscribeCount, "late local handlers do not duplicate the wire subscription");

    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.rejected", scope: "chat:node:node-1", error: "forbidden" }) });
    let acceptanceAfterRejection = 0;
    const unsubRejectedChat = client.subscribe("chat:node:node-1", {
      onAccepted: () => { acceptanceAfterRejection += 1; },
    });
    assert.equal(acceptanceAfterRejection, 0, "rejection clears local acceptance for later handlers");
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "chat:node:node-1" }) });
    assert.equal(chatAcceptances, 2);
    assert.equal(lateChatAcceptances, 2);
    assert.equal(acceptanceAfterRejection, 1);

    const transientScope = "process:transient";
    let transientAcceptances = 0;
    const transientSubscribeCount = sockets[0].sent.filter((raw) => JSON.parse(raw).type === "subscribe").length;
    const unsubTransient = client.subscribe(transientScope, {
      onAccepted: () => { transientAcceptances += 1; },
    });
    assert.equal(sockets[0].sent.filter((raw) => JSON.parse(raw).type === "subscribe").length, transientSubscribeCount + 1);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: transientScope }) });
    assert.equal(transientAcceptances, 1);
    unsubTransient();
    let freshTransientAcceptances = 0;
    const resubscribeCount = sockets[0].sent.filter((raw) => JSON.parse(raw).type === "subscribe").length;
    const unsubFreshTransient = client.subscribe(transientScope, {
      onAccepted: () => { freshTransientAcceptances += 1; },
    });
    assert.equal(freshTransientAcceptances, 0, "last unsubscribe clears local acceptance for a fresh handler");
    assert.equal(
      sockets[0].sent.filter((raw) => JSON.parse(raw).type === "subscribe").length,
      resubscribeCount + 1,
      "a fresh handler after the last unsubscribe sends a new wire subscription",
    );
    unsubFreshTransient();

    const stepID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const stepScope = realtimeEditorJSONScope("process_step", stepID, stepID);
    let stepSnapshots = 0;
    const unsubStep = client.subscribe(stepScope, {
      onEditorSnapshotRequired: () => { stepSnapshots += 1; },
    });
    assert.deepEqual(JSON.parse(sockets[0].sent.at(-1)!), { type: "subscribe", scope: stepScope });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: stepScope }) });
    const stepEvent = {
      type: "editor.snapshot.required", company_id: "company-1", scope: stepScope,
      event_id: "step-save-1", resource_type: "process_step", resource_id: stepID, document_id: stepID,
      resource_revision: 1, operation_id: "step-operation-1", client_id: "other-browser",
    };
    sockets[0].onmessage?.({ data: JSON.stringify(stepEvent) });
    assert.equal(stepSnapshots, 1, "a visible Step editor must receive canonical updates through its exact subscription");
    sockets[0].onmessage?.({ data: JSON.stringify({ ...stepEvent, scope: realtimeEditorJSONScope("process_step", "other-step", "other-step") }) });
    assert.equal(stepSnapshots, 1, "another Step's update must not reach this editor");
    unsubStep();

    sockets[0].onmessage?.({ data: JSON.stringify({
      type: "notification.created",
      company_id: "company-1",
      scope: "notifications:user:user-1",
      notification: { notification_id: "n-1", recipient_user_id: "user-1", type: "update", source_event_id: "e-1", entity_type: "node", entity_id: "node-1", title: "Update", created_timestamp: "2026-07-12T12:00:00Z" },
    }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "chat.message.created", company_id: "company-1", scope: "chat:node:node-1", node_id: "node-1", block_id: "block-1", message_id: "m-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "chat.message.updated", company_id: "company-1", scope: "chat:node:node-1", node_id: "node-1", block_id: "block-1", message_id: "m-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "process.work.changed", company_id: "company-1", scope: "process:gate-1", logic_gate_id: "gate-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "mailbox.message.changed", company_id: "company-1", scope: "mailbox:personal:account:user-1:owner@example.com", trigger: "message.created", message_id: "mail-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "huddle_action_items.changed", company_id: "company-1", scope: "huddle-action-items:huddle-node-1", huddle_node_id: "huddle-node-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "huddle_action_items.changed", company_id: "company-1", scope: "huddle-board-action-items:huddle-board-1", huddle_logic_gate_id: "huddle-board-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "chat.message.created", company_id: "company-1", scope: "chat:node:other", node_id: "other", block_id: "block-1", message_id: "m-2" }) });

    assert.equal(notifications, 1);
    assert.equal(chat, 2);
    assert.equal(board, 1);
    assert.equal(mailbox, 1);
    assert.equal(huddleNodeActionItems, 1);
    assert.equal(huddleBoardActionItems, 1);

    sockets[0].close();
    assert.equal(client.currentConnectionID(), undefined, "a closed socket cannot leave an obsolete write origin");
    assert.equal(client.currentConnectionCorrelation(), undefined, "a closed socket cannot leave an obsolete cross-server correlation");
    let downtimeChatAcceptances = 0;
    let downtimeBoardAcceptances = 0;
    const unsubDowntimeChat = client.subscribe("chat:node:node-1", {
      onAccepted: () => { downtimeChatAcceptances += 1; },
    });
    const unsubDowntimeBoard = client.subscribe("process:gate-1", {
      onAccepted: () => { downtimeBoardAcceptances += 1; },
    });
    assert.equal(downtimeChatAcceptances, 0, "a closed socket must not leak stale node-scope acceptance");
    assert.equal(downtimeBoardAcceptances, 0, "a closed socket must not leak stale board-scope acceptance");
    client.ensureOpen();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    assert.equal(sockets.length, 2);
    assert.equal(client.currentConnectionID(), "connection-2");
    assert.equal(client.currentConnectionCorrelation(), "correlation-2");
    assert.deepEqual(sockets[1].sent.map((raw) => JSON.parse(raw) as { type: string; scope?: string }).filter((message) => message.type === "subscribe").map((message) => message.scope).sort(), ["chat:node:node-1", "huddle-action-items:huddle-node-1", "huddle-board-action-items:huddle-board-1", "mailbox:personal:account:user-1:owner@example.com", "notifications:user:user-1", "process:gate-1"]);
    sockets[1].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "notifications:user:user-1" }) });
    sockets[1].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "chat:node:node-1" }) });
    sockets[1].onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "process:gate-1" }) });
    assert.equal(notificationAcceptances, 2);
    assert.equal(chatAcceptances, 3);
    assert.equal(boardAcceptances, 2);
    assert.equal(lateChatAcceptances, 3);
    assert.equal(lateBoardAcceptances, 2);
    assert.equal(acceptanceAfterRejection, 2);
    assert.equal(downtimeChatAcceptances, 1);
    assert.equal(downtimeBoardAcceptances, 1);
    unsubLateChat();
    unsubLateBoard();
    unsubDowntimeChat();
    unsubDowntimeBoard();
    unsubRejectedChat();
    unsubNotifications();
    unsubChat();
    unsubBoard();
    unsubMailbox();
    unsubHuddleNodeActionItems();
    unsubHuddleBoardActionItems();
    client.close();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("application heartbeat stays non-green through subscription recovery and drives all mutation-gating states", async () => {
  const sockets: FakeHealthWebSocket[] = [];
  class FakeHealthWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeHealthWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(_url: string) {
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeHealthWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      });
    }

    send(message: string): void { this.sent.push(message); }
    close(): void {
      if (this.readyState === FakeHealthWebSocket.CLOSED) return;
      this.readyState = FakeHealthWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  let finishRecovery: (() => void) | undefined;
  const recovery = new Promise<void>((resolveRecovery) => { finishRecovery = resolveRecovery; });
  const client = new MangoRealtimeClient("https://health.example.test", "health-company", {
    WebSocketCtor: FakeHealthWebSocket as unknown as typeof WebSocket,
    getTicket: async () => undefined,
    reconnectDelayMs: 60_000,
    heartbeatGraceMs: 1_000,
    attemptingAfterMs: 0,
    disconnectedAfterMs: 25,
  });
  const statuses: RealtimeHealthStatus[] = [];
  const unsubscribeEditor = client.subscribe("editor:node:node-health:document-health", { onRecover: () => recovery });
  const unsubscribeHealth = client.subscribeHealth((snapshot) => { statuses.push(snapshot.status); });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  socket.onmessage?.({ data: JSON.stringify({ type: "heartbeat.challenge", nonce: "health-nonce" }) });
  assert.deepEqual(JSON.parse(socket.sent[socket.sent.length - 1] ?? "{}"), { type: "heartbeat.response", nonce: "health-nonce" });
  socket.onmessage?.({ data: JSON.stringify({ type: "heartbeat.confirmed", nonce: "health-nonce" }) });
  socket.onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "editor:node:node-health:document-health" }) });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.notEqual(statuses[statuses.length - 1], "connected", "socket open plus heartbeat is not green before mounted-document recovery");
  assert.equal(shouldBlockRealtimeMutation("POST", "/v1/nodes/node-health"), true);
  assert.equal(shouldBlockRealtimeMutation("POST", "/v1/editor-json/node/node-health/documents/document-health"), false);

  finishRecovery?.();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(statuses[statuses.length - 1], "connected");
  assert.equal(shouldBlockRealtimeMutation("POST", "/v1/nodes/node-health"), false);

  socket.close();
  assert.equal(statuses[statuses.length - 1], "reconnecting");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  assert.equal(statuses[statuses.length - 1], "attempting");
  assert.equal(shouldBlockRealtimeMutation("DELETE", "/v1/nodes/node-health"), true);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
  assert.equal(statuses[statuses.length - 1], "disconnected");

  unsubscribeEditor();
  unsubscribeHealth();
  client.close();
});


test("adding a scope to a healthy socket does not create a global transport outage", async () => {
  const sockets: HealthyScopeWebSocket[] = [];

  class HealthyScopeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = HealthyScopeWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(_url: string) {
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = HealthyScopeWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
      });
    }

    send(message: string): void { this.sent.push(message); }
    close(): void {
      this.readyState = HealthyScopeWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  const client = new MangoRealtimeClient("https://scope-health.example.test", "scope-health-company", {
    WebSocketCtor: HealthyScopeWebSocket as unknown as typeof WebSocket,
    getTicket: async () => undefined,
    reconnectDelayMs: 60_000,
  });
  const statuses: RealtimeHealthStatus[] = [];
  const unsubscribeHealth = client.subscribeHealth((snapshot) => { statuses.push(snapshot.status); });
  const unsubscribeNotifications = client.subscribe("notifications:user:user-1");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  const socket = sockets[0];
  socket.onmessage?.({ data: JSON.stringify({ type: "heartbeat.confirmed", nonce: "healthy" }) });
  socket.onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "notifications:user:user-1" }) });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(statuses[statuses.length - 1], "connected");

  let rejected = "";
  const unsubscribeChat = client.subscribe("chat:node:node-1", {
    onRejected: (message) => { rejected = message.error ?? ""; },
  });
  assert.equal(statuses[statuses.length - 1], "connected");
  assert.equal(shouldBlockRealtimeMutation("POST", "/v1/nodes/node-1"), false);
  assert.equal(JSON.parse(socket.sent[socket.sent.length - 1] ?? "{}").scope, "chat:node:node-1");
  socket.onmessage?.({ data: JSON.stringify({ type: "subscription.rejected", scope: "chat:node:node-1", error: "forbidden" }) });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  assert.equal(rejected, "forbidden", "the rejected feature still receives its scoped error");
  assert.equal(statuses[statuses.length - 1], "connected", "an optional rejected scope cannot override a healthy heartbeat");
  assert.equal(shouldBlockRealtimeMutation("POST", "/v1/nodes/node-1"), false);

  unsubscribeChat();
  unsubscribeNotifications();
  unsubscribeHealth();
  client.close();
});
test("realtime ticket bootstrap bypasses its own degraded mutation gate", async () => {
  const originalFetch = globalThis.fetch;
  const sockets: FakeTicketWebSocket[] = [];
  const requests: Array<{ input: string; init?: RequestInit }> = [];

  class FakeTicketWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeTicketWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(readonly url: string) {
      sockets.push(this);
    }

    send(_message: string): void {}
    close(): void {
      if (this.readyState === FakeTicketWebSocket.CLOSED) return;
      this.readyState = FakeTicketWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({ expires_at: "2026-07-15T12:00:00Z" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const client = new MangoRealtimeClient("https://ticket.example.test", "ticket-company", {
    WebSocketCtor: FakeTicketWebSocket as unknown as typeof WebSocket,
    getAccessToken: async () => "ticket-token",
    reconnectDelayMs: 60_000,
  });

  try {
    const unsubscribe = client.subscribeHealth(() => undefined);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    assert.equal(requests.length, 1, "the initial reconnecting state must not block its own ticket request");
    assert.equal(requests[0]?.input, "https://ticket.example.test/v1/realtime/ticket");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(requests[0]?.init?.credentials, "include");
    assert.equal(new Headers(requests[0]?.init?.headers).get("Authorization"), "Bearer ticket-token");
    assert.equal(sockets.length, 1, "a successful ticket request must advance to WebSocket construction");
    assert.equal(sockets[0]?.url, "wss://ticket.example.test/v1/realtime/ws?company_id=ticket-company");

    unsubscribe();
  } finally {
    client.close();
    globalThis.fetch = originalFetch;
  }
});

test("terminal authentication failure does not reconnect", async () => {
  let ticketRequests = 0;
  const client = new MangoRealtimeClient("https://api.example.test", "company-1", {
    getTicket: async () => {
      ticketRequests += 1;
      throw new TerminalAuthFailureError("http_401");
    },
    reconnectDelayMs: 1,
  });
  const unsubscribe = client.subscribe("process:gate-1");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(ticketRequests, 1);
  unsubscribe();
  client.close();
});

test("canonical refresh coalescing allows one in flight and one final queued refresh", async () => {
  const resolvers: Array<() => void> = [];
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const refresh = createCoalescedCanonicalRefresh(() => {
    calls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<void>((resolve) => {
      resolvers.push(() => {
        inFlight -= 1;
        resolve();
      });
    });
  });

  refresh.request();
  refresh.request();
  refresh.request();
  assert.equal(calls, 1, "bursts during an active refresh do not start parallel requests");
  assert.equal(maxInFlight, 1);
  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, "the burst produces one final canonical refresh");
  assert.equal(maxInFlight, 1);
  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);

  let disposedCalls = 0;
  let resolveDisposed: (() => void) | undefined;
  const disposedRefresh = createCoalescedCanonicalRefresh(() => {
    disposedCalls += 1;
    return new Promise<void>((resolve) => { resolveDisposed = resolve; });
  });
  disposedRefresh.request();
  disposedRefresh.request();
  disposedRefresh.dispose();
  resolveDisposed?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(disposedCalls, 1, "dispose drops a queued final refresh");
  refresh.dispose();
});

test("frontend source inventory contains only retained narrow scope families", () => {
  const sourceRoot = resolve(process.cwd(), "frontend/src");
  const sourceFiles = listSourceFiles(sourceRoot);
  const combined = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const forbidden of [
    "workspace:user:",
    "company_explorer:user:",
    "node_graph:user:",
    "logic_gate_graph:user:",
    "gvic_matrix:user:",
    "project_management:user:",
    "communications:user:",
    "mailbox:personal:user:",
    "projection.delta",
    "workspace.event",
    "communications.event",
    "snapshot.refetch",
    "permission.revoked",
  ]) {
    assert.equal(combined.includes(forbidden), false, `forbidden realtime source remains: ${forbidden}`);
  }
  assert.equal(existsSync(resolve(sourceRoot, "modules/workspace/workspaceRealtime.ts")), false);
  assert.equal(existsSync(resolve(sourceRoot, "modules/communications/communicationsStream.ts")), false);
  assert.equal(existsSync(resolve(sourceRoot, "modules/editor/editorTextboxSync.ts")), false);
  assert.equal(existsSync(resolve(sourceRoot, "modules/editor/editorProjectionDeltas.ts")), false);
  assert.equal(existsSync(resolve(sourceRoot, "modules/kanban/kanbanProjectionDeltas.ts")), false);

  const subscriptionSources = sourceFiles
    .filter((file) => !file.endsWith("realtimeWebSocket.ts"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("subscribeRealtimeScope("));
  assert.deepEqual(subscriptionSources.map(({ file }) => file.split("\\").join("/").split("/frontend/src/")[1]).sort(), [
    "app/AppSidebarChrome.tsx",
    "app/NotificationRealtimeBridge.tsx",
		"modules/editor/EditorContent.tsx",
		"modules/editor/LogicGateTiptapEditorSurface.tsx",
		"modules/editor/NodeWorkspaceSurfaceParts.tsx",
    "modules/editor/tiptap/MangoTiptapEditor.tsx",
    "modules/huddles/HuddleResourceSurface.tsx",
    "modules/kanban/KanbanContent.tsx",
    "modules/logic-gates/qdRatingsApi.ts",
    "modules/process-map/ProcessMapSurface.tsx",
    "pages/home/EmailCollaborationChatSurface.tsx",
    "pages/home/EmailReferencePreviewHost.tsx",
    "pages/home/HomePage.tsx",
    "pages/process-map/ProcessMapSavedProcess.tsx",
  ]);
});

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
}
