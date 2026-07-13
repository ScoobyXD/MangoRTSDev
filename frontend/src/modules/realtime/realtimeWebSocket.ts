import {
  addAuthTerminalFailureListener,
  getApiAccessToken,
  isTerminalAuthFailureActive,
} from "../../auth/cognitoAuth.js";
import { isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";
import type { NotificationItem } from "../notifications/notificationsApi.js";

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

export type RealtimeErrorMessage = RealtimeBaseMessage & {
  type: "error";
  error?: string;
  message?: string;
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
  | RealtimeErrorMessage
  | (RealtimeBaseMessage & { type: "ping" | "pong" });

type RealtimeSubscriptionHandlers = {
  onAccepted?: (message: RealtimeSubscriptionAcceptedMessage) => void;
  onRejected?: (message: RealtimeSubscriptionRejectedMessage) => void;
  onNotificationCreated?: (message: RealtimeNotificationCreatedMessage) => void;
  onNotificationDeleted?: (message: RealtimeNotificationDeletedMessage) => void;
  onNotificationsCleared?: (message: RealtimeNotificationsClearedMessage) => void;
  onChatMessageCreated?: (message: RealtimeChatMessageCreatedMessage) => void;
  onChatMessageDeleted?: (message: RealtimeChatMessageDeletedMessage) => void;
  onKanbanChanged?: (message: RealtimeKanbanChangedMessage) => void;
  onError?: (message: RealtimeErrorMessage) => void;
};

type RealtimeClientOptions = {
  getAccessToken?: () => Promise<string>;
  getTicket?: () => Promise<void>;
  WebSocketCtor?: typeof WebSocket;
  reconnectDelayMs?: number;
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
  return /^(?:notifications:user:[^:]+|chat:node:[^:]+|board:.+)$/.test(scope.trim());
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
  });
}

export class MangoRealtimeClient {
  private readonly apiBase: string;
  private readonly companyID: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly getTicket: () => Promise<void>;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly reconnectDelayMs: number;
  private readonly subscriptions = new Map<string, Set<RealtimeSubscriptionHandlers>>();
  private readonly acceptedScopes = new Set<string>();
  private socket: WebSocket | null = null;
  private opening = false;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private openAttemptID = 0;
  private reconnectAttempts = 0;

  constructor(apiBase: string, companyID: string, options: RealtimeClientOptions = {}) {
    ensureTerminalAuthFailureRealtimeListener();
    this.apiBase = apiBase;
    this.companyID = companyID;
    this.getAccessToken = options.getAccessToken ?? getApiAccessToken;
    this.getTicket = options.getTicket ?? (() => requestRealtimeWebSocketTicket(this.apiBase, this.companyID, this.getAccessToken));
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  }

  subscribe(scope: string, handlers: RealtimeSubscriptionHandlers = {}): () => void {
    const cleanScope = scope.trim();
    if (!isSupportedRealtimeScope(cleanScope)) throw new Error("unsupported_realtime_scope");
    const subscription: RealtimeSubscriptionHandlers = { ...handlers };
    const bucket = this.subscriptions.get(cleanScope) ?? new Set<RealtimeSubscriptionHandlers>();
    const firstForScope = bucket.size === 0;
    bucket.add(subscription);
    this.subscriptions.set(cleanScope, bucket);
    this.ensureOpen();
    if (this.acceptedScopes.has(cleanScope)) {
      subscription.onAccepted?.({ type: "subscription.accepted", scope: cleanScope });
    }
    if (firstForScope && this.socket?.readyState === WebSocket.OPEN) this.sendSubscribe(cleanScope);
    return () => {
      const current = this.subscriptions.get(cleanScope);
      current?.delete(subscription);
      if (current && current.size > 0) return;
      this.subscriptions.delete(cleanScope);
      this.acceptedScopes.delete(cleanScope);
      if (this.subscriptions.size === 0) {
        this.close();
        return;
      }
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "unsubscribe", scope: cleanScope }));
    };
  }

  ensureOpen(): void {
    if (isTerminalAuthFailureActive()) return;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING || this.opening) return;
    this.manualClose = false;
    this.opening = true;
    this.acceptedScopes.clear();
    const attemptID = this.openAttemptID + 1;
    this.openAttemptID = attemptID;
    void this.getTicket()
      .then(() => {
        if (this.manualClose || attemptID !== this.openAttemptID) return;
        const socket = new this.WebSocketCtor(realtimeWebSocketURL(this.apiBase, this.companyID));
        this.socket = socket;
        socket.onopen = () => {
          if (this.socket !== socket || attemptID !== this.openAttemptID) {
            socket.close();
            return;
          }
          this.opening = false;
          this.reconnectAttempts = 0;
          for (const scope of this.subscriptions.keys()) this.sendSubscribe(scope);
        };
        socket.onmessage = (event) => {
          if (this.socket === socket) this.handleMessage(typeof event.data === "string" ? event.data : "");
        };
        socket.onerror = () => {
          if (this.socket === socket) this.dispatchError({ type: "error", error: "websocket_error" });
        };
        socket.onclose = () => {
          if (this.socket !== socket) return;
          this.socket = null;
          this.opening = false;
          this.acceptedScopes.clear();
          if (!this.manualClose && this.subscriptions.size > 0) this.scheduleReconnect();
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
        this.scheduleReconnect();
      });
  }

  close(): void {
    this.manualClose = true;
    this.openAttemptID += 1;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = null;
    this.opening = false;
    this.acceptedScopes.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.manualClose || this.subscriptions.size === 0 || isTerminalAuthFailureActive()) return;
    const delayMs = computeRealtimeReconnectDelayMs(this.reconnectAttempts, { baseDelayMs: this.reconnectDelayMs });
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureOpen();
    }, delayMs);
  }

  stopForTerminalAuthFailure(): void {
    this.manualClose = true;
    this.openAttemptID += 1;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = null;
    this.opening = false;
    this.acceptedScopes.clear();
    this.reconnectAttempts = 0;
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
    if (message.type === "ready") return;
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
      }
    }
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
  const key = `${apiBase}:${companyID}`;
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
