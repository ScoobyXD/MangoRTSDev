import { apiFetchJSON } from "../../auth/cognitoAuth.js";

export type RecycleBinObjectKind = "folder" | "node" | "logic_gate" | "project" | "kanban";

export type RecycleBinContainedItem = {
  kind: RecycleBinObjectKind;
  id: string;
  label: string;
  folder_kind?: string;
};

export type RecycleBinItem = {
  company_id: string;
  recycle_bin_item_id: string;
  object_kind: RecycleBinObjectKind;
  object_id: string;
  object_label: string;
  object_folder_kind?: string;
  contained_items?: RecycleBinContainedItem[];
  deleted_by_user_id?: string;
  deleted_timestamp: string;
};

export type RecycleBinMutationResult = {
  items?: RecycleBinItem[];
  targets?: Array<{ kind: RecycleBinObjectKind; id: string; folder_kind?: string }>;
  status?: string;
};

export async function listRecycleBinItems(companyID: string): Promise<RecycleBinItem[]> {
  const params = new URLSearchParams({ company_id: companyID });
  const payload = await apiFetchJSON<{ items?: RecycleBinItem[] }>(`/v1/recycle-bin?${params.toString()}`);
  return payload.items ?? [];
}

export function restoreRecycleBinItems(companyID: string, itemIDs: string[]): Promise<RecycleBinMutationResult> {
  return apiFetchJSON<RecycleBinMutationResult>("/v1/recycle-bin/restore", {
    method: "POST",
    body: JSON.stringify({ company_id: companyID, item_ids: itemIDs }),
  });
}

export function permanentlyDeleteRecycleBinItems(companyID: string, itemIDs: string[]): Promise<RecycleBinMutationResult> {
  return apiFetchJSON<RecycleBinMutationResult>("/v1/recycle-bin/delete", {
    method: "POST",
    body: JSON.stringify({ company_id: companyID, item_ids: itemIDs }),
  });
}
