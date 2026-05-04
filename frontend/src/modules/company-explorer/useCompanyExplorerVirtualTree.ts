import { useMemo } from "react";
import type { ExplorerTreeNode, ExplorerVirtualizedTree } from "./companyExplorerTypes";

export const COMPANY_EXPLORER_TREE_ROW_HEIGHT = 30;
const TREE_OVERSCAN = 8;

export function useCompanyExplorerVirtualTree(
  treeRows: ExplorerTreeNode[],
  treeViewportHeight: number,
  treeScrollTop: number,
): ExplorerVirtualizedTree {
  return useMemo(() => {
    const total = treeRows.length;
    if (total === 0) return { rows: [], topSpacer: 0, bottomSpacer: 0 };
    const visibleCount = Math.max(1, Math.ceil(treeViewportHeight / COMPANY_EXPLORER_TREE_ROW_HEIGHT));
    const start = Math.max(0, Math.floor(treeScrollTop / COMPANY_EXPLORER_TREE_ROW_HEIGHT) - TREE_OVERSCAN);
    const end = Math.min(total, start + visibleCount + TREE_OVERSCAN * 2);
    const rows = treeRows.slice(start, end);
    return {
      rows,
      topSpacer: start * COMPANY_EXPLORER_TREE_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (total - end) * COMPANY_EXPLORER_TREE_ROW_HEIGHT),
    };
  }, [treeRows, treeViewportHeight, treeScrollTop]);
}
