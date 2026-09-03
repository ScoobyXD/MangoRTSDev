import { useMemo } from "react";
import type { NodeRecord } from "../nodes/types";
import type { LogicGateViewRecord as LogicGateRecord } from "../logic-gates/types";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
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
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rows?: CompanyExplorerV2Row[];
  useV2Rows?: boolean;
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
  folders,
  folderItems,
  rows = [],
  useV2Rows = rows.length > 0,
  rootRowOrder,
  selectedTreeID,
  treeViewportHeight,
  treeScrollTop,
}: UseCompanyExplorerTreeModelInput) {
  const treeRows = useMemo<ExplorerTreeNode[]>(
    () => (useV2Rows
      ? buildCompanyExplorerV2TreeRows({ expanded, rows })
      : buildCompanyExplorerTreeRows({ expanded, nodes, logicGates, projects, folders, folderItems, rootRowOrder })),
    [expanded, nodes, logicGates, projects, folders, folderItems, rootRowOrder, rows, useV2Rows],
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
    virtualizedTree,
  };
}
