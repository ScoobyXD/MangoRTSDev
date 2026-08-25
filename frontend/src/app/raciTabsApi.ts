import { createRequestJSON } from "../modules/api/requestJSON.js";
import {
  emptyRACITabStatusCounts,
  type RACITabBranch,
  type RACITabFolder,
  type RACITabLayoutEntry,
  type RACITabRole,
  type RACITabRow,
  type RACITabStatusCounts,
} from "./raciTabs.js";

type StatusCountsRecord = { request?: number; pending?: number; in_progress?: number; review?: number };
type ItemRecord = {
  company_id?: string; user_id?: string; role?: string; logic_gate_id?: string; folder_id?: string | null;
  name?: string; position?: number; created_timestamp?: string; updated_timestamp?: string; status_counts?: StatusCountsRecord;
};
type FolderRecord = {
  company_id?: string; folder_id?: string; user_id?: string; role?: string; parent_folder_id?: string | null;
  name?: string; position?: number; created_timestamp?: string; updated_timestamp?: string; has_children?: boolean;
  status_counts?: StatusCountsRecord;
};
type RowRecord = { row_kind?: string; folder?: FolderRecord; item?: ItemRecord };
type BranchRecord = {
  role?: string; parent_folder_id?: string | null; rows?: RowRecord[]; status_counts?: StatusCountsRecord; next_cursor?: string;
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function counts(record?: StatusCountsRecord): RACITabStatusCounts {
  if (!record) return emptyRACITabStatusCounts();
  return { request: count(record.request), pending: count(record.pending), inProgress: count(record.in_progress), review: count(record.review) };
}

function folderFromRecord(record: FolderRecord): RACITabFolder {
  return {
    companyID: record.company_id?.trim() ?? "",
    folderID: record.folder_id?.trim() ?? "",
    userID: record.user_id?.trim() ?? "",
    role: record.role as RACITabRole,
    parentFolderID: record.parent_folder_id?.trim() ?? "",
    name: record.name?.trim() ?? "",
    position: Number.isFinite(record.position) ? record.position as number : 0,
    createdTimestamp: record.created_timestamp ?? "",
    updatedTimestamp: record.updated_timestamp ?? "",
    hasChildren: record.has_children === true,
    statusCounts: counts(record.status_counts),
  };
}

function rowFromRecord(record: RowRecord): RACITabRow | null {
  if (record.row_kind === "folder" && record.folder) {
    const folder = folderFromRecord(record.folder);
    return folder.folderID && folder.name ? { rowKind: "folder", folder } : null;
  }
  if (record.row_kind === "item" && record.item) {
    const item = record.item;
    const logicGateID = item.logic_gate_id?.trim() ?? "";
    if (!logicGateID) return null;
    return {
      rowKind: "item",
      item: {
        companyID: item.company_id?.trim() ?? "",
        userID: item.user_id?.trim() ?? "",
        role: item.role as RACITabRole,
        logicGateID,
        folderID: item.folder_id?.trim() ?? "",
        name: item.name?.trim() || "Process",
        position: Number.isFinite(item.position) ? item.position as number : 0,
        createdTimestamp: item.created_timestamp ?? "",
        updatedTimestamp: item.updated_timestamp ?? "",
        statusCounts: counts(item.status_counts),
      },
    };
  }
  return null;
}

export async function fetchRACITabBranch(apiBase: string, companyID: string, role: RACITabRole, parentFolderID = "", cursor = ""): Promise<RACITabBranch> {
  const requestJSON = createRequestJSON(apiBase);
  const query = new URLSearchParams({ company_id: companyID, role, limit: "50" });
  if (parentFolderID) query.set("parent_folder_id", parentFolderID);
  if (cursor) query.set("cursor", cursor);
  const response = await requestJSON<BranchRecord>(`/v1/raci-tabs?${query.toString()}`);
  return {
    role,
    parentFolderID,
    rows: (response.rows ?? []).map(rowFromRecord).filter((row): row is RACITabRow => !!row),
    statusCounts: counts(response.status_counts),
    nextCursor: response.next_cursor?.trim() ?? "",
  };
}

export async function createRACITabFolder(apiBase: string, companyID: string, role: RACITabRole, parentFolderID: string, name: string): Promise<RACITabFolder> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<FolderRecord>("/v1/raci-tab-folders", {
    method: "POST",
    json: { company_id: companyID, role, parent_folder_id: parentFolderID, name },
  });
  return folderFromRecord(response);
}

export async function renameRACITabFolder(apiBase: string, companyID: string, folderID: string, name: string): Promise<RACITabFolder> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<FolderRecord>(`/v1/raci-tab-folders/${encodeURIComponent(folderID)}`, {
    method: "PUT",
    json: { company_id: companyID, name },
  });
  return folderFromRecord(response);
}

export async function deleteRACITabFolder(apiBase: string, companyID: string, folderID: string): Promise<void> {
  const requestJSON = createRequestJSON(apiBase);
  await requestJSON(`/v1/raci-tab-folders/${encodeURIComponent(folderID)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
}

export async function applyRACITabLayout(apiBase: string, companyID: string, role: RACITabRole, entries: RACITabLayoutEntry[]): Promise<void> {
  const requestJSON = createRequestJSON(apiBase);
  await requestJSON("/v1/raci-tabs/layout", {
    method: "PUT",
    json: {
      company_id: companyID,
      role,
      entries: entries.map((entry) => ({
        entry_type: entry.entryType,
        entry_id: entry.entryID,
        parent_folder_id: entry.parentFolderID,
        position: entry.position,
      })),
    },
  });
}

export async function fetchRACITabLogicGateCounts(apiBase: string, companyID: string, logicGateID: string): Promise<RACITabStatusCounts> {
  const requestJSON = createRequestJSON(apiBase);
  const response = await requestJSON<StatusCountsRecord>(`/v1/raci-tabs/logic-gates/${encodeURIComponent(logicGateID)}/counts?company_id=${encodeURIComponent(companyID)}`);
  return counts(response);
}
