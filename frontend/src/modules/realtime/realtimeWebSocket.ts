import {
  addAuthTerminalFailureListener,
  getApiAccessToken,
  isTerminalAuthFailureActive,
} from "../../auth/cognitoAuth.js";
import { isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";
import type { NotificationItem } from "../notifications/notificationsApi.js";
import {
  realtimeHealthKey,
  setRealtimeHealthClientActive,
  subscribeRealtimeHealthState,
  updateRealtimeHealth,
  type RealtimeHealthSnapshot,
} from "./realtimeHealth.js";

type RealtimeMessageType =
  | "ready"
  | "subscription.accepted"
  | "subscription.rejected"
  | "notification.created"
  | "notification.deleted"
  | "notifications.cleared"
  | "chat.message.created"
  | "chat.message.deleted"
  | "kanban.changed"
  | "mailbox.message.changed"
  | "mailbox.folder.changed"
  | "editor.delta.committed"
  | "editor.snapshot.required"
  | "editor.document.deleted"
  | "heartbeat.challenge"
  | "heartbeat.confirmed"
  | "ping"
  | "pong"
  | "error";

type RealtimeBaseMessage = {
  type: RealtimeMessageType;
  company_id?: string;
  scope?: string;
};

type RealtimeReadyMessage = RealtimeBaseMessage & {
  type: "ready";
  user_id?: string;
  connection_id?: string;
};

export type RealtimeSubscriptionAcceptedMessage = RealtimeBaseMessage & {
  type: "subscription.accepted";
  scope: string;
};

export type RealtimeSubscriptionRejectedMessage = RealtimeBaseMessage & {
  type: "subscription.rejected";
  scope: string;
  error?: string;
  message?: string;
};

export type RealtimeNotificationCreatedMessage = RealtimeBaseMessage & {
  type: "notification.created";
  company_id: string;
  scope: string;
  notification: NotificationItem;
  ts?: string;
};

export type RealtimeNotificationDeletedMessage = RealtimeBaseMessage & {
  type: "notification.deleted";
  company_id: string;
  scope: string;
  notification_id: string;
  ts?: string;
};

export type RealtimeNotificationsClearedMessage = RealtimeBaseMessage & {
  type: "notifications.cleared";
  company_id: string;
  scope: string;
  deleted_count: number;
  ts?: string;
};

export type RealtimeChatMessageCreatedMessage = RealtimeBaseMessage & {
  type: "chat.message.created";
  company_id: string;
  scope: string;
  node_id: string;
  block_id: string;
  message_id: string;
  ts?: string;
};

export type RealtimeChatMessageDeletedMessage = RealtimeBaseMessage & {
  type: "chat.message.deleted";
  company_id: string;
  scope: string;
  node_id: string;
  block_id?: string;
  message_id: string;
  ts?: string;
};

export type RealtimeKanbanChangedMessage = RealtimeBaseMessage & {
  type: "kanban.changed";
  company_id: string;
  scope: string;
  board_id: string;
  change_type?: string;
  ts?: string;
};

export type RealtimeMailboxMessageChangedMessage = RealtimeBaseMessage & {
  type: "mailbox.message.changed";
  company_id: string;
  scope: string;
  trigger: string;
  message_id?: string;
  thread_id?: string;
  shared_inbox_id?: string;
  occurred_at?: string;
  ts?: string;
};

export type RealtimeMailboxFolderChangedMessage = RealtimeBaseMessage & {
  type: "mailbox.folder.changed";
  company_id: string;
  scope: string;
  trigger: string;
  shared_inbox_id?: string;
  occurred_at?: string;
  ts?: string;
};

export type RealtimeErrorMessage = RealtimeBaseMessage & {
  type: "error";
  error?: string;
  message?: string;
};

export type RealtimeEditorHTMLPatch = {
  start_utf8: number;
  delete_utf8: number;
  insert: string;
};

export type RealtimeEditorPatchCommittedMessage = RealtimeBaseMessage & {
  type: "editor.delta.committed";
  company_id: string;
  scope: string;
  event_id: string;
  resource_type: "node" | "logic_gate" | "project";
  resource_id: string;
  document_id: string;
  resource_revision: number;
  operation_id: string;
  client_id: string;
  committed_at?: string;
  patch: RealtimeEditorHTMLPatch;
};

export type RealtimeEditorSnapshotRequiredMessage = RealtimeBaseMessage & {
  type: "editor.snapshot.required";
  company_id: string;
  scope: string;
  event_id: string;
  resource_type: "node" | "logic_gate" | "project";
  resource_id: string;
  document_id: string;
  resource_revision: number;
  operation_id: string;
  client_id: string;
  committed_at?: string;
  reason?: string;
};

export type RealtimeEditorDocumentDeletedMessage = RealtimeBaseMessage & {
  type: "editor.document.deleted";
  company_id: string;
  scope: string;
  event_id: string;
  resource_type: "node" | "logic_gate" | "project";
  resource_id: string;
  document_id: string;
  resource_revision: number;
  operation_id: string;
  client_id: string;
  committed_at?: string;
};

type RealtimeHeartbeatMessage = RealtimeBaseMessage & {
  type: "heartbeat.challenge" | "heartbeat.confirmed";
  nonce: string;
  server_time?: string;
};


type RealtimeInboundMessage =
  | RealtimeReadyMessage
  | RealtimeSubscriptionAcceptedMessage
  | RealtimeSubscriptionRejectedMessage
  | RealtimeNotificationCreatedMessage
  | RealtimeNotificationDeletedMessage
  | RealtimeNotificationsClearedMessage
  | RealtimeChatMessageCreatedMessage
  | RealtimeChatMessageDeletedMessage
  | RealtimeKanbanChangedMessage
  | RealtimeMailboxMessageChangedMessage
  | RealtimeMailboxFolderChangedMessage
  | RealtimeEditorPatchCommittedMessage
  | RealtimeEditorSnapshotRequiredMessage
  | RealtimeEditorDocumentDeletedMessage
  | RealtimeHeartbeatMessage
  | RealtimeErrorMessage
  | (RealtimeBaseMessage & { type: "ping" | "pong" });

export type RealtimeSubscriptionHandlers = {
  onAccepted?: (message: RealtimeSubscriptionAcceptedMessage) => void;
  onRejected?: (message: RealtimeSubscriptionRejectedMessage) => void;
  onNotificationCreated?: (message: RealtimeNotificationCreatedMessage) => void;
  onNotificationDeleted?: (message: RealtimeNotificationDeletedMessage) => void;
  onNotificationsCleared?: (message: RealtimeNotificationsClearedMessage) => void;
  onChatMessageCreated?: (message: RealtimeChatMessageCreatedMessage) => void;
  onChatMessageDeleted?: (message: RealtimeChatMessageDeletedMessage) => void;
  onKanbanChanged?: (message: RealtimeKanbanChangedMessage) => void;
  onMailboxMessageChanged?: (message: RealtimeMailboxMessageChangedMessage) => void;
  onMailboxFolderChanged?: (message: RealtimeMailboxFolderChangedMessage) => void;
  onEditorPatchCommitted?: (message: RealtimeEditorPatchCommittedMessage) => void;
  onEditorSnapshotRequired?: (message: RealtimeEditorSnapshotRequiredMessage) => void;
  onEditorDocumentDeleted?: (message: RealtimeEditorDocumentDeletedMessage) => void;
  onRecover?: () => void | Promise<void>;
  onError?: (message: RealtimeErrorMessage) => void;
};

type RealtimeClientOptions = {
  getAccessToken?: () => Promise<string>;
  getTicket?: () => Promise<void>;
  WebSocketCtor?: typeof WebSocket;
  reconnectDelayMs?: number;
  heartbeatGraceMs?: number;
  attemptingAfterMs?: number;
  disconnectedAfterMs?: number;
};

type RealtimeTicketResponse = {
  expires_at?: string;
};

const realtimeClients = new Map<string, MangoRealtimeClient>();
let terminalAuthFailureRealtimeUnsubscribe: (() => void) | null = null;

export function computeRealtimeReconnectDelayMs(
  attemptIndex: number,
  options: { baseDelayMs?: number; maxDelayMs?: number; random?: () => number } = {},
): number {
  const baseDelayMs = Math.max(250, Math.round(options.baseDelayMs ?? 1_000));
  const maxDelayMs = Math.max(baseDelayMs, Math.round(options.maxDelayMs ?? 60_000));
  const random = options.random ?? Math.random;
  const safeAttempt = Math.max(0, Math.min(16, Math.floor(attemptIndex)));
  const exponentialDelayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** safeAttempt));
  const minimumDelayMs = Math.min(exponentialDelayMs, Math.max(250, Math.round(exponentialDelayMs * 0.5)));
  const jitter = Math.max(0, Math.min(1, random()));
  return Math.min(maxDelayMs, Math.round(minimumDelayMs + jitter * (exponentialDelayMs - minimumDelayMs)));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function objectValue(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("realtime_message_must_be_object");
  return parsed as Record<string, unknown>;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function scopedMessageBase(payload: Record<string, unknown>, type: RealtimeMessageType): { type: RealtimeMessageType; company_id: string; scope: string } {
  const companyID = stringValue(payload.company_id);
  const scope = stringValue(payload.scope);
  if (!companyID) throw new Error("realtime_company_id_required");
  if (!scope) throw new Error("realtime_scope_required");
  return { type, company_id: companyID, scope };
}

export function parseRealtimeMessage(raw: string): RealtimeInboundMessage {
  const payload = objectValue(raw);
  const type = stringValue(payload.type) as RealtimeMessageType;
  if (!type) throw new Error("realtime_type_required");
  const base: RealtimeBaseMessage = {
    type,
    company_id: stringValue(payload.company_id) || undefined,
    scope: stringValue(payload.scope) || undefined,
  };

  switch (type) {
    case "ready":
      return { ...base, type, user_id: stringValue(payload.user_id) || undefined, connection_id: stringValue(payload.connection_id) || undefined };
    case "subscription.accepted": {
      const scope = stringValue(payload.scope);
      if (!scope) throw new Error("realtime_scope_required");
      return { ...base, type, scope };
    }
    case "subscription.rejected": {
      const scope = stringValue(payload.scope);
      if (!scope) throw new Error("realtime_scope_required");
      return { ...base, type, scope, error: stringValue(payload.error) || undefined, message: stringValue(payload.message) || undefined };
    }
    case "notification.created": {
      const scoped = scopedMessageBase(payload, type);
      const notification = recordValue(payload.notification);
      if (!notification || !stringValue(notification.notification_id)) throw new Error("realtime_notification_required");
      return { ...scoped, type, notification: notification as unknown as NotificationItem, ts: stringValue(payload.ts) || undefined };
    }
    case "notification.deleted": {
      const scoped = scopedMessageBase(payload, type);
      const notificationID = stringValue(payload.notification_id);
      if (!notificationID) throw new Error("realtime_notification_id_required");
      return { ...scoped, type, notification_id: notificationID, ts: stringValue(payload.ts) || undefined };
    }
    case "notifications.cleared": {
      const scoped = scopedMessageBase(payload, type);
      return { ...scoped, type, deleted_count: optionalNumber(payload.deleted_count) ?? 0, ts: stringValue(payload.ts) || undefined };
    }
    case "chat.message.created": {
      const scoped = scopedMessageBase(payload, type);
      const nodeID = stringValue(payload.node_id);
      const blockID = stringValue(payload.block_id);
      const messageID = stringValue(payload.message_id);
      if (!nodeID || !blockID || !messageID) throw new Error("realtime_chat_message_required");
      return { ...scoped, type, node_id: nodeID, block_id: blockID, message_id: messageID, ts: stringValue(payload.ts) || undefined };
    }
    case "chat.message.deleted": {
      const scoped = scopedMessageBase(payload, type);
      const nodeID = stringValue(payload.node_id);
      const messageID = stringValue(payload.message_id);
      if (!nodeID || !messageID) throw new Error("realtime_chat_message_required");
      return { ...scoped, type, node_id: nodeID, block_id: stringValue(payload.block_id) || undefined, message_id: messageID, ts: stringValue(payload.ts) || undefined };
    }
    case "kanban.changed": {
      const scoped = scopedMessageBase(payload, type);
      const boardID = stringValue(payload.board_id);
      if (!boardID) throw new Error("realtime_board_id_required");
      return { ...scoped, type, board_id: boardID, change_type: stringValue(payload.change_type) || undefined, ts: stringValue(payload.ts) || undefined };
    }
    case "mailbox.message.changed": {
      const scoped = scopedMessageBase(payload, type);
      const trigger = stringValue(payload.trigger);
      if (!trigger) throw new Error("realtime_mailbox_trigger_required");
      return {
        ...scoped,
        type,
        trigger,
        message_id: stringValue(payload.message_id) || undefined,
        thread_id: stringValue(payload.thread_id) || undefined,
        shared_inbox_id: stringValue(payload.shared_inbox_id) || undefined,
        occurred_at: stringValue(payload.occurred_at) || undefined,
        ts: stringValue(payload.ts) || undefined,
      };
    }
    case "mailbox.folder.changed": {
      const scoped = scopedMessageBase(payload, type);
      const trigger = stringValue(payload.trigger);
      if (!trigger) throw new Error("realtime_mailbox_trigger_required");
      return {
        ...scoped,
        type,
        trigger,
        shared_inbox_id: stringValue(payload.shared_inbox_id) || undefined,
        occurred_at: stringValue(payload.occurred_at) || undefined,
        ts: stringValue(payload.ts) || undefined,
      };
    }
    case "editor.delta.committed":
    case "editor.snapshot.required":
    case "editor.document.deleted": {
      const scoped = scopedMessageBase(payload, type);
      const eventID = stringValue(payload.event_id);
      const resourceType = stringValue(payload.resource_type) as "node" | "logic_gate" | "project";
      const resourceID = stringValue(payload.resource_id);
      const documentID = stringValue(payload.document_id);
      const operationID = stringValue(payload.operation_id);
      const clientID = stringValue(payload.client_id);
      const resourceRevision = optionalNumber(payload.resource_revision);
      if (!eventID || !["node", "logic_gate", "project"].includes(resourceType) || !resourceID || !documentID || !operationID || !clientID || resourceRevision === undefined) {
        throw new Error("realtime_editor_event_required");
      }
      const common = {
        ...scoped, type, event_id: eventID, resource_type: resourceType, resource_id: resourceID,
        document_id: documentID, resource_revision: resourceRevision, operation_id: operationID,
        client_id: clientID, committed_at: stringValue(payload.committed_at) || undefined,
      };
      if (type === "editor.document.deleted") return common as RealtimeEditorDocumentDeletedMessage;
      if (type === "editor.snapshot.required") return { ...common, reason: stringValue(payload.reason) || undefined } as RealtimeEditorSnapshotRequiredMessage;
      const patch = recordValue(payload.patch);
      if (!patch) throw new Error("realtime_editor_patch_required");
      return { ...common, patch: patch as RealtimeEditorHTMLPatch } as RealtimeEditorPatchCommittedMessage;
    }
    case "heartbeat.challenge":
    case "heartbeat.confirmed": {
      const nonce = stringValue(payload.nonce);
      if (!nonce) throw new Error("realtime_heartbeat_nonce_required");
      return { ...base, type, nonce, server_time: stringValue(payload.server_time) || undefined };
    }
    case "error":
      return { ...base, type, error: stringValue(payload.error) || undefined, message: stringValue(payload.message) || undefined };
    case "ping":
    case "pong":
      return { ...base, type };
    default:
      throw new Error("unknown_realtime_message_type");
  }
}

export function isSupportedRealtimeScope(scope: string): boolean {
  return /^(?:notifications:user:[^:]+|chat:node:[^:]+|board:.+|mailbox:personal:account:[^:]+:[^:@\s]+@[^:@\s]+|mailbox:shared:[^:]+|editor:(?:node|logic_gate|project):[^:]+:[^:]+)$/.test(scope.trim());
}

export function realtimePersonalMailboxScope(userID: string, accountEmail: string): string {
  const cleanUserID = userID.trim();
  const cleanAccountEmail = accountEmail.trim().toLowerCase();
  if (!cleanUserID || cleanUserID.includes(":") || !/^[^:@\s]+@[^:@\s]+$/.test(cleanAccountEmail)) return "";
  return `mailbox:personal:account:${cleanUserID}:${cleanAccountEmail}`;
}

export function realtimeSharedMailboxScope(sharedInboxID: string): string {
  const cleanSharedInboxID = sharedInboxID.trim();
  return cleanSharedInboxID ? `mailbox:shared:${cleanSharedInboxID}` : "";
}

export function realtimeEditorScope(resourceType: "node" | "logic_gate" | "project", resourceID: string, documentID: string): string {
  const cleanResourceID = resourceID.trim();
  const cleanDocumentID = documentID.trim();
  if (!cleanResourceID || cleanResourceID.includes(":") || !cleanDocumentID || cleanDocumentID.includes(":")) return "";
  return `editor:${resourceType}:${cleanResourceID}:${cleanDocumentID}`;
}

export function realtimeWebSocketURL(apiBase: string, companyID: string): string {
  const url = new URL("/v1/realtime/ws", apiBase || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("company_id", companyID);
  return url.toString();
}

async function requestRealtimeWebSocketTicket(apiBase: string, companyID: string, getAccessToken: () => Promise<string> = getApiAccessToken): Promise<void> {
  await requestJSON<RealtimeTicketResponse>(apiBase, "/v1/realtime/ticket", {
    method: "POST",
    credentials: "include",
    json: { company_id: companyID },
    getAccessToken,
    allowDuringRealtimeDegraded: true,
  });
}

export class MangoRealtimeClient {
  private readonly apiBase: string;
  private readonly companyID: string;
  private readonly healthKey: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly getTicket: () => Promise<void>;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly reconnectDelayMs: number;
  private readonly heartbeatGraceMs: number;
  private readonly attemptingAfterMs: number;
  private readonly disconnectedAfterMs: number;
  private readonly subscriptions = new Map<string, Set<RealtimeSubscriptionHandlers>>();
  private readonly acceptedScopes = new Set<string>();
  private socket: WebSocket | null = null;
  private opening = false;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatWatchdog: ReturnType<typeof setInterval> | undefined;
  private attemptingTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectedTimer: ReturnType<typeof setTimeout> | undefined;
  private openAttemptID = 0;
  private recoveredAttemptID = 0;
  private reconnectAttempts = 0;
  private healthRefCount = 0;
  private serverReady = false;
  private heartbeatConfirmed = false;
  private lastHeartbeatConfirmedAt: number | undefined;
  private outageStartedAt: number | undefined;
  private recoveryPromise: Promise<void> | undefined;

  constructor(apiBase: string, companyID: string, options: RealtimeClientOptions = {}) {
    ensureTerminalAuthFailureRealtimeListener();
    this.apiBase = apiBase;
    this.companyID = companyID;
    this.healthKey = realtimeHealthKey(apiBase, companyID);
    this.getAccessToken = options.getAccessToken ?? getApiAccessToken;
    this.getTicket = options.getTicket ?? (() => requestRealtimeWebSocketTicket(this.apiBase, this.companyID, this.getAccessToken));
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.heartbeatGraceMs = Math.max(1_000, options.heartbeatGraceMs ?? 35_000);
    this.attemptingAfterMs = Math.max(0, options.attemptingAfterMs ?? 10_000);
    this.disconnectedAfterMs = Math.max(this.attemptingAfterMs, options.disconnectedAfterMs ?? 60_000);
  }

  subscribe(scope: string, handlers: RealtimeSubscriptionHandlers = {}): () => void {
    const cleanScope = scope.trim();
    if (!isSupportedRealtimeScope(cleanScope)) throw new Error("unsupported_realtime_scope");
    const subscription: RealtimeSubscriptionHandlers = { ...handlers };
    const bucket = this.subscriptions.get(cleanScope) ?? new Set<RealtimeSubscriptionHandlers>();
    const firstForScope = bucket.size === 0;
    bucket.add(subscription);
    this.subscriptions.set(cleanScope, bucket);
    this.activate();
    if (this.acceptedScopes.has(cleanScope)) {
      subscription.onAccepted?.({ type: "subscription.accepted", scope: cleanScope });
    }
    if (firstForScope && this.socket?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(cleanScope);
    }
    this.maybeFinishRecovery();
    return () => {
      const current = this.subscriptions.get(cleanScope);
      current?.delete(subscription);
      if (current && current.size > 0) return;
      this.subscriptions.delete(cleanScope);
      this.acceptedScopes.delete(cleanScope);
      if (!this.hasConsumers()) {
        this.close();
        return;
      }
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "unsubscribe", scope: cleanScope }));
      this.maybeFinishRecovery();
    };
  }

  subscribeHealth(listener: (snapshot: RealtimeHealthSnapshot) => void): () => void {
    this.healthRefCount += 1;
    this.activate();
    const unsubscribeState = subscribeRealtimeHealthState(this.healthKey, listener);
    return () => {
      unsubscribeState();
      this.healthRefCount = Math.max(0, this.healthRefCount - 1);
      if (!this.hasConsumers()) this.close();
    };
  }

  ensureOpen(): void {
    if (!this.hasConsumers() || isTerminalAuthFailureActive()) return;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING || this.opening) return;
    this.manualClose = false;
    this.opening = true;
    this.serverReady = false;
    this.heartbeatConfirmed = false;
    this.recoveredAttemptID = 0;
    this.acceptedScopes.clear();
    this.markOutage();
    const attemptID = this.openAttemptID + 1;
    this.openAttemptID = attemptID;
    void this.getTicket()
      .then(() => {
        if (this.manualClose || attemptID !== this.openAttemptID || !this.hasConsumers()) return;
        const socket = new this.WebSocketCtor(realtimeWebSocketURL(this.apiBase, this.companyID));
        this.socket = socket;
        socket.onopen = () => {
          if (this.socket !== socket || attemptID !== this.openAttemptID) {
            socket.close();
            return;
          }
          this.opening = false;
          this.startHeartbeatWatchdog(socket);
          for (const scope of this.subscriptions.keys()) this.sendSubscribe(scope);
        };
        socket.onmessage = (event) => {
          if (this.socket === socket) this.handleMessage(typeof event.data === "string" ? event.data : "");
        };
        socket.onerror = () => {
          if (this.socket === socket) {
            this.dispatchError({ type: "error", error: "websocket_error" });
            this.markOutage();
          }
        };
        socket.onclose = () => {
          if (this.socket !== socket) return;
          this.socket = null;
          this.opening = false;
          this.serverReady = false;
          this.heartbeatConfirmed = false;
          this.recoveredAttemptID = 0;
          this.acceptedScopes.clear();
          this.stopHeartbeatWatchdog();
          if (!this.manualClose && this.hasConsumers()) {
            this.markOutage();
            this.scheduleReconnect();
          }
        };
      })
      .catch((cause) => {
        if (attemptID !== this.openAttemptID) return;
        this.opening = false;
        if (isTerminalAuthFailureError(cause) || isTerminalAuthFailureActive()) {
          this.stopForTerminalAuthFailure();
          return;
        }
        this.dispatchError({ type: "error", error: "websocket_auth_failed" });
        this.markOutage();
        this.scheduleReconnect();
      });
  }

  close(): void {
    this.manualClose = true;
    this.openAttemptID += 1;
    this.clearReconnectTimer();
    this.clearOutageTimers();
    this.stopHeartbeatWatchdog();
    this.socket?.close();
    this.socket = null;
    this.opening = false;
    this.serverReady = false;
    this.heartbeatConfirmed = false;
    this.acceptedScopes.clear();
    setRealtimeHealthClientActive(this.healthKey, false);
  }

  private activate(): void {
    setRealtimeHealthClientActive(this.healthKey, true);
    if (!this.lastHeartbeatConfirmedAt) this.setHealth("reconnecting");
    this.ensureOpen();
  }

  private hasConsumers(): boolean {
    return this.healthRefCount > 0 || this.subscriptions.size > 0;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.manualClose || !this.hasConsumers() || isTerminalAuthFailureActive()) return;
    const delayMs = computeRealtimeReconnectDelayMs(this.reconnectAttempts, { baseDelayMs: this.reconnectDelayMs });
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureOpen();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  stopForTerminalAuthFailure(): void {
    this.manualClose = true;
    this.openAttemptID += 1;
    this.clearReconnectTimer();
    this.clearOutageTimers();
    this.stopHeartbeatWatchdog();
    this.socket?.close();
    this.socket = null;
    this.opening = false;
    this.serverReady = false;
    this.heartbeatConfirmed = false;
    this.acceptedScopes.clear();
    this.reconnectAttempts = 0;
    this.setHealth("disconnected");
    setRealtimeHealthClientActive(this.healthKey, false);
  }

  private sendSubscribe(scope: string): void {
    this.socket?.send(JSON.stringify({ type: "subscribe", scope }));
  }

  private handleMessage(raw: string): void {
    if (!raw) return;
    let message: RealtimeInboundMessage;
    try {
      message = parseRealtimeMessage(raw);
    } catch {
      this.dispatchError({ type: "error", error: "invalid_realtime_message" });
      return;
    }
    if (message.type === "ping") {
      this.socket?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (message.type === "heartbeat.challenge") {
      this.socket?.send(JSON.stringify({ type: "heartbeat.response", nonce: message.nonce }));
      return;
    }
    if (message.type === "heartbeat.confirmed") {
      this.heartbeatConfirmed = true;
      this.lastHeartbeatConfirmedAt = Date.now();
      this.maybeFinishRecovery();
      return;
    }
    if (message.type === "ready") {
      this.serverReady = true;
      this.maybeFinishRecovery();
      return;
    }
    if (message.type === "error") {
      this.dispatchError(message);
      return;
    }
    const bucket = message.scope ? this.subscriptions.get(message.scope) : undefined;
    if (!bucket || bucket.size === 0) return;
    if (message.type === "subscription.accepted") {
      this.acceptedScopes.add(message.scope);
    } else if (message.type === "subscription.rejected") {
      this.acceptedScopes.delete(message.scope);
    }
    for (const sub of bucket) {
      switch (message.type) {
        case "subscription.accepted":
          sub.onAccepted?.(message);
          break;
        case "subscription.rejected":
          sub.onRejected?.(message);
          break;
        case "notification.created":
          sub.onNotificationCreated?.(message);
          break;
        case "notification.deleted":
          sub.onNotificationDeleted?.(message);
          break;
        case "notifications.cleared":
          sub.onNotificationsCleared?.(message);
          break;
        case "chat.message.created":
          sub.onChatMessageCreated?.(message);
          break;
        case "chat.message.deleted":
          sub.onChatMessageDeleted?.(message);
          break;
        case "kanban.changed":
          sub.onKanbanChanged?.(message);
          break;
        case "mailbox.message.changed":
          sub.onMailboxMessageChanged?.(message);
          break;
        case "mailbox.folder.changed":
          sub.onMailboxFolderChanged?.(message);
          break;
        case "editor.delta.committed":
          sub.onEditorPatchCommitted?.(message);
          break;
        case "editor.snapshot.required":
          sub.onEditorSnapshotRequired?.(message);
          break;
        case "editor.document.deleted":
          sub.onEditorDocumentDeleted?.(message);
          break;
      }
    }
    if (message.type === "subscription.accepted" || message.type === "subscription.rejected") this.maybeFinishRecovery();
  }

  private maybeFinishRecovery(): void {
    if (!this.serverReady || !this.heartbeatConfirmed || this.recoveryPromise) return;
    for (const scope of this.subscriptions.keys()) {
      if (!this.acceptedScopes.has(scope)) return;
    }
    if (this.recoveredAttemptID === this.openAttemptID) {
      this.setHealth("connected", this.lastHeartbeatConfirmedAt);
      return;
    }
    const attemptID = this.openAttemptID;
    const recoveries: Array<Promise<void>> = [];
    for (const bucket of this.subscriptions.values()) {
      for (const subscription of bucket) {
        if (!subscription.onRecover) continue;
        recoveries.push(Promise.resolve().then(() => subscription.onRecover?.()));
      }
    }
    this.recoveryPromise = Promise.all(recoveries).then(() => undefined);
    void this.recoveryPromise
      .then(() => {
        if (attemptID !== this.openAttemptID || !this.serverReady || !this.heartbeatConfirmed) return;
        for (const scope of this.subscriptions.keys()) {
          if (!this.acceptedScopes.has(scope)) return;
        }
        this.recoveredAttemptID = attemptID;
        this.reconnectAttempts = 0;
        this.outageStartedAt = undefined;
        this.clearOutageTimers();
        this.setHealth("connected", this.lastHeartbeatConfirmedAt);
      })
      .catch(() => {
        if (attemptID !== this.openAttemptID) return;
        this.dispatchError({ type: "error", error: "realtime_recovery_failed" });
        this.markOutage();
        this.socket?.close();
      })
      .finally(() => {
        this.recoveryPromise = undefined;
      });
  }

  private startHeartbeatWatchdog(socket: WebSocket): void {
    this.stopHeartbeatWatchdog();
    this.heartbeatWatchdog = setInterval(() => {
      if (this.socket !== socket || !this.lastHeartbeatConfirmedAt) return;
      if (Date.now() - this.lastHeartbeatConfirmedAt <= this.heartbeatGraceMs) return;
      this.markOutage();
      socket.close();
    }, Math.min(1_000, Math.max(100, Math.round(this.heartbeatGraceMs / 5))));
  }

  private stopHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdog !== undefined) clearInterval(this.heartbeatWatchdog);
    this.heartbeatWatchdog = undefined;
  }

  private markOutage(): void {
    if (!this.hasConsumers()) return;
    if (this.outageStartedAt === undefined) this.outageStartedAt = Date.now();
    this.setHealth("reconnecting", this.lastHeartbeatConfirmedAt);
    if (this.attemptingTimer === undefined) {
      this.attemptingTimer = setTimeout(() => {
        this.attemptingTimer = undefined;
        if (this.outageStartedAt !== undefined) this.setHealth("attempting", this.lastHeartbeatConfirmedAt);
      }, this.attemptingAfterMs);
    }
    if (this.disconnectedTimer === undefined) {
      this.disconnectedTimer = setTimeout(() => {
        this.disconnectedTimer = undefined;
        if (this.outageStartedAt !== undefined) this.setHealth("disconnected", this.lastHeartbeatConfirmedAt);
      }, this.disconnectedAfterMs);
    }
  }

  private clearOutageTimers(): void {
    if (this.attemptingTimer !== undefined) clearTimeout(this.attemptingTimer);
    if (this.disconnectedTimer !== undefined) clearTimeout(this.disconnectedTimer);
    this.attemptingTimer = undefined;
    this.disconnectedTimer = undefined;
  }

  private setHealth(status: RealtimeHealthSnapshot["status"], lastConfirmedAt = this.lastHeartbeatConfirmedAt): void {
    updateRealtimeHealth(this.healthKey, { status, lastConfirmedAt });
  }

  private dispatchError(message: RealtimeErrorMessage): void {
    for (const bucket of this.subscriptions.values()) {
      for (const subscription of bucket) subscription.onError?.(message);
    }
  }
}
function ensureTerminalAuthFailureRealtimeListener(): void {
  if (terminalAuthFailureRealtimeUnsubscribe || typeof window === "undefined") return;
  terminalAuthFailureRealtimeUnsubscribe = addAuthTerminalFailureListener(() => {
    for (const client of realtimeClients.values()) client.stopForTerminalAuthFailure();
  });
}

function getMangoRealtimeClient(apiBase: string, companyID: string, options: RealtimeClientOptions = {}): MangoRealtimeClient {
  const key = realtimeHealthKey(apiBase, companyID);
  const existing = realtimeClients.get(key);
  if (existing) return existing;
  const client = new MangoRealtimeClient(apiBase, companyID, options);
  realtimeClients.set(key, client);
  return client;
}

export function subscribeRealtimeScope(apiBase: string, companyID: string, scope: string, handlers: RealtimeSubscriptionHandlers): () => void {
  if (!companyID.trim() || !scope.trim()) return () => undefined;
  return getMangoRealtimeClient(apiBase, companyID).subscribe(scope, handlers);
}
export function subscribeRealtimeHealth(
  apiBase: string,
  companyID: string,
  listener: (snapshot: RealtimeHealthSnapshot) => void,
): () => void {
  if (!companyID.trim()) return () => undefined;
  return getMangoRealtimeClient(apiBase, companyID).subscribeHealth(listener);
}
