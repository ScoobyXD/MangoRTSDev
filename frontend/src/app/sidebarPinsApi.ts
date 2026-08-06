import { createRequestJSON } from "../modules/api/requestJSON.js";
import {
  sidebarPinFallbackName,
  type SidebarPin,
  type SidebarPinDraft,
  type SidebarPinFolder,
  type SidebarPinKind,
  type SidebarPinLayoutEntry,
  type SidebarPinTree,
} from "./sidebarPins.js";

type UserPinRecord = {
  pin_id: string;
  company_id: string;
  user_id: string;
  parent_folder_id?: string | null;
  resource_type: string;
  resource_id: string;
  name: string;
  position: number;
  created_timestamp: string;
};

type UserPinFolderRecord = {
  folder_id: string;
  company_id: string;
  user_id: string;
  parent_folder_id?: string | null;
  name: string;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

type UserPinTreeResponse = {
  pin_folders?: UserPinFolderRecord[];
  user_pins?: UserPinRecord[];
};

type UserPinGroupResponse = UserPinTreeResponse & {
  grouped_folder?: UserPinFolderRecord;
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
    parentFolderID: record.parent_folder_id?.trim() ?? "",
    name: record.name.trim() || sidebarPinFallbackName(kind, id),
    position: Number.isFinite(record.position) ? record.position : 0,
    createdTimestamp: record.created_timestamp,
  };
}

function sidebarPinFolderFromRecord(record: UserPinFolderRecord): SidebarPinFolder | null {
  const folderID = record.folder_id.trim();
  const name = record.name.trim();
  if (!folderID || !name) return null;
  return {
    folderID,
    parentFolderID: record.parent_folder_id?.trim() ?? "",
    name,
    position: Number.isFinite(record.position) ? record.position : 0,
    createdTimestamp: record.created_timestamp,
    updatedTimestamp: record.updated_timestamp,
  };
}

function sidebarPinTreeFromResponse(response: UserPinTreeResponse): SidebarPinTree {
  return {
    folders: (response.pin_folders ?? []).map(sidebarPinFolderFromRecord).filter((folder): folder is SidebarPinFolder => !!folder),
    pins: (response.user_pins ?? []).map(sidebarPinFromRecord).filter((pin): pin is SidebarPin => !!pin),
  };
}

export async function fetchSidebarPinTree(apiBase: string, companyID: string): Promise<SidebarPinTree> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinTreeResponse>(`/v1/user-pins?company_id=${encodeURIComponent(companyID)}`);
  return sidebarPinTreeFromResponse(response);
}

export async function createSidebarPin(apiBase: string, companyID: string, pin: SidebarPinDraft): Promise<SidebarPin> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinRecord>("/v1/user-pins", {
    method: "POST",
    json: {
      company_id: companyID,
      resource_type: pin.kind,
      resource_id: pin.id.trim(),
      ...(pin.parentFolderID !== undefined ? { parent_folder_id: pin.parentFolderID.trim() } : {}),
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

export async function createSidebarPinFolder(apiBase: string, companyID: string, parentFolderID: string, name = "New Folder"): Promise<SidebarPinFolder> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinFolderRecord>("/v1/user-pin-folders", {
    method: "POST",
    json: {
      company_id: companyID,
      parent_folder_id: parentFolderID.trim(),
      name,
    },
  });
  const folder = sidebarPinFolderFromRecord(response);
  if (!folder) throw new Error("Invalid user pin folder response");
  return folder;
}

export async function renameSidebarPinFolder(apiBase: string, companyID: string, folderID: string, name: string): Promise<SidebarPinFolder> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinFolderRecord>(`/v1/user-pin-folders/${encodeURIComponent(folderID)}`, {
    method: "PUT",
    json: { company_id: companyID, name },
  });
  const folder = sidebarPinFolderFromRecord(response);
  if (!folder) throw new Error("Invalid user pin folder response");
  return folder;
}

export async function deleteSidebarPinFolder(apiBase: string, companyID: string, folderID: string): Promise<SidebarPinTree> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinTreeResponse>(`/v1/user-pin-folders/${encodeURIComponent(folderID)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
  return sidebarPinTreeFromResponse(response);
}

export async function applySidebarPinLayout(apiBase: string, companyID: string, entries: SidebarPinLayoutEntry[]): Promise<SidebarPinTree> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinTreeResponse>("/v1/user-pins/layout", {
    method: "PUT",
    json: {
      company_id: companyID,
      entries: entries.map((entry) => ({
        entry_type: entry.entryType,
        entry_id: entry.entryID,
        parent_folder_id: entry.parentFolderID,
        position: entry.position,
      })),
    },
  });
  return sidebarPinTreeFromResponse(response);
}

export async function groupSidebarPins(apiBase: string, companyID: string, draggedPinID: string, targetPinID: string): Promise<{ tree: SidebarPinTree; folder: SidebarPinFolder }> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<UserPinGroupResponse>("/v1/user-pin-folders/group", {
    method: "POST",
    json: {
      company_id: companyID,
      dragged_pin_id: draggedPinID,
      target_pin_id: targetPinID,
    },
  });
  const folder = response.grouped_folder ? sidebarPinFolderFromRecord(response.grouped_folder) : null;
  if (!folder) throw new Error("Invalid grouped pin folder response");
  return { tree: sidebarPinTreeFromResponse(response), folder };
}
