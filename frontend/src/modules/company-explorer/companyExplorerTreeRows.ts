import { getNodeTitle, type NodeRecord } from "../node-map/shared.js";
import { getNodeTitle as getLogicGateTitle, type NodeRecord as LogicGateRecord } from "../logic-gate-map/shared.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem, CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";
import { getKanbanBoardDisplayTitle, type KanbanBoard } from "../kanban/shared.js";
import {
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
};

export function buildCompanyExplorerTreeRows({
  expanded,
  nodes,
  logicGates,
  kanbanBoards,
  folders,
  folderItems,
  rootRowOrder,
}: BuildCompanyExplorerTreeRowsInput): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
  const kanbanBoardByID = new Map(kanbanBoards.map((board) => [board.board_id, board]));
  const folderLabelByID = new Map(folders.map((folder) => [folder.folder_id, folder.name]));
  const assignedNodes = new Set(folderItems.filter((item) => item.item_type === "node").map((item) => item.item_id));
  const assignedLogicGates = new Set(folderItems.filter((item) => item.item_type === "logic_gate").map((item) => item.item_id));
  const assignedKanbanBoards = new Set(folderItems.filter((item) => item.item_type === "kanban").map((item) => item.item_id));
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

  const pushFolderBranch = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number) => {
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
          position: rootRowOrder[rowID] ?? syntheticRootPosition,
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
          position: rootRowOrder[rowID] ?? syntheticRootPosition,
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
            folderLabel: folderLabelByID.get(parentFolderID),
            scopeLevel: depth,
            position: item.position || TREE_ROW_POSITION_STEP,
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
            folderLabel: folderLabelByID.get(parentFolderID),
            scopeLevel: depth,
            position: item.position || TREE_ROW_POSITION_STEP,
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
            folderLabel: folderLabelByID.get(parentFolderID),
            scopeLevel: depth,
            position: item.position || TREE_ROW_POSITION_STEP,
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
        folderLabel: folder.name,
        scopeLevel: depth,
        position: folder.position || TREE_ROW_POSITION_STEP,
        createdTimestamp: folder.created_timestamp,
      });
    }

    for (const row of sortExplorerRowsByPosition(branchRows)) {
      rows.push(row);
      if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID) continue;
      pushFolderBranch(folderKind, row.folderID, depth + 1);
    }
  };

  // Durable folders/items share sparse positions inside each parent folder.
  // Unplaced root entities use local view positions until a folder placement
  // row exists, because their order is personal UI state rather than graph data.
  pushFolderBranch("node", "", 0);
  pushFolderBranch("logic_gate", "", 0);
  let syntheticBoardPosition = 0;
  for (const board of kanbanBoards) {
    if (assignedKanbanBoards.has(board.board_id)) continue;
    syntheticBoardPosition += TREE_ROW_POSITION_STEP;
    const rowID = `kanban-${board.board_id}`;
    rows.push({
      id: rowID,
      label: getKanbanBoardDisplayTitle(board),
      depth: 0,
      kind: "kanban",
      kanbanBoardID: board.board_id,
      folderID: "",
      scopeLevel: 1,
      position: rootRowOrder[rowID] ?? syntheticBoardPosition,
      createdTimestamp: board.created_timestamp,
    });
  }

  return rows;
}
