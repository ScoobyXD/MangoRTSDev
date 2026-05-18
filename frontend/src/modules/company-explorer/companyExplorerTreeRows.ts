import { getNodeTitle, type NodeRecord } from "../node-map/shared.js";
import { getNodeTitle as getLogicGateTitle, type NodeRecord as LogicGateRecord } from "../logic-gate-map/shared.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem, CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";
import type { KanbanBoard } from "../kanban/shared.js";
import {
  formatExplorerFolderLabel,
  isExplorerSystemFolderKey,
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
  todayISODate?: string;
};

const ROOT_ROW_POSITION_OFFSET: Record<CompanyExplorerFolderKind, number> = {
  node: 0,
  logic_gate: 100_000_000,
};

function normalizeFolderName(value: string): string {
  return value.trim().toLowerCase();
}

export function findCompanyExplorerRootFolderByName(
  folders: CompanyExplorerFolder[],
  folderKind: CompanyExplorerFolderKind,
  name: string,
): CompanyExplorerFolder | null {
  const normalizedName = normalizeFolderName(name);
  if (!normalizedName) return null;
  return [...folders]
    .filter((folder) =>
      folder.folder_kind === folderKind
      && !folder.parent_folder_id
      && normalizeFolderName(folder.name) === normalizedName
    )
    .sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.folder_id.localeCompare(b.folder_id))[0] ?? null;
}

export function buildScopedCompanyExplorerTreeRows(rows: ExplorerTreeNode[], rootFolderID: string): ExplorerTreeNode[] {
  const rootTreeID = `workspace-folder-${rootFolderID.trim()}`;
  if (rootTreeID === "workspace-folder-") return rows;
  const rootIndex = rows.findIndex((row) => row.id === rootTreeID);
  if (rootIndex < 0) return [];
  const rootDepth = rows[rootIndex].depth;
  const scopedRows: ExplorerTreeNode[] = [];
  for (let index = rootIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.depth <= rootDepth) break;
    const depth = Math.max(0, row.depth - rootDepth - 1);
    scopedRows.push({ ...row, depth, scopeLevel: depth });
  }
  return scopedRows;
}

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
  todayISODate,
}: BuildCompanyExplorerTreeRowsInput): ExplorerTreeNode[] {
  void kanbanBoards;
  const rows: ExplorerTreeNode[] = [];
  const currentDate = normalizeISODate(todayISODate) || getLocalISODate();
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
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
  for (const folder of folders) {
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

  const getRootAwarePosition = (folderKind: CompanyExplorerFolderKind, rowID: string, position: number): number => {
    return rootRowOrder[rowID] ?? position + ROOT_ROW_POSITION_OFFSET[folderKind];
  };

  const buildFolderBranchRows = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number): ExplorerTreeNode[] => {
    const directItems = itemsByFolder.get(parentFolderID) ?? [];
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
      }
    }

    const childFolders = foldersByParent.get(`${folderKind}:${parentFolderID}`) ?? [];
    for (const folder of childFolders) {
      if (folder.system_key === "kanban_boards") continue;
      const rowID = `workspace-folder-${folder.folder_id}`;
      branchRows.push({
        id: rowID,
        label: formatExplorerFolderLabel(folder.name),
        depth,
        kind: "folder",
        folderID: folder.folder_id,
        parentFolderID: folder.parent_folder_id ?? "",
        folderKind,
        systemKey: isExplorerSystemFolderKey(folder.system_key) ? folder.system_key : undefined,
        folderLabel: getFolderPathLabel(folder.folder_id),
        scopeLevel: depth,
        position: parentFolderID === "" ? getRootAwarePosition(folderKind, rowID, folder.position || TREE_ROW_POSITION_STEP) : folder.position || TREE_ROW_POSITION_STEP,
        createdTimestamp: folder.created_timestamp,
      });
    }

    return sortExplorerRowsByPosition(branchRows);
  };

  const buildSystemFolderContentRows = (systemKey: string | undefined, depth: number): ExplorerTreeNode[] => {
    const contentRows: ExplorerTreeNode[] = [];
    if (systemKey === "history") {
      let historyPosition = 0;
      for (const node of nodes) {
        const dueDate = normalizeISODate(node.due_date);
        if (!dueDate || dueDate >= currentDate) continue;
        historyPosition += TREE_ROW_POSITION_STEP;
        contentRows.push({
          id: `system-history-node-${node.node_id}`,
          label: getNodeTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          scopeLevel: depth,
          position: historyPosition,
          createdTimestamp: node.created_timestamp,
        });
      }
    }
    return contentRows;
  };

  const pushFolderBranch = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number) => {
    for (const row of buildFolderBranchRows(folderKind, parentFolderID, depth)) {
      rows.push(row);
      if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID) continue;
      for (const systemRow of buildSystemFolderContentRows(row.systemKey, depth + 1)) rows.push(systemRow);
      pushFolderBranch(folderKind, row.folderID, depth + 1);
    }
  };

  // Durable folders/items share sparse positions inside each parent folder.
  // Unplaced root entities use local view positions until a folder placement
  // row exists, because their order is personal UI state rather than graph data.
  for (const row of sortExplorerRowsByPosition([
    ...buildFolderBranchRows("node", "", 0),
    ...buildFolderBranchRows("logic_gate", "", 0),
  ])) {
    rows.push(row);
    if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID || !row.folderKind) continue;
    for (const systemRow of buildSystemFolderContentRows(row.systemKey, 1)) rows.push(systemRow);
    pushFolderBranch(row.folderKind, row.folderID, 1);
  }
  return rows;
}
