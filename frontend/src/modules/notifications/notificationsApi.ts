import { apiFetchJSON } from "../../auth/cognitoAuth.js";

export type NotificationGVICRole = "generated" | "verified" | "consulted" | "informed" | "other";
export type NotificationSurface = "r_inbox" | "aci_inbox" | "my_triage" | "shared_triage" | "";

export const EVENT_NOTIFICATIONS_UPDATED = "mangorts:notifications-updated";
export const NOTIFICATION_UPDATE_SOURCE_REALTIME_ACCEPTED = "realtime-accepted-summary";
export const NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN = "updates-local-seen";
const LOCAL_NOTIFICATION_ECHO_TTL_MS = 10_000;

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
  role?: NotificationGVICRole | "";
  logic_gate_id?: string;
  node_id?: string;
  information_id?: string;
  priority?: number | null;
  read_timestamp?: string;
  created_timestamp: string;
};

export type UpdateFeedFilter = "all" | "urgent" | "mention" | "update";
export type UpdateFeedView = "current" | "seen";

export type UpdateGroup = {
  id: string;
  key: string;
  field: string;
  label: string;
  resource_type?: "project" | "logic_gate" | "node" | "";
  resource_id?: string;
  depth: number;
  groups: UpdateGroup[];
  notifications?: NotificationItem[];
};

export const NOTIFICATION_TYPE_MENTION = "mention.created";
export const NOTIFICATION_TYPE_URGENT_MENTION = "mention.urgent_created";

export type NotificationRoleCount = {
  surface?: NotificationSurface;
  role?: NotificationGVICRole | "";
  count: number;
};

export type NotificationTypeCount = {
  type: string;
  count: number;
};

export type NotificationLogicGateCount = {
  logic_gate_id: string;
  node_id?: string;
  role: NotificationGVICRole;
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
  role?: NotificationGVICRole | "";
  logicGateID?: string;
  nodeID?: string;
};

type NotificationUpdateEventSource = {
  source?: string;
};

type LocalNotificationEcho = {
  source: string;
  expiresAt: number;
  reconciled: boolean;
  httpObserved: boolean;
  socketObserved: boolean;
};

type LocalNotificationReconciliationClaim = {
  source: string;
  shouldReconcile: boolean;
};

const localNotificationDeleteEchoes = new Map<string, LocalNotificationEcho>();
const localNotificationClearEchoes = new Map<string, LocalNotificationEcho>();

export function emptyNotificationSummary(companyID = ""): NotificationSummary {
  return {
    company_id: companyID,
    total_unread: 0,
    role_counts: [],
    type_counts: [],
    logic_gate_counts: [],
  };
}

export async function deleteNotification(notificationID: string, companyID = "", options: NotificationUpdateEventSource = {}): Promise<number> {
  const cleanNotificationID = notificationID.trim();
  if (!cleanNotificationID) throw new Error("notification_id_required");
  rememberLocalNotificationDeleteEcho(companyID, cleanNotificationID, options.source);
  let result: { deleted_count?: number };
  try {
    result = await apiFetchJSON<{ deleted_count?: number }>(`/v1/notifications/${encodeURIComponent(cleanNotificationID)}`, {
      method: "DELETE",
    });
  } catch (error) {
    const echoKey = localNotificationDeleteEchoKey(companyID, cleanNotificationID);
    if (!localNotificationDeleteEchoes.get(echoKey)?.socketObserved) localNotificationDeleteEchoes.delete(echoKey);
    throw error;
  }
  const claim = claimLocalNotificationDeleteReconciliation(companyID, cleanNotificationID, "http");
  if (!claim || claim.shouldReconcile) emitNotificationsUpdated(companyID, claim?.source ?? options.source);
  return normalizeCount(result.deleted_count);
}

export async function deleteNotifications(input: NotificationClearInput & { companyID: string } & NotificationUpdateEventSource): Promise<number> {
  const cleanCompanyID = input.companyID.trim();
  if (!cleanCompanyID) throw new Error("company_id_required");
  rememberLocalNotificationClearEcho(cleanCompanyID, input.source);
  const query = new URLSearchParams({ company_id: cleanCompanyID });
  const cleanType = input.type?.trim() ?? "";
  const cleanSurface = input.surface?.trim() ?? "";
  const cleanRole = input.role?.trim() ?? "";
  const cleanLogicGateID = input.logicGateID?.trim() ?? "";
  const cleanNodeID = input.nodeID?.trim() ?? "";
  if (cleanType) query.set("type", cleanType);
  if (cleanSurface) query.set("surface", cleanSurface);
  if (cleanRole) query.set("role", cleanRole);
  if (cleanLogicGateID) query.set("logic_gate_id", cleanLogicGateID);
  if (cleanNodeID) query.set("node_id", cleanNodeID);
  let result: { deleted_count?: number };
  try {
    result = await apiFetchJSON<{ deleted_count?: number }>(`/v1/notifications?${query.toString()}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!localNotificationClearEchoes.get(cleanCompanyID)?.socketObserved) localNotificationClearEchoes.delete(cleanCompanyID);
    throw error;
  }
  const claim = claimLocalNotificationClearReconciliation(cleanCompanyID, "http");
  if (!claim || claim.shouldReconcile) emitNotificationsUpdated(cleanCompanyID, claim?.source ?? input.source);
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

function appendSeenUpdateQuery(query: URLSearchParams, input: { view?: UpdateFeedView; fromDate?: string; toDate?: string }): void {
  if (input.view !== "seen") return;
  query.set("view", "seen");
  query.set("from", input.fromDate?.trim() ?? "");
  query.set("to", input.toDate?.trim() ?? "");
}

export async function fetchUpdateRootGroups(input: {
  companyID: string;
  filter: UpdateFeedFilter;
  view?: UpdateFeedView;
  fromDate?: string;
  toDate?: string;
}): Promise<UpdateGroup[]> {
  const query = new URLSearchParams();
  query.set("company_id", input.companyID.trim());
  query.set("filter", input.filter);
  appendSeenUpdateQuery(query, input);
  const payload = await apiFetchJSON<{ groups?: UpdateGroup[] }>(`/v1/updates/groups/roots?${query.toString()}`);
  return normalizeUpdateGroups(payload.groups ?? []);
}

export async function fetchUpdateBranch(input: {
  companyID: string;
  filter: UpdateFeedFilter;
  rootID: string;
  view?: UpdateFeedView;
  fromDate?: string;
  toDate?: string;
}): Promise<UpdateGroup> {
  const query = new URLSearchParams();
  query.set("company_id", input.companyID.trim());
  query.set("filter", input.filter);
  query.set("root_id", input.rootID.trim());
  appendSeenUpdateQuery(query, input);
  const payload = await apiFetchJSON<{ group?: UpdateGroup }>(`/v1/updates/groups/branch?${query.toString()}`);
  return normalizeUpdateGroup(payload.group ?? {
    id: input.rootID,
    key: input.rootID,
    field: "update",
    label: "Updates",
    depth: 0,
    groups: [],
  });
}

export async function fetchSeenUpdatesRange(companyID: string): Promise<{
  oldest_created_timestamp?: string;
  newest_created_timestamp?: string;
}> {
  const query = new URLSearchParams({ company_id: companyID.trim() });
  return apiFetchJSON(`/v1/updates/seen-range?${query.toString()}`);
}

export async function markNotificationRead(notificationID: string, read = true, options: NotificationUpdateEventSource = {}): Promise<NotificationItem> {
  const cleanNotificationID = notificationID.trim();
  const action = read ? "read" : "unread";
  const item = await apiFetchJSON<NotificationItem>(`/v1/notifications/${encodeURIComponent(cleanNotificationID)}/${action}`, {
    method: "POST",
  });
  emitNotificationsUpdated(item.company_id, options.source);
  return normalizeNotification(item);
}

export async function markNotificationsRead(input: NotificationClearInput & NotificationUpdateEventSource = {}): Promise<number> {
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
  emitNotificationsUpdated(payload.company_id, input.source);
  return normalizeCount(result.updated_count);
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
          role: normalizeRole(item.role) as NotificationGVICRole,
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

export function normalizeRole(value: unknown): NotificationGVICRole | "" {
  const raw = typeof value === "string" ? value.trim() : "";
  switch (raw) {
    case "generated":
    case "verified":
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

function normalizeUpdateGroups(items: UpdateGroup[]): UpdateGroup[] {
  return Array.isArray(items) ? items.map(normalizeUpdateGroup).filter((item) => item.id) : [];
}

function normalizeUpdateGroup(item: UpdateGroup): UpdateGroup {
  return {
    id: item.id?.trim() ?? "",
    key: item.key?.trim() ?? "",
    field: item.field?.trim() ?? "update",
    label: item.label?.trim() || "Updates",
    resource_type: item.resource_type?.trim() as UpdateGroup["resource_type"],
    resource_id: item.resource_id?.trim() || undefined,
    depth: Number.isFinite(Number(item.depth)) ? Number(item.depth) : 0,
    groups: normalizeUpdateGroups(item.groups ?? []),
    notifications: normalizeNotifications(item.notifications ?? []),
  };
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
    title: item.title?.trim() ?? "Update",
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

export function emitNotificationsUpdated(companyID?: string, source = ""): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NOTIFICATIONS_UPDATED, { detail: { companyID: companyID?.trim() ?? "", source: source.trim() } }));
}

function rememberLocalNotificationDeleteEcho(companyID: string, notificationID: string, source = ""): void {
  cleanupLocalNotificationEchoes();
  const key = localNotificationDeleteEchoKey(companyID, notificationID);
  if (!key) return;
  localNotificationDeleteEchoes.set(key, {
    source: source.trim(),
    expiresAt: Date.now() + LOCAL_NOTIFICATION_ECHO_TTL_MS,
    reconciled: false,
    httpObserved: false,
    socketObserved: false,
  });
}

export function claimLocalNotificationDeleteReconciliation(companyID: string, notificationID: string, observer: "http" | "socket" = "socket"): LocalNotificationReconciliationClaim | undefined {
  cleanupLocalNotificationEchoes();
  const key = localNotificationDeleteEchoKey(companyID, notificationID);
  if (!key) return undefined;
  const echo = localNotificationDeleteEchoes.get(key);
  if (!echo) return undefined;
  const claim = claimLocalNotificationReconciliation(echo, observer);
  if (echo.httpObserved && echo.socketObserved) localNotificationDeleteEchoes.delete(key);
  return claim;
}

function rememberLocalNotificationClearEcho(companyID: string, source = ""): void {
  const cleanCompanyID = companyID.trim();
  const cleanSource = source.trim();
  if (!cleanCompanyID) return;
  cleanupLocalNotificationEchoes();
  localNotificationClearEchoes.set(cleanCompanyID, {
    source: cleanSource,
    expiresAt: Date.now() + LOCAL_NOTIFICATION_ECHO_TTL_MS,
    reconciled: false,
    httpObserved: false,
    socketObserved: false,
  });
}

export function claimLocalNotificationClearReconciliation(companyID: string, observer: "http" | "socket" = "socket"): LocalNotificationReconciliationClaim | undefined {
  cleanupLocalNotificationEchoes();
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return undefined;
  const echo = localNotificationClearEchoes.get(cleanCompanyID);
  if (!echo) return undefined;
  const claim = claimLocalNotificationReconciliation(echo, observer);
  if (echo.httpObserved && echo.socketObserved) localNotificationClearEchoes.delete(cleanCompanyID);
  return claim;
}

function claimLocalNotificationReconciliation(
  echo: LocalNotificationEcho,
  observer: "http" | "socket",
): LocalNotificationReconciliationClaim {
  if (observer === "http") echo.httpObserved = true;
  else echo.socketObserved = true;
  const shouldReconcile = !echo.reconciled;
  if (shouldReconcile) {
    echo.reconciled = true;
    echo.expiresAt = Date.now() + LOCAL_NOTIFICATION_ECHO_TTL_MS;
  }
  return { source: echo.source, shouldReconcile };
}

function cleanupLocalNotificationEchoes(): void {
  const now = Date.now();
  for (const [key, echo] of localNotificationDeleteEchoes) {
    if (echo.expiresAt <= now) localNotificationDeleteEchoes.delete(key);
  }
  for (const [key, echo] of localNotificationClearEchoes) {
    if (echo.expiresAt <= now) localNotificationClearEchoes.delete(key);
  }
}

function localNotificationDeleteEchoKey(companyID: string, notificationID: string): string {
  const cleanNotificationID = notificationID.trim();
  if (!cleanNotificationID) return "";
  return `${companyID.trim()}::${cleanNotificationID}`;
}
