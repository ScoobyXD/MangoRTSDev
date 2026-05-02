import type { NodeRelationship as LogicGateCanvasRelationship, NodeRecord as LogicGateCanvasRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord, NodeRelationship } from "../node-map/shared.js";

export type CompanyExplorerFolderKind = "node" | "logic_gate";

export type CompanyExplorerFolder = {
  company_id: string;
  folder_id: string;
  parent_folder_id?: string;
  folder_kind: CompanyExplorerFolderKind;
  name: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CompanyExplorerFolderItem = {
  company_id: string;
  folder_id: string;
  item_type: CompanyExplorerFolderKind;
  item_id: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export function isCompanyExplorerFolderKind(value: unknown): value is CompanyExplorerFolderKind {
  return value === "node" || value === "logic_gate";
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
  itemType: CompanyExplorerFolderKind;
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
