import { apiFetchJSON, readAuthConfig } from "../../auth/cognitoAuth.js";

export type NotificationRaciRole = "responsible" | "accountable" | "consulted" | "informed";
export type NotificationSurface = "r_inbox" | "aci_inbox" | "my_triage" | "shared_triage" | "";

export type NotificationRoleCount = {
  surface?: NotificationSurface;
  role?: NotificationRaciRole | "";
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
  logic_gate_counts: NotificationLogicGateCount[];
  updated_timestamp?: string;
};

export function emptyNotificationSummary(companyID = ""): NotificationSummary {
  return {
    company_id: companyID,
    total_unread: 0,
    role_counts: [],
    logic_gate_counts: [],
  };
}

export async function fetchNotificationSummary(companyID: string): Promise<NotificationSummary> {
  const cleanCompanyID = companyID.trim();
  const query = cleanCompanyID ? `?company_id=${encodeURIComponent(cleanCompanyID)}` : "";
  const summary = await apiFetchJSON<NotificationSummary>(`/v1/notifications/summary${query}`);
  return normalizeNotificationSummary(summary, cleanCompanyID);
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
      return raw;
    default:
      return "";
  }
}