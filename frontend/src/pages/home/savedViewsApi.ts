import { requestJSON } from "../../modules/api/requestJSON.js";

export type SavedViewSurface = "updates" | "logic_gate_kanban";
export type SavedViewPrincipal = "user" | "group";
export type SavedViewGroupingDirection = "asc" | "desc";

export type SavedViewGrouping = {
  field: string;
  direction: SavedViewGroupingDirection;
};

export type SavedViewSettings = {
  date_added_sort_direction?: SavedViewGroupingDirection;
  date_added_sort_enabled?: boolean;
};

export type SavedView = {
  company_id: string;
  saved_view_id: string;
  surface: SavedViewSurface;
  principal: SavedViewPrincipal;
  principal_id: string;
  name: string;
  groupings: SavedViewGrouping[];
  settings: SavedViewSettings;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type SavedViewInput = {
  company_id: string;
  saved_view_id?: string;
  surface: SavedViewSurface;
  principal: SavedViewPrincipal;
  principal_id: string;
  name: string;
  groupings: SavedViewGrouping[];
  settings?: SavedViewSettings;
  position?: number;
};

export async function fetchSavedViews(input: {
  apiBase: string;
  companyID: string;
  surface: SavedViewSurface;
}): Promise<SavedView[]> {
  const query = new URLSearchParams({
    company_id: input.companyID.trim(),
    surface: input.surface,
  });
  const payload = await requestJSON<{ saved_views?: SavedView[] }>(input.apiBase, `/v1/saved-views?${query.toString()}`);
  return Array.isArray(payload.saved_views) ? payload.saved_views.map(normalizeSavedView).filter(Boolean) as SavedView[] : [];
}

export async function saveSavedView(input: {
  apiBase: string;
  savedView: SavedViewInput;
}): Promise<SavedView> {
  const savedViewID = input.savedView.saved_view_id?.trim();
  const body = normalizeSavedViewInput(input.savedView);
  if (savedViewID) {
    return normalizeSavedView(await requestJSON<SavedView>(input.apiBase, `/v1/saved-views/${encodeURIComponent(savedViewID)}`, {
      method: "PUT",
      json: body,
    })) as SavedView;
  }
  return normalizeSavedView(await requestJSON<SavedView>(input.apiBase, "/v1/saved-views", {
    method: "POST",
    json: body,
  })) as SavedView;
}

export async function deleteSavedView(input: {
  apiBase: string;
  companyID: string;
  savedViewID: string;
}): Promise<void> {
  const query = new URLSearchParams({ company_id: input.companyID.trim() });
  await requestJSON<{ deleted?: boolean }>(input.apiBase, `/v1/saved-views/${encodeURIComponent(input.savedViewID.trim())}?${query.toString()}`, {
    method: "DELETE",
  });
}

export function createSavedViewID(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const randomHex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `${randomHex()}${randomHex()}-${randomHex()}-7${randomHex().slice(1)}-8${randomHex().slice(1)}-${randomHex()}${randomHex()}${randomHex()}`;
}

function normalizeSavedViewInput(input: SavedViewInput): SavedViewInput {
  return {
    company_id: input.company_id.trim(),
    saved_view_id: input.saved_view_id?.trim() || undefined,
    surface: input.surface,
    principal: input.principal,
    principal_id: input.principal_id.trim(),
    name: input.name.trim(),
    groupings: normalizeSavedViewGroupings(input.groupings),
    settings: normalizeSavedViewSettings(input.settings),
    position: input.position,
  };
}

function normalizeSavedView(value: SavedView): SavedView | null {
  if (!value || typeof value !== "object") return null;
  const surface = normalizeSavedViewSurface(value.surface);
  const principal = value.principal === "group" ? "group" : value.principal === "user" ? "user" : "";
  const savedViewID = value.saved_view_id?.trim() ?? "";
  const companyID = value.company_id?.trim() ?? "";
  const principalID = value.principal_id?.trim() ?? "";
  const name = value.name?.trim() ?? "";
  if (!surface || !principal || !savedViewID || !companyID || !principalID || !name) return null;
  return {
    company_id: companyID,
    saved_view_id: savedViewID,
    surface,
    principal,
    principal_id: principalID,
    name,
    groupings: normalizeSavedViewGroupings(value.groupings),
    settings: normalizeSavedViewSettings(value.settings),
    position: Number.isFinite(value.position) ? value.position : 0,
    created_timestamp: typeof value.created_timestamp === "string" ? value.created_timestamp : "",
    updated_timestamp: typeof value.updated_timestamp === "string" ? value.updated_timestamp : "",
  };
}

function normalizeSavedViewSurface(value: unknown): SavedViewSurface | "" {
  if (value === "updates") return "updates";
  if (value === "logic_gate_kanban") return "logic_gate_kanban";
  return "";
}

function normalizeSavedViewGroupings(value: unknown): SavedViewGrouping[] {
  if (!Array.isArray(value)) return [];
  const out: SavedViewGrouping[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { field?: unknown; direction?: unknown };
    const field = typeof candidate.field === "string" ? candidate.field.trim() : "";
    if (!field) continue;
    out.push({ field, direction: candidate.direction === "desc" ? "desc" : "asc" });
  }
  return out;
}

function normalizeSavedViewSettings(value: unknown): SavedViewSettings {
  if (!value || typeof value !== "object") return {};
  const candidate = value as { date_added_sort_direction?: unknown; date_added_sort_enabled?: unknown };
  const direction = candidate.date_added_sort_direction === "desc" ? "desc" : candidate.date_added_sort_direction === "asc" ? "asc" : undefined;
  const enabled = typeof candidate.date_added_sort_enabled === "boolean"
    ? candidate.date_added_sort_enabled
    : direction !== undefined
      ? true
      : undefined;
  return {
    ...(direction ? { date_added_sort_direction: direction } : {}),
    ...(enabled !== undefined ? { date_added_sort_enabled: enabled } : {}),
  };
}

