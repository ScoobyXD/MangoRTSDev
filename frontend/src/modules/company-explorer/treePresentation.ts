import type { CompanyExplorerFolder, CompanyExplorerFolderItem, CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";

export type ExplorerTreeEntityKind = "folder" | "node" | "logic_gate";

export type ExplorerCreationContextRow = {
  kind: ExplorerTreeEntityKind;
  nodeID?: string;
  logicGateID?: string;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
};

export type ExplorerDropPayload = {
  kind: ExplorerTreeEntityKind | "batch";
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  itemID?: string;
  itemType?: CompanyExplorerFolderKind;
  items?: ExplorerDropPayloadItem[];
};

export type ExplorerDropPayloadItem = {
  itemID: string;
  itemType: CompanyExplorerFolderKind;
};

export type ExplorerDropTarget = {
  folderID: string;
  folderKind: CompanyExplorerFolderKind;
  treeID: string;
};

export type ExplorerRowDropPlacement = "before" | "after";

export type ExplorerOrderRow = {
  id: string;
  position: number;
  createdTimestamp: string;
};

export type ExplorerOrderUpdate = {
  rowID: string;
  position: number;
};

export type ExplorerKeyboardRow = {
  id: string;
  kind: ExplorerTreeEntityKind;
};

export type ExplorerKeyboardNavigationResult = {
  handled: boolean;
  selectedTreeID?: string;
  expandedIDs?: Set<string>;
};

export type ExplorerSelectionDomain = "node" | "logic_gate" | "folder" | "root";

export type ExplorerFindEntity = {
  kind: "node" | "logic_gate";
  id: string;
};

export type ExplorerFindSelection = {
  selectedTreeIDs: string[];
  primaryTreeID: string;
  primaryEntity: ExplorerFindEntity | null;
  expandedTreeIDs: Set<string>;
};

export type ExplorerCreationTargets = {
  preferredFolderKind: CompanyExplorerFolderKind;
  preferredFolderParentID: string;
  nodeFolderParentID: string;
  logicGateFolderParentID: string;
  nodeParentFolderID: string;
  logicGateParentFolderID: string;
};

export const EXPLORER_DEFAULT_EXPANDED_ROW_IDS = ["folder-root"] as const;
export const EXPLORER_ROOT_ROW_ORDER = ["folder-root"] as const;
export const EXPLORER_ROOT_ROW_LABELS = {
  "folder-root": "Company",
} as const;

export function formatExplorerFolderLabel(name: string): string {
  return name;
}

export function getExplorerDropPayloadItems(payload?: ExplorerDropPayload | null): ExplorerDropPayloadItem[] {
  if (!payload) return [];
  if (payload.kind === "batch" && Array.isArray(payload.items)) {
    const items: ExplorerDropPayloadItem[] = [];
    const seen = new Set<string>();
    for (const item of payload.items) {
      if (!item?.itemID || !item.itemType) continue;
      const key = `${item.itemType}:${item.itemID}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ itemID: item.itemID, itemType: item.itemType });
    }
    return items;
  }
  if (payload.itemID && payload.itemType) return [{ itemID: payload.itemID, itemType: payload.itemType }];
  return [];
}

export function getExplorerDropPayloadItemType(payload?: ExplorerDropPayload | null): CompanyExplorerFolderKind | null {
  const items = getExplorerDropPayloadItems(payload);
  if (items.length === 0) return null;
  const itemType = items[0].itemType;
  return items.every((item) => item.itemType === itemType) ? itemType : null;
}

export function resolveExplorerDropTarget(row?: ExplorerCreationContextRow | null, payload?: ExplorerDropPayload | null): ExplorerDropTarget | null {
  if (!row || !payload || !row.folderID || !row.folderKind) return null;

  // Drag events fire on the row under the pointer. A file row already carries
  // its containing folderID, so users can drop anywhere inside that visible
  // folder section without us scanning the DOM or the full tree on every hover.
  if (payload.kind === "folder") {
    if (!payload.folderID || payload.folderID === row.folderID || payload.folderKind !== row.folderKind) return null;
    return { folderID: row.folderID, folderKind: row.folderKind, treeID: `workspace-folder-${row.folderID}` };
  }

  if (getExplorerDropPayloadItemType(payload) !== row.folderKind) return null;
  return { folderID: row.folderID, folderKind: row.folderKind, treeID: `workspace-folder-${row.folderID}` };
}

export function sortExplorerOrderRows<T extends ExplorerOrderRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.createdTimestamp.localeCompare(b.createdTimestamp) || a.id.localeCompare(b.id));
}

function compactExplorerOrderRows(rows: ExplorerOrderRow[]): ExplorerOrderUpdate[] {
  return rows.map((row, index) => ({ rowID: row.id, position: (index + 1) * 1000 }));
}

export function buildExplorerRowReorderPlan(
  rows: ExplorerOrderRow[],
  draggedRowID: string,
  targetRowID: string,
  placement: ExplorerRowDropPlacement,
): { rows: ExplorerOrderRow[]; updates: ExplorerOrderUpdate[] } {
  return buildExplorerRowBatchReorderPlan(rows, [draggedRowID], targetRowID, placement);
}

export function buildExplorerRowBatchReorderPlan(
  rows: ExplorerOrderRow[],
  draggedRowIDs: string[],
  targetRowID: string,
  placement: ExplorerRowDropPlacement,
): { rows: ExplorerOrderRow[]; updates: ExplorerOrderUpdate[] } {
  const sorted = sortExplorerOrderRows(rows);
  const orderedDraggedIDs = Array.from(new Set(draggedRowIDs.map((rowID) => rowID.trim()).filter(Boolean)));
  if (orderedDraggedIDs.length === 0 || orderedDraggedIDs.includes(targetRowID)) return { rows: sorted, updates: [] };

  const byID = new Map(sorted.map((row) => [row.id, row]));
  const draggedRows = orderedDraggedIDs.map((rowID) => byID.get(rowID)).filter((row): row is ExplorerOrderRow => Boolean(row));
  if (draggedRows.length === 0) return { rows: sorted, updates: [] };

  const draggedIDSet = new Set(draggedRows.map((row) => row.id));
  const withoutDragged = sorted.filter((row) => !draggedIDSet.has(row.id));
  const targetIndex = withoutDragged.findIndex((row) => row.id === targetRowID);
  if (targetIndex < 0) return { rows: sorted, updates: [] };

  const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  const reordered = [
    ...withoutDragged.slice(0, insertIndex),
    ...draggedRows,
    ...withoutDragged.slice(insertIndex),
  ];
  const prev = reordered[insertIndex - 1];
  const next = reordered[insertIndex + draggedRows.length];
  const updatedByID = new Map<string, ExplorerOrderRow>();

  const applySparsePositions = (positions: number[]): ExplorerOrderUpdate[] => {
    return draggedRows.map((row, index) => {
      const updated = { ...row, position: positions[index] };
      updatedByID.set(row.id, updated);
      return { rowID: row.id, position: updated.position };
    });
  };

  let updates: ExplorerOrderUpdate[];
  if (prev && next && next.position - prev.position > draggedRows.length) {
    const step = Math.floor((next.position - prev.position) / (draggedRows.length + 1));
    updates = applySparsePositions(draggedRows.map((_, index) => prev.position + step * (index + 1)));
  } else if (prev && !next) {
    updates = applySparsePositions(draggedRows.map((_, index) => prev.position + 1000 * (index + 1)));
  } else if (!prev && next && next.position > draggedRows.length) {
    const step = Math.floor(next.position / (draggedRows.length + 1));
    updates = applySparsePositions(draggedRows.map((_, index) => step * (index + 1)));
  } else {
    updates = compactExplorerOrderRows(reordered);
    const byID = new Map(updates.map((update) => [update.rowID, update.position]));
    for (const row of reordered) updatedByID.set(row.id, { ...row, position: byID.get(row.id) ?? row.position });
  }

  return {
    rows: sortExplorerOrderRows(reordered.map((row) => updatedByID.get(row.id) ?? row)),
    updates,
  };
}

export function resolveExplorerCreationTargets(row?: ExplorerCreationContextRow | null): ExplorerCreationTargets {
  const nodeParentFolderID = row?.folderKind === "node" || row?.kind === "node" ? row.folderID ?? "" : "";
  const logicGateParentFolderID = row?.folderKind === "logic_gate" || row?.kind === "logic_gate" ? row.folderID ?? "" : "";
  const nodeFolderParentID = nodeParentFolderID;
  const logicGateFolderParentID = logicGateParentFolderID;
  const preferredFolderKind: CompanyExplorerFolderKind = row?.folderKind === "logic_gate" || row?.kind === "logic_gate" ? "logic_gate" : "node";

  return {
    preferredFolderKind,
    preferredFolderParentID: preferredFolderKind === "logic_gate" ? logicGateParentFolderID : nodeParentFolderID,
    nodeFolderParentID,
    logicGateFolderParentID,
    nodeParentFolderID,
    logicGateParentFolderID,
  };
}

export function resolveExplorerDeleteTarget(row?: ExplorerCreationContextRow | null):
  | { kind: "folder"; id: string; folderKind: CompanyExplorerFolderKind }
  | { kind: "node"; id: string }
  | { kind: "logic_gate"; id: string }
  | null {
  if (!row) return null;
  if (row.kind === "folder" && row.folderID && row.folderKind) return { kind: "folder", id: row.folderID, folderKind: row.folderKind };
  if (row.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  return null;
}

export function resolveExplorerRootDropTarget(row?: ExplorerCreationContextRow | null, payload?: ExplorerDropPayload | null): ExplorerDropTarget | null {
  if (!row || row.kind !== "folder" || row.folderID || !payload || payload.kind !== "folder" || !payload.folderID || !payload.folderKind) return null;
  return { folderID: "", folderKind: payload.folderKind, treeID: "folder-root" };
}

export function resolveExplorerRenameTarget(row?: ExplorerCreationContextRow | null):
  | { kind: "folder"; id: string }
  | { kind: "node"; id: string }
  | { kind: "logic_gate"; id: string }
  | null {
  if (!row) return null;
  if (row.kind === "folder" && row.folderID) return { kind: "folder", id: row.folderID };
  if (row.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  return null;
}

export function resolveExplorerClickSelection(input: {
  orderedIDs: string[];
  previousSelectedIDs: Set<string>;
  anchorID: string;
  clickedID: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}): { selectedIDs: Set<string>; anchorID: string } {
  const { orderedIDs, previousSelectedIDs, anchorID, clickedID, shiftKey, ctrlKey } = input;
  if (!clickedID) return { selectedIDs: new Set(previousSelectedIDs), anchorID };

  if (shiftKey && anchorID) {
    const anchorIndex = orderedIDs.indexOf(anchorID);
    const clickedIndex = orderedIDs.indexOf(clickedID);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const range = orderedIDs.slice(start, end + 1);
      // Shift-click is additive in Company Explorer: users often build a
      // precise set with Ctrl, then add a visible range without losing it.
      const selectedIDs = new Set(previousSelectedIDs);
      for (const id of range) selectedIDs.add(id);
      return { selectedIDs, anchorID };
    }
  }

  if (ctrlKey) {
    const selectedIDs = new Set(previousSelectedIDs);
    if (selectedIDs.has(clickedID)) selectedIDs.delete(clickedID);
    else selectedIDs.add(clickedID);
    return { selectedIDs, anchorID: clickedID };
  }

  return { selectedIDs: new Set([clickedID]), anchorID: clickedID };
}

export function resolveExplorerKeyboardNavigation(input: {
  rows: ExplorerKeyboardRow[];
  selectedTreeID: string;
  expandedIDs: Set<string>;
  key: string;
}): ExplorerKeyboardNavigationResult {
  const { rows, selectedTreeID, expandedIDs, key } = input;
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(key)) return { handled: false };

  const currentIndex = Math.max(0, rows.findIndex((row) => row.id === selectedTreeID));
  const current = rows[currentIndex];
  if (!current) return { handled: false };

  if (key === "ArrowDown" || key === "ArrowUp") {
    const nextIndex = key === "ArrowDown"
      ? Math.min(rows.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    return { handled: true, selectedTreeID: rows[nextIndex]?.id ?? current.id };
  }

  if (current.kind !== "folder") return { handled: false };
  const nextExpanded = new Set(expandedIDs);
  if (key === "ArrowRight") nextExpanded.add(current.id);
  if (key === "ArrowLeft") nextExpanded.delete(current.id);
  return { handled: true, expandedIDs: nextExpanded };
}

export function buildExplorerFindSelection(input: {
  entities: ExplorerFindEntity[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  nodeIDs?: Iterable<string>;
  logicGateIDs?: Iterable<string>;
  currentExpandedIDs?: Iterable<string>;
}): ExplorerFindSelection {
  const selectedTreeIDs: string[] = [];
  const seenTreeIDs = new Set<string>();
  const expandedTreeIDs = new Set(input.currentExpandedIDs ?? []);
  expandedTreeIDs.add("folder-root");

  const folderByID = new Map(input.folders.map((folder) => [folder.folder_id, folder]));
  const itemFolderByKey = new Map<string, string>();
  for (const item of input.folderItems) {
    if (!item.item_id || !item.item_type) continue;
    itemFolderByKey.set(`${item.item_type}:${item.item_id}`, item.folder_id);
  }

  const knownNodeIDs = input.nodeIDs ? new Set(input.nodeIDs) : null;
  const knownLogicGateIDs = input.logicGateIDs ? new Set(input.logicGateIDs) : null;
  let primaryEntity: ExplorerFindEntity | null = null;

  const expandContainingFolderPath = (folderID: string | undefined) => {
    let currentFolderID = folderID ?? "";
    const visited = new Set<string>();
    while (currentFolderID && !visited.has(currentFolderID)) {
      visited.add(currentFolderID);
      expandedTreeIDs.add(`workspace-folder-${currentFolderID}`);
      currentFolderID = folderByID.get(currentFolderID)?.parent_folder_id ?? "";
    }
  };

  for (const entity of input.entities) {
    const id = entity.id.trim();
    if (!id) continue;
    if (entity.kind === "node" && knownNodeIDs && !knownNodeIDs.has(id)) continue;
    if (entity.kind === "logic_gate" && knownLogicGateIDs && !knownLogicGateIDs.has(id)) continue;

    const treeID = entity.kind === "node" ? `node-${id}` : `logic-gate-${id}`;
    if (seenTreeIDs.has(treeID)) continue;
    seenTreeIDs.add(treeID);
    selectedTreeIDs.push(treeID);
    if (!primaryEntity) primaryEntity = { kind: entity.kind, id };

    // Folder expansion is derived from indexed folder/item rows, not visible
    // DOM rows. That keeps "find" bounded by the selected entity batch and
    // still works when every ancestor folder starts collapsed.
    expandContainingFolderPath(itemFolderByKey.get(`${entity.kind}:${id}`));
  }

  return {
    selectedTreeIDs,
    primaryTreeID: selectedTreeIDs[0] ?? "",
    primaryEntity,
    expandedTreeIDs,
  };
}

export function shouldAcceptMapSelectionAfterExplorerSelection(input: {
  incomingDomain: "node" | "logic_gate";
  currentDomain: ExplorerSelectionDomain;
  localSelectionChangedAt: number;
  incomingChangedAt?: number;
  now: number;
  staleWindowMs?: number;
}): boolean {
  const staleWindowMs = input.staleWindowMs ?? 750;
  if (input.currentDomain === input.incomingDomain || input.currentDomain === "folder" || input.currentDomain === "root") return true;
  if (input.localSelectionChangedAt <= 0) return true;

  // Map selection events are asynchronous. If Explorer just crossed between
  // node and logic-gate domains, older map events are echoes, not new intent.
  if (typeof input.incomingChangedAt === "number" && input.incomingChangedAt > 0) {
    return input.incomingChangedAt > input.localSelectionChangedAt;
  }
  return input.now - input.localSelectionChangedAt > staleWindowMs;
}
