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

export type MapFolderCard = {
  company_id: string;
  folder_id: string;
  parent_folder_id?: string;
  folder_kind: CompanyExplorerFolderKind;
  name: string;
  direct_item_count: number;
  child_folder_count: number;
  descendant_item_count: number;
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

export function buildFolderLevelMapProjection<TItem, TRelationship>(args: {
  items: TItem[];
  relationships: TRelationship[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  folderID: string;
  itemType: CompanyExplorerFolderKind;
  getItemID: (item: TItem) => string;
  getRelationshipItemIDs: (relationship: TRelationship) => [string, string];
}): { items: TItem[]; relationships: TRelationship[]; childFolders: MapFolderCard[] } {
  const { items, relationships, folders, folderItems, folderID, itemType, getItemID, getRelationshipItemIDs } = args;
  const parentFolderID = folderID || "";
  const typedFolders = folders.filter((folder) => folder.folder_kind === itemType);
  const typedFolderIDs = new Set(typedFolders.map((folder) => folder.folder_id));
  const placementByItemID = new Map<string, CompanyExplorerFolderItem>();
  const directItemCountByFolderID = new Map<string, number>();
  const childFolderCountByFolderID = new Map<string, number>();
  const parentByFolderID = new Map<string, string>();
  const descendantItemCountByFolderID = new Map<string, number>();

  for (const folder of typedFolders) {
    const parentID = folder.parent_folder_id ?? "";
    parentByFolderID.set(folder.folder_id, parentID);
    childFolderCountByFolderID.set(parentID, (childFolderCountByFolderID.get(parentID) ?? 0) + 1);
    descendantItemCountByFolderID.set(folder.folder_id, 0);
  }

  for (const item of folderItems) {
    if (item.item_type !== itemType) continue;
    placementByItemID.set(item.item_id, item);
    if (!typedFolderIDs.has(item.folder_id)) continue;
    directItemCountByFolderID.set(item.folder_id, (directItemCountByFolderID.get(item.folder_id) ?? 0) + 1);
    descendantItemCountByFolderID.set(item.folder_id, (descendantItemCountByFolderID.get(item.folder_id) ?? 0) + 1);
  }

  // Fold item counts from leaves toward roots in one pass over the folder tree.
  // This gives folder cards useful counts without recursively scanning every
  // folder for every render, which matters once workspaces become very large.
  const remainingChildrenByFolderID = new Map<string, number>();
  const queue: string[] = [];
  for (const folder of typedFolders) {
    const childCount = childFolderCountByFolderID.get(folder.folder_id) ?? 0;
    remainingChildrenByFolderID.set(folder.folder_id, childCount);
    if (childCount === 0) queue.push(folder.folder_id);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const folderIDForCount = queue[index];
    const parentID = parentByFolderID.get(folderIDForCount) ?? "";
    if (!parentID || !typedFolderIDs.has(parentID)) continue;
    descendantItemCountByFolderID.set(parentID, (descendantItemCountByFolderID.get(parentID) ?? 0) + (descendantItemCountByFolderID.get(folderIDForCount) ?? 0));
    const remaining = (remainingChildrenByFolderID.get(parentID) ?? 1) - 1;
    remainingChildrenByFolderID.set(parentID, remaining);
    if (remaining === 0) queue.push(parentID);
  }

  const directItemIDs = new Set<string>();
  for (const item of items) {
    const itemID = getItemID(item);
    if (!itemID) continue;
    const placement = placementByItemID.get(itemID);
    if (parentFolderID) {
      if (placement?.folder_id === parentFolderID) directItemIDs.add(itemID);
      continue;
    }
    if (!placement || !typedFolderIDs.has(placement.folder_id)) directItemIDs.add(itemID);
  }

  const visibleItems = items.filter((item) => directItemIDs.has(getItemID(item)));
  const visibleRelationships = relationships.filter((relationship) => {
    const [a, b] = getRelationshipItemIDs(relationship);
    return directItemIDs.has(a) && directItemIDs.has(b);
  });
  const childFolders = typedFolders
    .filter((folder) => (folder.parent_folder_id ?? "") === parentFolderID)
    .sort((a, b) => a.name.localeCompare(b.name) || a.created_timestamp.localeCompare(b.created_timestamp))
    .map((folder) => ({
      company_id: folder.company_id,
      folder_id: folder.folder_id,
      parent_folder_id: folder.parent_folder_id,
      folder_kind: folder.folder_kind,
      name: folder.name,
      direct_item_count: directItemCountByFolderID.get(folder.folder_id) ?? 0,
      child_folder_count: childFolderCountByFolderID.get(folder.folder_id) ?? 0,
      descendant_item_count: descendantItemCountByFolderID.get(folder.folder_id) ?? 0,
    }));

  return { items: visibleItems, relationships: visibleRelationships, childFolders };
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
