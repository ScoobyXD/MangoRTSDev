import type { CompanyExplorerFolder, CompanyExplorerFolderItem, CompanyExplorerFolderKind, CompanyExplorerFolderScopeType, CompanyExplorerItemType, CompanyExplorerSystemFolderKey } from "../folders/companyExplorerFolders.js";
import type { CompanyExplorerV2EntityType } from "./companyExplorerLazyApi.js";

export type ExplorerTreeEntityKind = "folder" | "node" | "logic_gate" | "project" | "kanban";

export type ExplorerCreationContextRow = {
  id?: string;
  kind: ExplorerTreeEntityKind;
  nodeID?: string;
  logicGateID?: string;
  projectID?: string;
  kanbanBoardID?: string;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  entityID?: string;
  resourceID?: string;
  entityType?: CompanyExplorerV2EntityType;
  edgeID?: string;
  parentEntityID?: string;
  folderScopeType?: CompanyExplorerFolderScopeType;
  folderScopeID?: string;
  systemKey?: CompanyExplorerSystemFolderKey;
  syntheticKind?: string;
  GVICRole?: string;
};

export type ExplorerDropPayload = {
  kind: ExplorerTreeEntityKind | "batch";
  sourceTreeID?: string;
  folderID?: string;
  folderKind?: CompanyExplorerFolderKind;
  itemID?: string;
  itemType?: CompanyExplorerItemType;
  items?: ExplorerDropPayloadItem[];
};

export type ExplorerDropPayloadItem = {
  itemID: string;
  itemType: CompanyExplorerItemType;
  treeID?: string;
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

export type ExplorerSelectionDomain = "node" | "logic_gate" | "project" | "kanban" | "folder" | "root";

export type ExplorerPublishedSelectionKind = "node" | "logic_gate" | "project" | "kanban" | "folder";

export type ExplorerPublishedSelection = {
  entityKind: ExplorerPublishedSelectionKind;
  entityID: string;
  selectedNodeID: string;
  selectedLogicGateID: string;
  selectedKanbanBoardID: string;
  isLogicGateContext: boolean;
};

export type ExplorerFindEntity = {
  kind: "node" | "logic_gate" | "project";
  id: string;
};

export type ExplorerFindSelection = {
  selectedTreeIDs: string[];
  primaryTreeID: string;
  primaryEntity: ExplorerFindEntity | null;
  expandedTreeIDs: Set<string>;
};

export type ExplorerSearchRow = ExplorerCreationContextRow & {
  label: string;
  depth: number;
  folderLabel?: string;
};

export type ExplorerCreationTargets = {
  preferredFolderKind: CompanyExplorerFolderKind;
  preferredFolderParentID: string;
  folderScopeType?: CompanyExplorerFolderScopeType;
  folderScopeID?: string;
  nodeFolderParentID: string;
  logicGateFolderParentID: string;
  projectFolderParentID: string;
  nodeParentFolderID: string;
  logicGateParentFolderID: string;
  projectParentFolderID: string;
};

export const EXPLORER_INTERNAL_ROOT_ROW_ID = "folder-root";
export const EXPLORER_SYSTEM_KANBAN_FOLDER_ID = "system-folder-kanban-boards";
export const EXPLORER_SYSTEM_ACTIVE_NODES_FOLDER_ID = "system-folder-active-nodes";
export const EXPLORER_SYSTEM_ACTIVE_LOGIC_GATES_FOLDER_ID = "system-folder-active-logic-gates";
export const EXPLORER_SYSTEM_ACTIVE_PROJECTS_FOLDER_ID = "system-folder-active-projects";
export const EXPLORER_SYSTEM_HISTORY_FOLDER_ID = "system-folder-history";
export const EXPLORER_SYSTEM_FOLDER_COLOR = "rgb(71, 85, 105)";
export const EXPLORER_ROOT_ROW_ORDER = [] as const;
export const EXPLORER_ROOT_ROW_LABELS = {} as const;

export function isExplorerSystemFolderKey(value: unknown): value is CompanyExplorerSystemFolderKey {
  return value === "active_nodes" || value === "active_logic_gates" || value === "active_projects" || value === "history";
}

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
      items.push({ itemID: item.itemID, itemType: item.itemType, treeID: item.treeID });
    }
    return items;
  }
  if (payload.itemID && payload.itemType) return [{ itemID: payload.itemID, itemType: payload.itemType, treeID: payload.sourceTreeID }];
  return [];
}

export function getExplorerDropPayloadItemType(payload?: ExplorerDropPayload | null): CompanyExplorerItemType | null {
  const items = getExplorerDropPayloadItems(payload);
  if (items.length === 0) return null;
  const itemType = items[0].itemType;
  return items.every((item) => item.itemType === itemType) ? itemType : null;
}

export function resolveExplorerDropTarget(row?: ExplorerCreationContextRow | null, payload?: ExplorerDropPayload | null): ExplorerDropTarget | null {
  if (!row || !payload || !row.folderID) return null;
  if (row.syntheticKind === "default_scope_folder") return null;
  const isGVICScopedRow = row.syntheticKind === "GVIC_folder" || Boolean(row.GVICRole);
  const genericV2Container = Boolean(row.entityID) && (row.entityType === "company" || row.entityType === "user_group" || row.entityType === "user" || row.entityType === "folder");

  // Drag events fire on the row under the pointer. A file row already carries
  // its containing folderID, so users can drop anywhere inside that visible
  // folder section without us scanning the DOM or the full tree on every hover.
  if (payload.kind === "folder") {
    if (!payload.folderID || payload.folderID === row.folderID) return null;
    if (isGVICScopedRow && payload.folderKind !== row.folderKind) return null;
    const folderKind = row.folderKind ?? payload.folderKind ?? "logic_gate";
    return { folderID: row.folderID, folderKind, treeID: row.id ?? `workspace-folder-${row.folderID}` };
  }

  const itemType = getExplorerDropPayloadItemType(payload);
  if (!itemType || itemType === "kanban") return null;
  if (!genericV2Container && itemType !== row.folderKind) return null;
  return { folderID: row.folderID, folderKind: row.folderKind ?? itemType, treeID: row.id ?? `workspace-folder-${row.folderID}` };
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
  const containingFolderID = row?.folderID ?? "";
  const nodeParentFolderID = containingFolderID;
  const logicGateParentFolderID = containingFolderID;
  const projectParentFolderID = containingFolderID;
  const nodeFolderParentID = nodeParentFolderID;
  const logicGateFolderParentID = row?.folderKind === "logic_gate" ? containingFolderID : "";
  const projectFolderParentID = row?.folderKind === "project" ? containingFolderID : "";
  const preferredFolderKind: CompanyExplorerFolderKind = row?.folderKind ?? (row?.kind === "project" ? "project" : row?.kind === "node" ? "node" : "logic_gate");
  const folderScopeType = row?.folderScopeType;
  const folderScopeID = row?.folderScopeID;

  return {
    preferredFolderKind,
    preferredFolderParentID: preferredFolderKind === "logic_gate" ? logicGateParentFolderID : preferredFolderKind === "project" ? projectParentFolderID : nodeParentFolderID,
    ...(folderScopeType ? { folderScopeType } : {}),
    ...(folderScopeID ? { folderScopeID } : {}),
    nodeFolderParentID,
    logicGateFolderParentID,
    projectFolderParentID,
    nodeParentFolderID,
    logicGateParentFolderID,
    projectParentFolderID,
  };
}

function getExplorerSearchRowsForSelection<T extends ExplorerSearchRow>(rows: T[], selectedRowID: string): T[] {
  const selectedIndex = rows.findIndex((row) => row.id === selectedRowID);
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;
  if (!selected || selected.kind !== "folder") return rows;

  const scopedRows: T[] = [];
  for (let index = selectedIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.depth <= selected.depth) break;
    scopedRows.push(row);
  }
  return scopedRows;
}

function normalizeExplorerSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function explorerSearchFieldMatches(field: string, query: string): boolean {
  const value = normalizeExplorerSearchValue(field);
  if (!value) return false;
  if (value.startsWith(query)) return true;
  if (value.split(/[\s/_-]+/).some((part) => part.startsWith(query))) return true;
  return query.length >= 2 && value.includes(query);
}

function explorerSearchRowMatches(row: ExplorerSearchRow, query: string): boolean {
  if (explorerSearchFieldMatches(row.label, query)) return true;
  if (query.length < 3) return false;
  return [
    row.nodeID ?? "",
    row.logicGateID ?? "",
    row.kanbanBoardID ?? "",
    row.folderID ?? "",
  ].some((field) => normalizeExplorerSearchValue(field).includes(query));
}

export function buildExplorerSearchResults<T extends ExplorerSearchRow>(input: {
  rows: T[];
  selectedRowID: string;
  query: string;
  limit?: number;
}): T[] {
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.max(1, input.limit ?? 16);
  const collect = (rows: T[]): T[] => {
    const matches: T[] = [];
    for (const row of rows) {
      if (!explorerSearchRowMatches(row, query)) continue;
      matches.push(row);
      if (matches.length >= limit) break;
    }
    return matches;
  };

  const scopedRows = getExplorerSearchRowsForSelection(input.rows, input.selectedRowID);
  const scopedMatches = scopedRows.length === input.rows.length ? [] : collect(scopedRows);
  return scopedMatches.length > 0 ? scopedMatches : collect(input.rows);
}

export function buildExplorerSearchViewRows<T extends ExplorerSearchRow & { id: string }>(input: {
  rows: T[];
  query: string;
  includeBranchDescendants?: boolean;
}): T[] {
  const query = input.query.trim().toLowerCase();
  if (!query) return input.rows;

  const includedIDs = new Set<string>();
  const rowStack: T[] = [];
  const includedBranchDepths: number[] = [];
  for (const row of input.rows) {
    const depth = Math.max(0, row.depth);
    while (includedBranchDepths.length > 0 && depth <= includedBranchDepths[includedBranchDepths.length - 1]) {
      includedBranchDepths.pop();
    }
    rowStack.length = depth;
    rowStack[depth] = row;
    if (input.includeBranchDescendants && includedBranchDepths.length > 0) {
      includedIDs.add(row.id);
    }
    if (!explorerSearchRowMatches(row, query)) continue;
    for (const ancestor of rowStack) {
      if (ancestor?.id) includedIDs.add(ancestor.id);
    }
    if (input.includeBranchDescendants && (row.kind === "folder" || row.kind === "logic_gate")) {
      includedBranchDepths.push(depth);
    }
  }

  return input.rows.filter((row) => includedIDs.has(row.id));
}

type ExplorerDeleteTargetV2Metadata = { entityID?: string; entityType?: CompanyExplorerV2EntityType };

export type ExplorerDeleteTarget =
  | ({ kind: "folder"; id: string; folderKind: CompanyExplorerFolderKind } & ExplorerDeleteTargetV2Metadata)
  | ({ kind: "node"; id: string } & ExplorerDeleteTargetV2Metadata)
  | ({ kind: "logic_gate"; id: string } & ExplorerDeleteTargetV2Metadata)
  | ({ kind: "project"; id: string } & ExplorerDeleteTargetV2Metadata)
  | ({ kind: "kanban"; id: string } & ExplorerDeleteTargetV2Metadata);

export function resolveExplorerDeleteTarget(row?: ExplorerCreationContextRow | null): ExplorerDeleteTarget | null {
  if (!row) return null;
  if (row.systemKey) return null;
  const entityID = row.entityID?.trim() ?? "";
  const entityType = row.entityType;
  const v2Metadata = entityID && entityType ? { entityID, entityType } : {};
  if (row.kind === "folder" && row.folderID && row.folderKind && (!entityType || entityType === "folder")) {
    return { kind: "folder", id: entityType === "folder" ? entityID : row.folderID, folderKind: row.folderKind, ...v2Metadata };
  }
  if (row.kind === "node") {
    const id = entityType === "node" ? row.resourceID : row.nodeID;
    return id ? { kind: "node", id, ...v2Metadata } : null;
  }
  if (row.kind === "logic_gate") {
    const id = entityType === "logic_gate" ? row.resourceID : row.logicGateID;
    return id ? { kind: "logic_gate", id, ...v2Metadata } : null;
  }
  if (row.kind === "project") {
    const id = entityType === "project" ? row.resourceID : row.projectID;
    return id ? { kind: "project", id, ...v2Metadata } : null;
  }
  if (row.kind === "kanban" && row.kanbanBoardID) return { kind: "kanban", id: row.kanbanBoardID };
  return null;
}

export function resolveExplorerRootDropTarget(row?: ExplorerCreationContextRow | null, payload?: ExplorerDropPayload | null): ExplorerDropTarget | null {
  if (!row || row.kind !== "folder" || row.folderID || !payload || payload.kind !== "folder" || !payload.folderID || !payload.folderKind) return null;
  if (row.id && row.id !== EXPLORER_INTERNAL_ROOT_ROW_ID) return null;
  return { folderID: "", folderKind: payload.folderKind, treeID: "folder-root" };
}

export function resolveExplorerRenameTarget(row?: ExplorerCreationContextRow | null):
  | { kind: "folder"; id: string }
  | { kind: "node"; id: string }
  | { kind: "logic_gate"; id: string }
  | { kind: "project"; id: string }
  | null {
  if (!row) return null;
  if (row.systemKey) return null;
  if (row.kind === "folder" && row.folderID && (!row.entityType || row.entityType === "folder")) return { kind: "folder", id: row.folderID };
  if (row.kind === "node" && row.nodeID) return { kind: "node", id: row.nodeID };
  if (row.kind === "logic_gate" && row.logicGateID) return { kind: "logic_gate", id: row.logicGateID };
  if (row.kind === "project" && row.projectID) return { kind: "project", id: row.projectID };
  return null;
}

export function resolveExplorerPublishedSelection(input: {
  selectedTreeID: string;
  selectedNodeID: string;
  selectedLogicGateID: string;
  selectedKanbanBoardID: string;
  selectedFolderID: string;
  selectedFolderKind?: CompanyExplorerFolderKind;
  targetFrameKind?: string | null;
}): ExplorerPublishedSelection {
  const treeID = input.selectedTreeID.trim();
  let entityKind: ExplorerPublishedSelectionKind = "folder";
  let entityID = input.selectedFolderID;

  if (treeID.startsWith("node-")) {
    entityKind = "node";
    entityID = treeID.slice("node-".length) || input.selectedNodeID;
  } else if (treeID.startsWith("logic-gate-")) {
    entityKind = "logic_gate";
    entityID = treeID.slice("logic-gate-".length) || input.selectedLogicGateID;
  } else if (treeID.startsWith("project-")) {
    entityKind = "project";
    entityID = treeID.slice("project-".length);
  } else if (treeID.startsWith("kanban-")) {
    entityKind = "kanban";
    entityID = treeID.slice("kanban-".length) || input.selectedKanbanBoardID;
  } else if (input.selectedKanbanBoardID) {
    entityKind = "kanban";
    entityID = input.selectedKanbanBoardID;
  } else if (input.selectedLogicGateID) {
    entityKind = "logic_gate";
    entityID = input.selectedLogicGateID;
  } else if (input.selectedNodeID) {
    entityKind = "node";
    entityID = input.selectedNodeID;
  }

  const selectedNodeID = entityKind === "node" ? entityID : "";
  const selectedLogicGateID = entityKind === "logic_gate" ? entityID : "";
  const selectedKanbanBoardID = entityKind === "kanban" ? entityID : "";
  const isLogicGateContext = entityKind === "logic_gate"
    || (entityKind === "folder" && input.selectedFolderKind === "logic_gate")
    || (entityKind === "folder" && input.targetFrameKind === "logic-map");

  return {
    entityKind,
    entityID,
    selectedNodeID,
    selectedLogicGateID,
    selectedKanbanBoardID,
    isLogicGateContext,
  };
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

  const selectedIndex = rows.findIndex((row) => row.id === selectedTreeID);
  if (selectedIndex < 0) {
    if ((key === "ArrowDown" || key === "ArrowUp") && rows[0]) return { handled: true, selectedTreeID: rows[0].id };
    return { handled: false };
  }
  const currentIndex = selectedIndex;
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
  projectIDs?: Iterable<string>;
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
  const knownProjectIDs = input.projectIDs ? new Set(input.projectIDs) : null;
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
    if (entity.kind === "project" && knownProjectIDs && !knownProjectIDs.has(id)) continue;

    const treeID = entity.kind === "node" ? `node-${id}` : entity.kind === "logic_gate" ? `logic-gate-${id}` : `project-${id}`;
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
  localIntentHoldMs?: number;
  staleWindowMs?: number;
}): boolean {
  const localIntentHoldMs = input.localIntentHoldMs ?? 180;
  const staleWindowMs = input.staleWindowMs ?? 750;
  if (input.localSelectionChangedAt <= 0) return true;
  if (input.now - input.localSelectionChangedAt <= localIntentHoldMs) return false;

  // Map selection events are asynchronous. After any local Explorer click,
  // older map events are echoes, even when they are in the same node/gate
  // domain. This keeps rapid Explorer navigation from briefly reselecting the
  // previous map item.
  if (typeof input.incomingChangedAt === "number" && input.incomingChangedAt > 0) {
    return input.incomingChangedAt > input.localSelectionChangedAt;
  }
  return input.now - input.localSelectionChangedAt > staleWindowMs;
}

export function shouldAcceptClearedMapSelectionAfterExplorerSelection(input: {
  currentDomain: ExplorerSelectionDomain;
  localSelectionChangedAt: number;
  incomingChangedAt?: number;
  now: number;
  staleWindowMs?: number;
}): boolean {
  if (input.localSelectionChangedAt <= 0 || input.currentDomain === "root") return true;
  if (typeof input.incomingChangedAt === "number" && input.incomingChangedAt > 0 && input.incomingChangedAt <= input.localSelectionChangedAt) return false;
  return input.now - input.localSelectionChangedAt > (input.staleWindowMs ?? 750);
}

export function getExplorerScrollTopForRow(input: {
  rowIndex: number;
  rowHeight: number;
  rowsTopOffset: number;
  currentScrollTop: number;
  viewportHeight: number;
  maxScrollTop?: number;
  bottomPadding?: number;
  align?: "nearest" | "center";
}): number {
  const rowTop = input.rowsTopOffset + input.rowIndex * input.rowHeight;
  const rowBottom = rowTop + input.rowHeight;
  const currentTop = input.currentScrollTop;
  const bottomPadding = Math.max(0, input.bottomPadding ?? 0);
  const currentBottom = currentTop + input.viewportHeight - bottomPadding;
  let nextScrollTop = currentTop;

  if (input.align === "center") {
    nextScrollTop = rowTop - Math.max(0, input.viewportHeight - input.rowHeight) / 2;
    const maxScrollTop = Math.max(0, input.maxScrollTop ?? Number.POSITIVE_INFINITY);
    return Math.min(maxScrollTop, Math.max(0, Math.round(nextScrollTop)));
  }

  if (rowTop < currentTop) nextScrollTop = rowTop;
  else if (rowBottom > currentBottom) nextScrollTop = rowBottom - input.viewportHeight + bottomPadding;

  const maxScrollTop = Math.max(0, input.maxScrollTop ?? Number.POSITIVE_INFINITY);
  return Math.min(maxScrollTop, Math.max(0, Math.round(nextScrollTop)));
}
