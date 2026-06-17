import { useMemo } from "react";
import type { NodeRecord } from "../node-map/shared";
import type { NodeRecord as LogicGateRecord } from "../logic-gate-map/shared";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import type { KanbanBoard } from "../kanban/shared";
import type { ProjectRecord } from "../project-management/projectManagementApi";
import type { CompanyExplorerV2Row } from "./companyExplorerLazyApi";
import { buildCompanyExplorerTreeRows, buildCompanyExplorerV2TreeRows } from "./companyExplorerTreeRows";
import type { ExplorerTreeNode } from "./companyExplorerTypes";
import { useCompanyExplorerVirtualTree } from "./useCompanyExplorerVirtualTree";

type UseCompanyExplorerTreeModelInput = {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  projects: ProjectRecord[];
  kanbanBoards: KanbanBoard[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rows?: CompanyExplorerV2Row[];
  rootRowOrder: Record<string, number>;
  selectedTreeID: string;
  treeViewportHeight: number;
  treeScrollTop: number;
};

export function useCompanyExplorerTreeModel({
  expanded,
  nodes,
  logicGates,
  projects,
  kanbanBoards,
  folders,
  folderItems,
  rows = [],
  rootRowOrder,
  selectedTreeID,
  treeViewportHeight,
  treeScrollTop,
}: UseCompanyExplorerTreeModelInput) {
  const treeRows = useMemo<ExplorerTreeNode[]>(
    () => (rows.length > 0
      ? buildCompanyExplorerV2TreeRows({ expanded, rows })
      : buildCompanyExplorerTreeRows({ expanded, nodes, logicGates, projects, kanbanBoards, folders, folderItems, rootRowOrder })),
    [expanded, nodes, logicGates, projects, kanbanBoards, folders, folderItems, rootRowOrder, rows],
  );

  const selectedTree = useMemo(() => treeRows.find((row) => row.id === selectedTreeID), [selectedTreeID, treeRows]);
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
