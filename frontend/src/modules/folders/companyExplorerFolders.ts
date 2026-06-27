import type { NodeRelationship as LogicGateCanvasRelationship, NodeRecord as LogicGateCanvasRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord, NodeRelationship } from "../node-map/shared.js";

export type CompanyExplorerFolderKind = "node" | "logic_gate" | "project";
export type CompanyExplorerItemType = CompanyExplorerFolderKind | "kanban";
export type CompanyExplorerSystemFolderKey = "kanban_boards" | "active_nodes" | "active_logic_gates" | "active_projects" | "history";
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
  return isCompanyExplorerFolderKind(value) || value === "kanban";
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

export function filterNodeGraphToFolderScope(args: {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  folderID: string;
}): { nodes: NodeRecord[]; relationships: NodeRelationship[] } {
  const { nodes, relationships, folders, folderItems, folderID } = args;
  if (!folderID) return { nodes, relationships };
  const itemIDs = getScopedItemIDs({ folders, folderItems, folderID, itemType: "node" });
  const filteredNodes = nodes.filter((node) => itemIDs.has(node.node_id));
  const visible = new Set(filteredNodes.map((node) => node.node_id));
  return {
    nodes: filteredNodes,
    relationships: relationships.filter((relationship) => visible.has(relationship.node_id_a) && visible.has(relationship.node_id_b)),
  };
}

export function filterLogicGateGraphToFolderScope(args: {
  nodes: LogicGateCanvasRecord[];
  relationships: LogicGateCanvasRelationship[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  folderID: string;
}): { nodes: LogicGateCanvasRecord[]; relationships: LogicGateCanvasRelationship[] } {
  const { nodes, relationships, folders, folderItems, folderID } = args;
  if (!folderID) return { nodes, relationships };
  const itemIDs = getScopedItemIDs({ folders, folderItems, folderID, itemType: "logic_gate" });
  const filteredNodes = nodes.filter((node) => itemIDs.has(node.node_id));
  const visible = new Set(filteredNodes.map((node) => node.node_id));
  return {
    nodes: filteredNodes,
    relationships: relationships.filter((relationship) => visible.has(relationship.node_id_a) && visible.has(relationship.node_id_b)),
  };
}

export function resolveScopedMapSelectionFallback(args: {
  selectedID: string;
  visibleItemIDs: Iterable<string>;
  knownItemIDs: Iterable<string>;
  explorerRequestedID?: string;
}): string | null {
  if (!args.selectedID) return null;
  const visibleItemIDs = args.visibleItemIDs instanceof Set ? args.visibleItemIDs : new Set(args.visibleItemIDs);
  if (visibleItemIDs.has(args.selectedID)) return null;

  // Explorer intent is stronger than the map's current filtered projection.
  // During a folder switch React can render one tick where the new selection is
  // active but the old folder's nodes are still visible. In that tick we must
  // not replace the user's click with "the first visible node", or the map will
  // broadcast that fallback back to Explorer as if it were a real map click.
  if (args.explorerRequestedID === args.selectedID) return null;

  // If the item still exists in the workspace, keep the semantic selection even
  // when the active folder scope hides it. Picking a fallback is only safe after
  // the selected item is actually absent from the known graph snapshot.
  const knownItemIDs = args.knownItemIDs instanceof Set ? args.knownItemIDs : new Set(args.knownItemIDs);
  if (knownItemIDs.has(args.selectedID)) return null;

  return Array.from(visibleItemIDs)[0] ?? "";
}

export function resolveMapSelectionAfterGraphLoad(args: {
  currentSelectedID: string;
  restoredSelectedID: string;
  visibleItemIDs: Iterable<string>;
  knownItemIDs: Iterable<string>;
  explorerRequestedID?: string;
  hasExplorerNavigationIntent?: boolean;
}): string | null {
  const visibleItemIDs = args.visibleItemIDs instanceof Set ? args.visibleItemIDs : new Set(args.visibleItemIDs);
  const knownItemIDs = args.knownItemIDs instanceof Set ? args.knownItemIDs : new Set(args.knownItemIDs);
  const currentSelectedID = args.currentSelectedID.trim();

  // The async graph load can finish after an Explorer click. In that case the
  // selected ID in memory is fresher than the load's stale closure, so keep it
  // instead of restoring an older cached map selection or picking row zero.
  if (currentSelectedID && (knownItemIDs.has(currentSelectedID) || args.explorerRequestedID === currentSelectedID)) {
    return null;
  }

  if (args.hasExplorerNavigationIntent) return null;

  const restoredSelectedID = args.restoredSelectedID.trim();
  if (restoredSelectedID && visibleItemIDs.has(restoredSelectedID)) return restoredSelectedID;

  return Array.from(visibleItemIDs)[0] ?? "";
}
