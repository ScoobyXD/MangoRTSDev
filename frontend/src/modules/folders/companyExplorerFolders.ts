export type CompanyExplorerFolderKind = "node" | "logic_gate" | "project";
export type CompanyExplorerItemType = CompanyExplorerFolderKind;
export type CompanyExplorerSystemFolderKey = "active_nodes" | "active_logic_gates" | "active_projects" | "history";
export type CompanyExplorerFolderScopeType = "company" | "user" | "team";

export type CompanyExplorerFolder = {
  company_id: string;
  folder_id: string;
  parent_folder_id?: string;
  folder_kind: CompanyExplorerFolderKind;
  system_key?: CompanyExplorerSystemFolderKey;
  name: string;
  default_access?: "edit" | "no_access" | string;
  has_permission_rules?: boolean;
  access_grants?: Array<{ user_id?: string; access_level?: string }>;
  scope_type?: CompanyExplorerFolderScopeType;
  scope_id?: string | null;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export function hasCompanyExplorerFolderPermissionRules(folder: CompanyExplorerFolder): boolean {
  return Boolean(folder.has_permission_rules)
    || folder.default_access === "no_access"
    || (folder.access_grants ?? []).length > 0;
}

export type CompanyExplorerFolderItem = {
  company_id: string;
  folder_id: string;
  item_type: CompanyExplorerItemType;
  item_id: string;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export function isCompanyExplorerFolderKind(value: unknown): value is CompanyExplorerFolderKind {
  return value === "node" || value === "logic_gate" || value === "project";
}

export function isCompanyExplorerItemType(value: unknown): value is CompanyExplorerItemType {
  return isCompanyExplorerFolderKind(value);
}

export function isCompanyExplorerSystemFolderKey(value: unknown): value is CompanyExplorerSystemFolderKey {
  return value === "active_nodes" || value === "active_logic_gates" || value === "active_projects" || value === "history";
}

export function getFolderSubtreeIDs(folders: CompanyExplorerFolder[], rootFolderID: string): Set<string> {
  const ids = new Set<string>();
  if (!rootFolderID) return ids;
  ids.add(rootFolderID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!folder.parent_folder_id) continue;
      if (!ids.has(folder.parent_folder_id) || ids.has(folder.folder_id)) continue;
      ids.add(folder.folder_id);
      changed = true;
    }
  }
  return ids;
}

export function getScopedItemIDs(args: {
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  folderID: string;
  itemType: CompanyExplorerItemType;
}): Set<string> {
  const { folders, folderItems, folderID, itemType } = args;
  if (!folderID) {
    return new Set(folderItems.filter((item) => item.item_type === itemType).map((item) => item.item_id));
  }
  const scopedFolderIDs = getFolderSubtreeIDs(folders, folderID);
  return new Set(
    folderItems
      .filter((item) => item.item_type === itemType && scopedFolderIDs.has(item.folder_id))
      .map((item) => item.item_id),
  );
}