import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { TerminalAuthFailureError } from "../../../../frontend/src/modules/api/requestJSON.js";
import {
  computeRealtimeReconnectDelayMs,
  isSupportedRealtimeScope,
  MangoRealtimeClient,
  parseRealtimeMessage,
  realtimePersonalMailboxScope,
  realtimeSharedMailboxScope,
  realtimeWebSocketURL,
  type RealtimeChatMessageCreatedMessage,
  type RealtimeChatMessageDeletedMessage,
  type RealtimeKanbanChangedMessage,
  type RealtimeMailboxFolderChangedMessage,
  type RealtimeMailboxMessageChangedMessage,
  type RealtimeNotificationCreatedMessage,
} from "../../../../frontend/src/modules/realtime/realtimeWebSocket.js";

test("parses retained product and scoped mailbox message families", () => {
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
    type: "kanban.changed",
    company_id: "company-1",
    scope: "board:logic-gate:gate-1",
    board_id: "logic-gate:gate-1",
    change_type: "card.moved",
  })) as RealtimeKanbanChangedMessage;
  assert.equal(board.board_id, "logic-gate:gate-1");
  assert.equal(board.change_type, "card.moved");

  const mailboxMessage = parseRealtimeMessage(JSON.stringify({
    type: "mailbox.message.changed",
    company_id: "company-1",
    scope: "mailbox:personal:user:user-1",
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

test("rejects deleted broad protocol messages", () => {
  for (const type of ["projection.delta", "workspace.event", "communications.event", "snapshot.refetch", "permission.revoked"]) {
    assert.throws(() => parseRealtimeMessage(JSON.stringify({ type, company_id: "company-1", scope: "board:A" })), /unknown_realtime_message_type/);
  }
});

test("allows only narrow notification, mailbox, node-chat, and board scope families", () => {
  assert.equal(isSupportedRealtimeScope("notifications:user:user-1"), true);
  assert.equal(isSupportedRealtimeScope("chat:node:node-1"), true);
  assert.equal(isSupportedRealtimeScope("board:logic-gate:gate-1"), true);
  assert.equal(isSupportedRealtimeScope("mailbox:personal:user:user-1"), true);
  assert.equal(isSupportedRealtimeScope("mailbox:shared:shared-1"), true);
  assert.equal(realtimePersonalMailboxScope(" user-1 "), "mailbox:personal:user:user-1");
  assert.equal(realtimeSharedMailboxScope(" shared-1 "), "mailbox:shared:shared-1");
  assert.equal(isSupportedRealtimeScope("workspace:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("communications:user:user-1"), false);
  assert.equal(isSupportedRealtimeScope("editor:node:node-1"), false);
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
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
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
    let chat = 0;
    let board = 0;
    let mailbox = 0;
    const unsubNotifications = client.subscribe("notifications:user:user-1", { onNotificationCreated: () => { notifications += 1; } });
    const unsubChat = client.subscribe("chat:node:node-1", { onChatMessageCreated: () => { chat += 1; } });
    const unsubBoard = client.subscribe("board:logic-gate:gate-1", { onKanbanChanged: () => { board += 1; } });
    const unsubMailbox = client.subscribe("mailbox:personal:user:user-1", { onMailboxMessageChanged: () => { mailbox += 1; } });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    assert.equal(sockets.length, 1);
    const subscriptions = sockets[0].sent.map((raw) => JSON.parse(raw) as { type: string; scope?: string }).filter((message) => message.type === "subscribe");
    assert.deepEqual(subscriptions.map((message) => message.scope).sort(), ["board:logic-gate:gate-1", "chat:node:node-1", "mailbox:personal:user:user-1", "notifications:user:user-1"]);

    sockets[0].onmessage?.({ data: JSON.stringify({
      type: "notification.created",
      company_id: "company-1",
      scope: "notifications:user:user-1",
      notification: { notification_id: "n-1", recipient_user_id: "user-1", type: "update", source_event_id: "e-1", entity_type: "node", entity_id: "node-1", title: "Update", created_timestamp: "2026-07-12T12:00:00Z" },
    }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "chat.message.created", company_id: "company-1", scope: "chat:node:node-1", node_id: "node-1", block_id: "block-1", message_id: "m-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "kanban.changed", company_id: "company-1", scope: "board:logic-gate:gate-1", board_id: "logic-gate:gate-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "mailbox.message.changed", company_id: "company-1", scope: "mailbox:personal:user:user-1", trigger: "message.created", message_id: "mail-1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "chat.message.created", company_id: "company-1", scope: "chat:node:other", node_id: "other", block_id: "block-1", message_id: "m-2" }) });

    assert.equal(notifications, 1);
    assert.equal(chat, 1);
    assert.equal(board, 1);
    assert.equal(mailbox, 1);
    unsubNotifications();
    unsubChat();
    unsubBoard();
    unsubMailbox();
    client.close();
  } finally {
    globalThis.WebSocket = originalWebSocket;
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
  const unsubscribe = client.subscribe("board:logic-gate:gate-1");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(ticketRequests, 1);
  unsubscribe();
  client.close();
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
    "editor:node:",
    "editor:logic_gate:",
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
  assert.equal(existsSync(resolve(sourceRoot, "modules/editor/editorCollaboration.ts")), false);
  assert.equal(existsSync(resolve(sourceRoot, "modules/editor/editorProjectionDeltas.ts")), false);
  assert.equal(existsSync(resolve(sourceRoot, "modules/kanban/kanbanProjectionDeltas.ts")), false);

  const subscriptionSources = sourceFiles
    .filter((file) => !file.endsWith("realtimeWebSocket.ts"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("subscribeRealtimeScope("));
  assert.equal(subscriptionSources.length, 4);
  assert.deepEqual(subscriptionSources.map(({ file }) => file.split("\\").join("/").split("/frontend/src/")[1]).sort(), [
    "app/AppLiveFreshnessBridge.tsx",
    "modules/editor/EditorContent.tsx",
    "modules/kanban/KanbanContent.tsx",
    "pages/home/HomePage.tsx",
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
