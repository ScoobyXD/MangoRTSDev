import { getNodeTitle, type NodeRecord } from "../node-map/shared.js";
import { getNodeTitle as getLogicGateTitle, type NodeRecord as LogicGateRecord } from "../logic-gate-map/shared.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem, CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";
import { getKanbanBoardDisplayTitle, type KanbanBoard } from "../kanban/shared.js";
import {
  EXPLORER_SYSTEM_ACTIVE_NODES_FOLDER_ID,
  EXPLORER_SYSTEM_HISTORY_FOLDER_ID,
  EXPLORER_SYSTEM_KANBAN_FOLDER_ID,
  formatExplorerFolderLabel,
} from "./treePresentation.js";
import { sortExplorerRowsByPosition, TREE_ROW_POSITION_STEP } from "./companyExplorerDragDrop.js";
import type { ExplorerTreeNode } from "./companyExplorerTypes.js";

type BuildCompanyExplorerTreeRowsInput = {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  kanbanBoards: KanbanBoard[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rootRowOrder: Record<string, number>;
  specialFolderPlacements?: Record<string, { parentFolderID?: string; position?: number }>;
  folderSystemParents?: Record<string, string>;
  todayISODate?: string;
};

const SYSTEM_FOLDER_CREATED_TIMESTAMP = "0000-00-00T00:00:00.000Z";
const ROOT_ROW_POSITION_OFFSET: Record<CompanyExplorerFolderKind, number> = {
  node: 0,
  logic_gate: 100_000_000,
};

function getLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeISODate(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

export function buildCompanyExplorerTreeRows({
  expanded,
  nodes,
  logicGates,
  kanbanBoards,
  folders,
  folderItems,
  rootRowOrder,
  specialFolderPlacements = {},
  folderSystemParents = {},
  todayISODate,
}: BuildCompanyExplorerTreeRowsInput): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  const currentDate = normalizeISODate(todayISODate) || getLocalISODate();
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
  const kanbanBoardByID = new Map(kanbanBoards.map((board) => [board.board_id, board]));
  const folderByID = new Map(folders.map((folder) => [folder.folder_id, folder]));
  const folderPathLabelByID = new Map<string, string>();
  const getFolderPathLabel = (folderID: string): string => {
    if (!folderID) return "";
    const cached = folderPathLabelByID.get(folderID);
    if (cached !== undefined) return cached;
    const parts: string[] = [];
    let currentID = folderID;
    const seen = new Set<string>();
    while (currentID && !seen.has(currentID)) {
      seen.add(currentID);
      const folder = folderByID.get(currentID);
      if (!folder) break;
      parts.push(formatExplorerFolderLabel(folder.name));
      currentID = folder.parent_folder_id ?? "";
    }
    const label = parts.reverse().join(" / ");
    folderPathLabelByID.set(folderID, label);
    return label;
  };
  const assignedNodes = new Set(folderItems.filter((item) => item.item_type === "node").map((item) => item.item_id));
  const assignedLogicGates = new Set(folderItems.filter((item) => item.item_type === "logic_gate").map((item) => item.item_id));
  const foldersByParent = new Map<string, CompanyExplorerFolder[]>();
  const foldersBySystemParent = new Map<string, CompanyExplorerFolder[]>();
  for (const folder of folders) {
    const systemParentID = folderSystemParents[folder.folder_id] ?? "";
    if (systemParentID) {
      const bucket = foldersBySystemParent.get(systemParentID) ?? [];
      bucket.push(folder);
      foldersBySystemParent.set(systemParentID, bucket);
      continue;
    }
    const key = `${folder.folder_kind}:${folder.parent_folder_id ?? ""}`;
    const bucket = foldersByParent.get(key) ?? [];
    bucket.push(folder);
    foldersByParent.set(key, bucket);
  }
  const itemsByFolder = new Map<string, CompanyExplorerFolderItem[]>();
  for (const item of folderItems) {
    const key = item.folder_id;
    const bucket = itemsByFolder.get(key) ?? [];
    bucket.push(item);
    itemsByFolder.set(key, bucket);
  }

  const systemFolderDefinitions = [
    { id: EXPLORER_SYSTEM_KANBAN_FOLDER_ID, label: "Kanban Boards", defaultPosition: 100 },
    { id: EXPLORER_SYSTEM_ACTIVE_NODES_FOLDER_ID, label: "Active Nodes", defaultPosition: 200 },
    { id: EXPLORER_SYSTEM_HISTORY_FOLDER_ID, label: "History", defaultPosition: 300 },
  ] as const;

  const getSystemFolderLabel = (systemFolderID: string): string => systemFolderDefinitions.find((item) => item.id === systemFolderID)?.label ?? "Special Folder";
  const getSpecialFolderParentID = (systemFolderID: string): string => {
    const parentFolderID = specialFolderPlacements[systemFolderID]?.parentFolderID ?? "";
    return parentFolderID && folderByID.has(parentFolderID) ? parentFolderID : "";
  };

  const buildSystemFolderRows = (parentFolderID: string, depth: number): ExplorerTreeNode[] => {
    return sortExplorerRowsByPosition(systemFolderDefinitions
      .filter((definition) => getSpecialFolderParentID(definition.id) === parentFolderID)
      .map((definition) => {
        const placement = specialFolderPlacements[definition.id];
        const effectiveParentFolderID = getSpecialFolderParentID(definition.id);
        return {
          id: definition.id,
          label: definition.label,
          depth,
          kind: "folder" as const,
          parentFolderID: effectiveParentFolderID,
          systemFolderID: definition.id,
          scopeLevel: depth,
          position: placement?.position ?? rootRowOrder[definition.id] ?? definition.defaultPosition,
          createdTimestamp: SYSTEM_FOLDER_CREATED_TIMESTAMP,
        };
      }));
  };

  const pushSystemFolderChildren = (systemFolderID: string, depth: number) => {
    const label = getSystemFolderLabel(systemFolderID);
    if (systemFolderID === EXPLORER_SYSTEM_KANBAN_FOLDER_ID) {
      let boardPosition = 0;
      for (const board of kanbanBoards) {
        boardPosition += TREE_ROW_POSITION_STEP;
        rows.push({
          id: `system-kanban-${board.board_id}`,
          label: getKanbanBoardDisplayTitle(board),
          depth,
          kind: "kanban",
          kanbanBoardID: board.board_id,
          parentSystemFolderID: systemFolderID,
          folderLabel: label,
          scopeLevel: depth,
          position: boardPosition,
          createdTimestamp: board.created_timestamp,
        });
      }
    }
    if (systemFolderID === EXPLORER_SYSTEM_ACTIVE_NODES_FOLDER_ID) {
      let activePosition = 0;
      for (const node of nodes) {
        const dueDate = normalizeISODate(node.due_date);
        if (!dueDate || dueDate <= currentDate) continue;
        activePosition += TREE_ROW_POSITION_STEP;
        rows.push({
          id: `system-active-node-${node.node_id}`,
          label: getNodeTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          parentSystemFolderID: systemFolderID,
          folderLabel: label,
          scopeLevel: depth,
          position: activePosition,
          createdTimestamp: node.created_timestamp,
        });
      }
    }
    if (systemFolderID === EXPLORER_SYSTEM_HISTORY_FOLDER_ID) {
      let historyPosition = 0;
      for (const node of nodes) {
        const dueDate = normalizeISODate(node.due_date);
        if (!dueDate || dueDate >= currentDate) continue;
        historyPosition += TREE_ROW_POSITION_STEP;
        rows.push({
          id: `system-history-node-${node.node_id}`,
          label: getNodeTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          parentSystemFolderID: systemFolderID,
          folderLabel: label,
          scopeLevel: depth,
          position: historyPosition,
          createdTimestamp: node.created_timestamp,
        });
      }
    }

    for (const folder of sortExplorerRowsByPosition((foldersBySystemParent.get(systemFolderID) ?? []).map((folder) => ({
      id: `workspace-folder-${folder.folder_id}`,
      label: formatExplorerFolderLabel(folder.name),
      depth,
      kind: "folder" as const,
      folderID: folder.folder_id,
      parentFolderID: "",
      parentSystemFolderID: systemFolderID,
      folderKind: folder.folder_kind,
      folderLabel: `${label} / ${formatExplorerFolderLabel(folder.name)}`,
      scopeLevel: depth,
      position: (rootRowOrder[`workspace-folder-${folder.folder_id}`] ?? folder.position) || TREE_ROW_POSITION_STEP,
      createdTimestamp: folder.created_timestamp,
    })))) {
      rows.push(folder);
      if (expanded.has(folder.id) && folder.folderID && folder.folderKind) pushFolderBranch(folder.folderKind, folder.folderID, depth + 1);
    }
  };

  const getRootAwarePosition = (folderKind: CompanyExplorerFolderKind, rowID: string, position: number): number => {
    return rootRowOrder[rowID] ?? position + ROOT_ROW_POSITION_OFFSET[folderKind];
  };

  const buildFolderBranchRows = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number): ExplorerTreeNode[] => {
    const directItems = (itemsByFolder.get(parentFolderID) ?? []).filter((item) => item.item_type === folderKind || item.item_type === "kanban");
    const branchRows: ExplorerTreeNode[] = [];
    let syntheticRootPosition = 0;
    if (parentFolderID === "" && folderKind === "node") {
      for (const node of nodes) {
        if (assignedNodes.has(node.node_id)) continue;
        syntheticRootPosition += TREE_ROW_POSITION_STEP;
        const rowID = `node-${node.node_id}`;
        branchRows.push({
          id: rowID,
          label: getNodeTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          folderID: "",
          folderKind,
          scopeLevel: depth,
          position: getRootAwarePosition(folderKind, rowID, syntheticRootPosition),
          createdTimestamp: node.created_timestamp,
        });
      }
    }
    if (parentFolderID === "" && folderKind === "logic_gate") {
      for (const logicGate of logicGates) {
        if (assignedLogicGates.has(logicGate.logic_gate_id)) continue;
        syntheticRootPosition += TREE_ROW_POSITION_STEP;
        const rowID = `logic-gate-${logicGate.logic_gate_id}`;
        branchRows.push({
          id: rowID,
          label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
          depth,
          kind: "logic_gate",
          logicGateID: logicGate.logic_gate_id,
          folderID: "",
          folderKind,
          scopeLevel: depth,
          position: getRootAwarePosition(folderKind, rowID, syntheticRootPosition),
          createdTimestamp: logicGate.created_timestamp,
        });
      }
    }
    for (const item of directItems) {
      if (item.item_type === "node") {
        const node = nodeByID.get(item.item_id);
        if (node) {
          branchRows.push({
            id: `node-${node.node_id}`,
            label: getNodeTitle(node) || node.node_id,
            depth,
            kind: "node",
            nodeID: node.node_id,
            folderID: parentFolderID,
            folderKind,
            folderLabel: getFolderPathLabel(parentFolderID),
            scopeLevel: depth,
            position: parentFolderID === "" ? getRootAwarePosition(folderKind, `node-${node.node_id}`, item.position || TREE_ROW_POSITION_STEP) : item.position || TREE_ROW_POSITION_STEP,
            createdTimestamp: item.created_timestamp,
          });
        }
      } else if (item.item_type === "logic_gate") {
        const logicGate = logicGateByID.get(item.item_id);
        if (logicGate) {
          branchRows.push({
            id: `logic-gate-${logicGate.logic_gate_id}`,
            label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
            depth,
            kind: "logic_gate",
            logicGateID: logicGate.logic_gate_id,
            folderID: parentFolderID,
            folderKind,
            folderLabel: getFolderPathLabel(parentFolderID),
            scopeLevel: depth,
            position: parentFolderID === "" ? getRootAwarePosition(folderKind, `logic-gate-${logicGate.logic_gate_id}`, item.position || TREE_ROW_POSITION_STEP) : item.position || TREE_ROW_POSITION_STEP,
            createdTimestamp: item.created_timestamp,
          });
        }
      } else {
        const board = kanbanBoardByID.get(item.item_id);
        if (board) {
          branchRows.push({
            id: `kanban-${board.board_id}`,
            label: getKanbanBoardDisplayTitle(board),
            depth,
            kind: "kanban",
            kanbanBoardID: board.board_id,
            folderID: parentFolderID,
            folderKind,
            folderLabel: getFolderPathLabel(parentFolderID),
            scopeLevel: depth,
            position: parentFolderID === "" ? getRootAwarePosition(folderKind, `kanban-${board.board_id}`, item.position || TREE_ROW_POSITION_STEP) : item.position || TREE_ROW_POSITION_STEP,
            createdTimestamp: board.created_timestamp,
          });
        }
      }
    }

    const childFolders = foldersByParent.get(`${folderKind}:${parentFolderID}`) ?? [];
    for (const folder of childFolders) {
      const rowID = `workspace-folder-${folder.folder_id}`;
      branchRows.push({
        id: rowID,
        label: formatExplorerFolderLabel(folder.name),
        depth,
        kind: "folder",
        folderID: folder.folder_id,
        parentFolderID: folder.parent_folder_id ?? "",
        folderKind,
        folderLabel: getFolderPathLabel(folder.folder_id),
        scopeLevel: depth,
        position: parentFolderID === "" ? getRootAwarePosition(folderKind, rowID, folder.position || TREE_ROW_POSITION_STEP) : folder.position || TREE_ROW_POSITION_STEP,
        createdTimestamp: folder.created_timestamp,
      });
    }
    if (parentFolderID) branchRows.push(...buildSystemFolderRows(parentFolderID, depth));

    return sortExplorerRowsByPosition(branchRows);
  };

  const pushFolderBranch = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number) => {
    for (const row of buildFolderBranchRows(folderKind, parentFolderID, depth)) {
      rows.push(row);
      if (row.systemFolderID && expanded.has(row.id)) {
        pushSystemFolderChildren(row.systemFolderID, depth + 1);
        continue;
      }
      if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID) continue;
      pushFolderBranch(folderKind, row.folderID, depth + 1);
    }
  };

  // Durable folders/items share sparse positions inside each parent folder.
  // Unplaced root entities use local view positions until a folder placement
  // row exists, because their order is personal UI state rather than graph data.
  for (const row of sortExplorerRowsByPosition([
    ...buildSystemFolderRows("", 0),
    ...buildFolderBranchRows("node", "", 0),
    ...buildFolderBranchRows("logic_gate", "", 0),
  ])) {
    rows.push(row);
    if (row.systemFolderID && expanded.has(row.id)) {
      pushSystemFolderChildren(row.systemFolderID, 1);
      continue;
    }
    if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID || !row.folderKind) continue;
    pushFolderBranch(row.folderKind, row.folderID, 1);
  }
  return rows;
}
