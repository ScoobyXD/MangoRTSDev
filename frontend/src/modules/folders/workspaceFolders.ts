import type { NodeRelationship as LogicGateCanvasRelationship, NodeRecord as LogicGateCanvasRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord, NodeRelationship } from "../node-map/shared.js";

export type WorkspaceFolderKind = "node" | "logic_gate";

export type WorkspaceFolder = {
  company_id: string;
  folder_id: string;
  parent_folder_id?: string;
  folder_kind: WorkspaceFolderKind;
  name: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type WorkspaceFolderItem = {
  company_id: string;
  folder_id: string;
  item_type: WorkspaceFolderKind;
  item_id: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export function isWorkspaceFolderKind(value: unknown): value is WorkspaceFolderKind {
  return value === "node" || value === "logic_gate";
}

export function getFolderSubtreeIDs(folders: WorkspaceFolder[], rootFolderID: string): Set<string> {
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
  folders: WorkspaceFolder[];
  folderItems: WorkspaceFolderItem[];
  folderID: string;
  itemType: WorkspaceFolderKind;
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
  folders: WorkspaceFolder[];
  folderItems: WorkspaceFolderItem[];
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
  folders: WorkspaceFolder[];
  folderItems: WorkspaceFolderItem[];
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
