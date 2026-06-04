import { getApiAccessToken } from "../../auth/cognitoAuth.js";
import { requestJSON } from "../api/requestJSON.js";

export type RealtimeMessageType =
  | "ready"
  | "subscription.accepted"
  | "subscription.rejected"
  | "projection.delta"
  | "snapshot.refetch"
  | "permission.revoked"
  | "ping"
  | "pong"
  | "error";

export type RealtimeBaseMessage = {
  type: RealtimeMessageType;
  company_id?: string;
  scope?: string;
};

export type RealtimeReadyMessage = RealtimeBaseMessage & {
  type: "ready";
  user_id?: string;
  connection_id?: string;
};

export type RealtimeSubscriptionAcceptedMessage = RealtimeBaseMessage & {
  type: "subscription.accepted";
  scope: string;
  current_sequence?: number;
};

export type RealtimeSubscriptionRejectedMessage = RealtimeBaseMessage & {
  type: "subscription.rejected";
  scope?: string;
  error?: string;
  message?: string;
};

export type RealtimeProjectionDeltaMessage = RealtimeBaseMessage & {
  type: "projection.delta";
  scope: string;
  sequence?: number;
  projection?: string;
  projection_scope?: string;
  projection_sequence?: number;
  projected_timestamp?: string;
  deltas: unknown[];
};

export type RealtimeSnapshotRefetchMessage = RealtimeBaseMessage & {
  type: "snapshot.refetch";
  scope: string;
  sequence?: number;
  reason?: string;
};

export type RealtimePermissionRevokedMessage = RealtimeBaseMessage & {
  type: "permission.revoked";
  scope: string;
  resource_type?: string;
  resource_id?: string;
  reason?: string;
};

export type RealtimeErrorMessage = RealtimeBaseMessage & {
  type: "error";
  error?: string;
  message?: string;
};

export type RealtimeInboundMessage =
  | RealtimeReadyMessage
  | RealtimeSubscriptionAcceptedMessage
  | RealtimeSubscriptionRejectedMessage
  | RealtimeProjectionDeltaMessage
  | RealtimeSnapshotRefetchMessage
  | RealtimePermissionRevokedMessage
  | RealtimeErrorMessage
  | (RealtimeBaseMessage & { type: "ping" | "pong" });

export type RealtimeSubscriptionHandlers = {
  afterSequence?: number;
  getAfterSequence?: () => number | undefined;
  onReady?: (message: RealtimeReadyMessage) => void;
  onAccepted?: (message: RealtimeSubscriptionAcceptedMessage) => void;
  onRejected?: (message: RealtimeSubscriptionRejectedMessage) => void;
  onDelta?: (message: RealtimeProjectionDeltaMessage) => void;
  onRefetch?: (message: RealtimeSnapshotRefetchMessage) => void;
  onPermissionRevoked?: (message: RealtimePermissionRevokedMessage) => void;
  onError?: (message: RealtimeErrorMessage) => void;
};

type RealtimeSubscription = RealtimeSubscriptionHandlers & {
  scope: string;
};

type RealtimeClientOptions = {
  getAccessToken?: () => Promise<string>;
  getTicket?: () => Promise<string>;
  WebSocketCtor?: typeof WebSocket;
  reconnectDelayMs?: number;
};

type RealtimeTicketResponse = {
  ticket?: string;
};

const realtimeClients = new Map<string, MangoRealtimeClient>();

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function objectValue(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("realtime_message_must_be_object");
  }
  return parsed as Record<string, unknown>;
}

export function parseRealtimeMessage(raw: string): RealtimeInboundMessage {
  const payload = objectValue(raw);
  const type = stringValue(payload.type) as RealtimeMessageType;
  if (!type) throw new Error("realtime_type_required");
  const base = {
    type,
    company_id: stringValue(payload.company_id) || undefined,
    scope: stringValue(payload.scope) || undefined,
  };

  switch (type) {
    case "ready":
      return {
        ...base,
        type,
        user_id: stringValue(payload.user_id) || undefined,
        connection_id: stringValue(payload.connection_id) || undefined,
      };
    case "subscription.accepted": {
      const scope = stringValue(payload.scope);
      if (!scope) throw new Error("realtime_scope_required");
      return { ...base, type, scope, current_sequence: optionalNumber(payload.current_sequence) };
    }
    case "subscription.rejected":
      return {
        ...base,
        type,
        error: stringValue(payload.error) || undefined,
        message: stringValue(payload.message) || undefined,
      };
    case "projection.delta": {
      const scope = stringValue(payload.scope);
      if (!scope) throw new Error("realtime_scope_required");
      const sequence = optionalNumber(payload.sequence);
      return {
        ...base,
        type,
        scope,
        sequence,
        projection: stringValue(payload.projection) || undefined,
        projection_scope: stringValue(payload.projection_scope) || undefined,
        projection_sequence: optionalNumber(payload.projection_sequence) ?? sequence,
        projected_timestamp: stringValue(payload.projected_timestamp) || undefined,
        deltas: Array.isArray(payload.deltas) ? payload.deltas : [],
      };
    }
    case "snapshot.refetch": {
      const scope = stringValue(payload.scope);
      if (!scope) throw new Error("realtime_scope_required");
      return {
        ...base,
        type,
        scope,
        sequence: optionalNumber(payload.sequence),
        reason: stringValue(payload.reason) || undefined,
      };
    }
    case "permission.revoked": {
      const scope = stringValue(payload.scope);
      if (!scope) throw new Error("realtime_scope_required");
      return {
        ...base,
        type,
        scope,
        resource_type: stringValue(payload.resource_type) || undefined,
        resource_id: stringValue(payload.resource_id) || undefined,
        reason: stringValue(payload.reason) || undefined,
      };
    }
    case "error":
      return {
        ...base,
        type,
        error: stringValue(payload.error) || undefined,
        message: stringValue(payload.message) || undefined,
      };
    case "ping":
    case "pong":
      return { ...base, type };
    default:
      throw new Error("unknown_realtime_message_type");
  }
}

export function realtimeWebSocketURL(apiBase: string, companyID: string, ticket = ""): string {
  const url = new URL("/v1/realtime/ws", apiBase || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("company_id", companyID);
  if (ticket) url.searchParams.set("ticket", ticket);
  return url.toString();
}

export async function requestRealtimeWebSocketTicket(apiBase: string, companyID: string, getAccessToken: () => Promise<string> = getApiAccessToken): Promise<string> {
  const response = await requestJSON<RealtimeTicketResponse>(apiBase, "/v1/realtime/ticket", {
    method: "POST",
    json: { company_id: companyID },
    getAccessToken,
  });
  const ticket = stringValue(response.ticket);
  if (!ticket) throw new Error("realtime_ticket_required");
  return ticket;
}

export class MangoRealtimeClient {
  private readonly apiBase: string;
  private readonly companyID: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly getTicket: () => Promise<string>;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly reconnectDelayMs: number;
  private readonly subscriptions = new Map<string, Set<RealtimeSubscription>>();
  private socket: WebSocket | null = null;
  private opening = false;
  private manualClose = false;
  private keepAliveRefs = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(apiBase: string, companyID: string, options: RealtimeClientOptions = {}) {
    this.apiBase = apiBase;
    this.companyID = companyID;
    this.getAccessToken = options.getAccessToken ?? getApiAccessToken;
    this.getTicket = options.getTicket ?? (() => requestRealtimeWebSocketTicket(this.apiBase, this.companyID, this.getAccessToken));
    this.WebSocketCtor = options.WebSocketCtor ?? WebSocket;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  }

  retain(): () => void {
    this.keepAliveRefs += 1;
    this.ensureOpen();
    return () => {
      this.keepAliveRefs = Math.max(0, this.keepAliveRefs - 1);
      this.closeIfIdle();
    };
  }

  subscribe(scope: string, handlers: RealtimeSubscriptionHandlers = {}): () => void {
    const cleanScope = scope.trim();
    if (!cleanScope) return () => undefined;
    const subscription: RealtimeSubscription = { ...handlers, scope: cleanScope };
    const bucket = this.subscriptions.get(cleanScope) ?? new Set<RealtimeSubscription>();
    const firstForScope = bucket.size === 0;
    bucket.add(subscription);
    this.subscriptions.set(cleanScope, bucket);
    this.ensureOpen();
    if (firstForScope && this.socket?.readyState === WebSocket.OPEN) this.sendSubscribe(cleanScope);
    return () => {
      const current = this.subscriptions.get(cleanScope);
      current?.delete(subscription);
      if (current && current.size > 0) return;
      this.subscriptions.delete(cleanScope);
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "unsubscribe", scope: cleanScope }));
      }
      this.closeIfIdle();
    };
  }

  ensureOpen(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING || this.opening) return;
    this.manualClose = false;
    this.opening = true;
    void this.getTicket()
      .then((ticket) => {
        if (this.manualClose) return;
        const socket = new this.WebSocketCtor(realtimeWebSocketURL(this.apiBase, this.companyID, ticket));
        this.socket = socket;
        socket.onopen = () => {
          this.opening = false;
        };
        socket.onmessage = (event) => this.handleMessage(typeof event.data === "string" ? event.data : "");
        socket.onerror = () => {
          this.dispatchError({ type: "error", error: "websocket_error" });
        };
        socket.onclose = () => {
          this.socket = null;
          this.opening = false;
          if (!this.manualClose && (this.keepAliveRefs > 0 || this.subscriptions.size > 0)) this.scheduleReconnect();
        };
      })
      .catch(() => {
        this.opening = false;
        this.dispatchError({ type: "error", error: "websocket_auth_failed" });
        this.scheduleReconnect();
      });
  }

  close(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.socket?.close();
    this.socket = null;
    this.opening = false;
  }

  private closeIfIdle(): void {
    if (this.keepAliveRefs > 0 || this.subscriptions.size > 0) return;
    this.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== undefined || this.manualClose) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureOpen();
    }, this.reconnectDelayMs);
  }

  private sendSubscriptions(): void {
    for (const scope of this.subscriptions.keys()) this.sendSubscribe(scope);
  }

  private sendSubscribe(scope: string): void {
    const afterSequence = this.latestAfterSequence(scope);
    const message: { type: "subscribe"; scope: string; after_sequence?: number } = { type: "subscribe", scope };
    if (afterSequence !== undefined) message.after_sequence = afterSequence;
    this.socket?.send(JSON.stringify(message));
  }

  private latestAfterSequence(scope: string): number | undefined {
    const bucket = this.subscriptions.get(scope);
    if (!bucket) return undefined;
    let sequence: number | undefined;
    for (const sub of bucket) {
      const candidate = sub.getAfterSequence?.() ?? sub.afterSequence;
      if (candidate !== undefined && Number.isSafeInteger(candidate) && candidate >= 0) {
        sequence = Math.max(sequence ?? 0, candidate);
      }
    }
    return sequence;
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
    if (message.type === "ready") {
      for (const sub of this.allSubscriptions()) sub.onReady?.(message);
      this.sendSubscriptions();
      return;
    }
    if (message.type === "error") {
      this.dispatchError(message);
      return;
    }
    const scope = message.scope ?? "";
    const bucket = scope ? this.subscriptions.get(scope) : undefined;
    if (!bucket || bucket.size === 0) return;
    for (const sub of bucket) {
      switch (message.type) {
        case "subscription.accepted":
          sub.onAccepted?.(message);
          break;
        case "subscription.rejected":
          sub.onRejected?.(message);
          break;
        case "projection.delta":
          sub.onDelta?.(message);
          break;
        case "snapshot.refetch":
          sub.onRefetch?.(message);
          break;
        case "permission.revoked":
          sub.onPermissionRevoked?.(message);
          break;
      }
    }
  }

  private allSubscriptions(): RealtimeSubscription[] {
    return Array.from(this.subscriptions.values()).flatMap((bucket) => Array.from(bucket));
  }

  private dispatchError(message: RealtimeErrorMessage): void {
    for (const sub of this.allSubscriptions()) sub.onError?.(message);
  }
}

export function getMangoRealtimeClient(apiBase: string, companyID: string, options: RealtimeClientOptions = {}): MangoRealtimeClient {
  const key = `${apiBase}:${companyID}`;
  const existing = realtimeClients.get(key);
  if (existing) return existing;
  const client = new MangoRealtimeClient(apiBase, companyID, options);
  realtimeClients.set(key, client);
  return client;
}

export function ensureMangoRealtimeConnection(apiBase: string, companyID: string): () => void {
  if (!companyID.trim()) return () => undefined;
  return getMangoRealtimeClient(apiBase, companyID).retain();
}

export function subscribeRealtimeScope(apiBase: string, companyID: string, scope: string, handlers: RealtimeSubscriptionHandlers): () => void {
  if (!companyID.trim() || !scope.trim()) return () => undefined;
  return getMangoRealtimeClient(apiBase, companyID).subscribe(scope, handlers);
}
