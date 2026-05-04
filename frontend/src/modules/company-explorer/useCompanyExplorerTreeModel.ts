import { useMemo } from "react";
import type { NodeRecord } from "../node-map/shared";
import type { NodeRecord as LogicGateRecord } from "../logic-gate-map/shared";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import type { KanbanBoard } from "../kanban/shared";
import { buildCompanyExplorerTreeRows } from "./companyExplorerTreeRows";
import type { ExplorerTreeNode } from "./companyExplorerTypes";
import { useCompanyExplorerVirtualTree } from "./useCompanyExplorerVirtualTree";

type UseCompanyExplorerTreeModelInput = {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  kanbanBoards: KanbanBoard[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rootRowOrder: Record<string, number>;
  selectedTreeID: string;
  treeViewportHeight: number;
  treeScrollTop: number;
};

export function useCompanyExplorerTreeModel({
  expanded,
  nodes,
  logicGates,
  kanbanBoards,
  folders,
  folderItems,
  rootRowOrder,
  selectedTreeID,
  treeViewportHeight,
  treeScrollTop,
}: UseCompanyExplorerTreeModelInput) {
  const treeRows = useMemo<ExplorerTreeNode[]>(
    () => buildCompanyExplorerTreeRows({ expanded, nodes, logicGates, kanbanBoards, folders, folderItems, rootRowOrder }),
    [expanded, nodes, logicGates, kanbanBoards, folders, folderItems, rootRowOrder],
  );

  const selectedTree = useMemo(() => treeRows.find((row) => row.id === selectedTreeID) ?? treeRows[0], [selectedTreeID, treeRows]);
  const rowByID = useMemo(() => new Map(treeRows.map((row) => [row.id, row])), [treeRows]);
  const virtualizedTree = useCompanyExplorerVirtualTree(treeRows, treeViewportHeight, treeScrollTop);

  return {
    treeRows,
    selectedTree,
    rowByID,
    selectedFolderKind: selectedTree?.folderKind,
    selectedFolderID: selectedTree?.folderID ?? "",
    selectedFolderLabel: selectedTree?.folderLabel ?? (selectedTree?.folderKind ? selectedTree.label : ""),
    selectedKanbanBoardLabel: selectedTree?.kind === "kanban" ? selectedTree.label : "",
    virtualizedTree,
  };
}
