import { createRequestJSON } from "../modules/api/requestJSON.js";
import { sidebarPinFallbackName, type SidebarPin, type SidebarPinDraft, type SidebarPinKind } from "./sidebarPins.js";

type UserPinRecord = {
  pin_id: string;
  company_id: string;
  user_id: string;
  resource_type: string;
  resource_id: string;
  name: string;
  position: number;
  created_timestamp: string;
};

type UserPinsResponse = {
  user_pins?: UserPinRecord[];
};

function normalizeSidebarPinKind(value: string): SidebarPinKind | null {
  if (value === "node" || value === "logic_gate" || value === "project") return value;
  return null;
}

function sidebarPinFromRecord(record: UserPinRecord): SidebarPin | null {
  const kind = normalizeSidebarPinKind(record.resource_type);
  const id = record.resource_id.trim();
  const pinID = record.pin_id.trim();
  if (!kind || !id || !pinID) return null;
  return {
    pinID,
    id,
    kind,
    name: record.name.trim() || sidebarPinFallbackName(kind, id),
    position: Number.isFinite(record.position) ? record.position : 0,
    createdTimestamp: record.created_timestamp,
  };
}

export async function fetchSidebarPins(apiBase: string, companyID: string): Promise<SidebarPin[]> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinsResponse>(`/v1/user-pins?company_id=${encodeURIComponent(companyID)}`);
  return (response.user_pins ?? []).map(sidebarPinFromRecord).filter((pin): pin is SidebarPin => !!pin);
}

export async function createSidebarPin(apiBase: string, companyID: string, pin: SidebarPinDraft): Promise<SidebarPin> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinRecord>("/v1/user-pins", {
    method: "POST",
    json: {
      company_id: companyID,
      resource_type: pin.kind,
      resource_id: pin.id.trim(),
    },
  });
  const normalized = sidebarPinFromRecord(response);
  if (!normalized) throw new Error("Invalid user pin response");
  return normalized;
}

export async function deleteSidebarPin(apiBase: string, companyID: string, pinID: string): Promise<void> {
  const requestJSON = createRequestJSON(apiBase);
  await requestJSON<{ deleted?: boolean }>(`/v1/user-pins/${encodeURIComponent(pinID)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
}

export async function reorderSidebarPins(apiBase: string, companyID: string, pinIDs: string[]): Promise<SidebarPin[]> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinsResponse>("/v1/user-pins/order", {
    method: "PUT",
    json: {
      company_id: companyID,
      pin_ids: pinIDs,
    },
  });
  return (response.user_pins ?? []).map(sidebarPinFromRecord).filter((pin): pin is SidebarPin => !!pin);
}

