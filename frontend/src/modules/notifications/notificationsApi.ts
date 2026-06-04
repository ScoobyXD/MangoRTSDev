import { apiFetchJSON, readAuthConfig } from "../../auth/cognitoAuth.js";

export type NotificationRaciRole = "responsible" | "accountable" | "consulted" | "informed" | "other";
export type NotificationSurface = "r_inbox" | "aci_inbox" | "my_triage" | "shared_triage" | "";

export const EVENT_NOTIFICATIONS_UPDATED = "mangorts:notifications-updated";

export type NotificationItem = {
  notification_id: string;
  company_id?: string;
  recipient_user_id: string;
  actor_user_id?: string;
  type: string;
  source_event_id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  body_preview?: string;
  surface?: NotificationSurface;
  role?: NotificationRaciRole | "";
  logic_gate_id?: string;
  node_id?: string;
  information_id?: string;
  read_timestamp?: string;
  created_timestamp: string;
};

export type NotificationRoleCount = {
  surface?: NotificationSurface;
  role?: NotificationRaciRole | "";
  count: number;
};

export type NotificationTypeCount = {
  type: string;
  count: number;
};

export type NotificationLogicGateCount = {
  logic_gate_id: string;
  node_id?: string;
  role: NotificationRaciRole;
  count: number;
};

export type NotificationSummary = {
  company_id?: string;
  total_unread: number;
  role_counts: NotificationRoleCount[];
  type_counts: NotificationTypeCount[];
  logic_gate_counts: NotificationLogicGateCount[];
  updated_timestamp?: string;
};

export type NotificationClearInput = {
  companyID?: string;
  type?: string;
  surface?: NotificationSurface;
  role?: NotificationRaciRole | "";
  logicGateID?: string;
  nodeID?: string;
};

export function emptyNotificationSummary(companyID = ""): NotificationSummary {
  return {
    company_id: companyID,
    total_unread: 0,
    role_counts: [],
    type_counts: [],
    logic_gate_counts: [],
  };
}

export async function deleteNotification(notificationID: string, companyID = ""): Promise<number> {
  const cleanNotificationID = notificationID.trim();
  if (!cleanNotificationID) throw new Error("notification_id_required");
  const result = await apiFetchJSON<{ deleted_count?: number }>(`/v1/notifications/${encodeURIComponent(cleanNotificationID)}`, {
    method: "DELETE",
  });
  emitNotificationsUpdated(companyID);
  return normalizeCount(result.deleted_count);
}

export async function deleteNotifications(input: { companyID: string }): Promise<number> {
  const cleanCompanyID = input.companyID.trim();
  if (!cleanCompanyID) throw new Error("company_id_required");
  const query = `?company_id=${encodeURIComponent(cleanCompanyID)}`;
  const result = await apiFetchJSON<{ deleted_count?: number }>(`/v1/notifications${query}`, {
    method: "DELETE",
  });
  emitNotificationsUpdated(cleanCompanyID);
  return normalizeCount(result.deleted_count);
}

export async function fetchNotificationSummary(companyID: string): Promise<NotificationSummary> {
  const cleanCompanyID = companyID.trim();
  const query = cleanCompanyID ? `?company_id=${encodeURIComponent(cleanCompanyID)}` : "";
  const summary = await apiFetchJSON<NotificationSummary>(`/v1/notifications/summary${query}`);
  return normalizeNotificationSummary(summary, cleanCompanyID);
}

export async function fetchNotifications(input: {
  companyID?: string;
  type?: string;
  unreadOnly?: boolean;
  limit?: number;
} = {}): Promise<NotificationItem[]> {
  const query = new URLSearchParams();
  const cleanCompanyID = input.companyID?.trim() ?? "";
  if (cleanCompanyID) query.set("company_id", cleanCompanyID);
  const cleanType = input.type?.trim() ?? "";
  if (cleanType) query.set("type", cleanType);
  if (input.unreadOnly) query.set("unread_only", "true");
  if (input.limit && input.limit > 0) query.set("limit", String(Math.floor(input.limit)));
  const suffix = query.toString();
  const payload = await apiFetchJSON<{ notifications?: NotificationItem[] }>(`/v1/notifications${suffix ? `?${suffix}` : ""}`);
  return normalizeNotifications(payload.notifications ?? []);
}

export async function markNotificationRead(notificationID: string, read = true): Promise<NotificationItem> {
  const cleanNotificationID = notificationID.trim();
  const action = read ? "read" : "unread";
  const item = await apiFetchJSON<NotificationItem>(`/v1/notifications/${encodeURIComponent(cleanNotificationID)}/${action}`, {
    method: "POST",
  });
  emitNotificationsUpdated(item.company_id);
  return normalizeNotification(item);
}

export async function markNotificationsRead(input: NotificationClearInput = {}): Promise<number> {
  const payload = {
    company_id: input.companyID?.trim() ?? "",
    type: input.type?.trim() ?? "",
    surface: input.surface?.trim() ?? "",
    role: input.role?.trim() ?? "",
    logic_gate_id: input.logicGateID?.trim() ?? "",
    node_id: input.nodeID?.trim() ?? "",
  };
  const result = await apiFetchJSON<{ updated_count?: number }>("/v1/notifications/read-all", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  emitNotificationsUpdated(payload.company_id);
  return normalizeCount(result.updated_count);
}

export function notificationStreamURL(): string {
  return `${readAuthConfig().apiBase}/v1/notifications/stream`;
}

function normalizeNotificationSummary(summary: NotificationSummary, companyID: string): NotificationSummary {
  return {
    company_id: summary.company_id?.trim() || companyID,
    total_unread: normalizeCount(summary.total_unread),
    role_counts: Array.isArray(summary.role_counts)
      ? summary.role_counts.map((item) => ({
          surface: normalizeSurface(item.surface),
          role: normalizeRole(item.role),
          count: normalizeCount(item.count),
        })).filter((item) => item.count > 0)
      : [],
    type_counts: Array.isArray(summary.type_counts)
      ? summary.type_counts.map((item) => ({
          type: item.type?.trim() ?? "",
          count: normalizeCount(item.count),
        })).filter((item) => item.type && item.count > 0)
      : [],
    logic_gate_counts: Array.isArray(summary.logic_gate_counts)
      ? summary.logic_gate_counts.map((item) => ({
          logic_gate_id: item.logic_gate_id?.trim() ?? "",
          node_id: item.node_id?.trim() || undefined,
          role: normalizeRole(item.role) as NotificationRaciRole,
          count: normalizeCount(item.count),
        })).filter((item) => item.logic_gate_id && item.role && item.count > 0)
      : [],
    updated_timestamp: summary.updated_timestamp,
  };
}

function normalizeCount(value: unknown): number {
  const count = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.floor(count));
}

function normalizeSurface(value: unknown): NotificationSurface {
  const raw = typeof value === "string" ? value.trim() : "";
  switch (raw) {
    case "r_inbox":
    case "aci_inbox":
    case "my_triage":
    case "shared_triage":
      return raw;
    default:
      return "";
  }
}

export function normalizeRole(value: unknown): NotificationRaciRole | "" {
  const raw = typeof value === "string" ? value.trim() : "";
  switch (raw) {
    case "responsible":
    case "accountable":
    case "consulted":
    case "informed":
    case "other":
      return raw;
    default:
      return "";
  }
}

function normalizeNotifications(items: NotificationItem[]): NotificationItem[] {
  return items.map(normalizeNotification);
}

function normalizeNotification(item: NotificationItem): NotificationItem {
  return {
    ...item,
    notification_id: item.notification_id?.trim() ?? "",
    company_id: item.company_id?.trim() || undefined,
    recipient_user_id: item.recipient_user_id?.trim() ?? "",
    actor_user_id: item.actor_user_id?.trim() || undefined,
    type: item.type?.trim() ?? "",
    source_event_id: item.source_event_id?.trim() ?? "",
    entity_type: item.entity_type?.trim() ?? "",
    entity_id: item.entity_id?.trim() ?? "",
    title: item.title?.trim() ?? "Notification",
    body_preview: item.body_preview?.trim() || undefined,
    surface: normalizeSurface(item.surface),
    role: normalizeRole(item.role),
    logic_gate_id: item.logic_gate_id?.trim() || undefined,
    node_id: item.node_id?.trim() || undefined,
    information_id: item.information_id?.trim() || undefined,
    read_timestamp: item.read_timestamp,
    created_timestamp: item.created_timestamp,
  };
}

export function emitNotificationsUpdated(companyID?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NOTIFICATIONS_UPDATED, { detail: { companyID: companyID?.trim() ?? "" } }));
}
