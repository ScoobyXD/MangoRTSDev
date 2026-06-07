import type React from "react";
import type { CompanyExplorerItemType } from "../folders/companyExplorerFolders";
import type { ExplorerEntityDragItem } from "../kanban/shared";
import { CompanyExplorerTreeRow } from "./CompanyExplorerTreeRow";
import type {
  ExplorerDragPayload,
  ExplorerRenameDraft,
  ExplorerRowDropPlacement,
  ExplorerTreeNode,
  ExplorerVirtualizedTree,
} from "./companyExplorerTypes";

type CompanyExplorerTreeProps = {
  error: string;
  accent: string;
  surfaceBackground: string;
  surfaceText: string;
  rowIconColor: string;
  dropRowBackground: string;
  selectedRowBackground: string;
  rowRuleColor: string;
  ruleColor: string;
  folderToggleColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  isDarkTheme: boolean;
  elevatedControls?: boolean;
  topControlsAccessory?: React.ReactNode;
  hideTopControls: boolean;
  useParentScroll: boolean;
  treeViewportRef: React.RefObject<HTMLDivElement>;
  treeKeyboardActiveRef: React.MutableRefObject<boolean>;
  treeRows: ExplorerTreeNode[];
  virtualizedTree: ExplorerVirtualizedTree;
  expanded: Set<string>;
  selectedTreeID: string;
  selectedTreeIDs: Set<string>;
  explorerSearchQuery: string;
  explorerSearchActive: boolean;
  explorerSearchResult: ExplorerTreeNode | null;
  draggingTreeID: string;
  dragOverTreeID: string;
  dragOverPlacement: ExplorerRowDropPlacement | null;
  dragPayload: ExplorerDragPayload | null;
  renaming: ExplorerRenameDraft | null;
  renameInputRef: React.RefObject<HTMLInputElement>;
  cancelRenameOnBlurRef: React.MutableRefObject<boolean>;
  onTreeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onScrollTopChange: (scrollTop: number) => void;
  onCloseContextMenu: () => void;
  onOpenContextMenu: (event: React.MouseEvent, row?: ExplorerTreeNode | null) => void;
  onSetExplorerSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onSelectExplorerSearchResult: (row: ExplorerTreeNode) => void;
  onSelectTreeRow: (row: ExplorerTreeNode, event?: React.MouseEvent, options?: { selectionIntent?: "activate" | "navigate" }) => void;
  onStartRenamingRow: (row: ExplorerTreeNode) => void;
  onCommitRename: (draft?: ExplorerRenameDraft) => Promise<void>;
  onSetRenaming: React.Dispatch<React.SetStateAction<ExplorerRenameDraft | null>>;
  onSetExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetDraggingTreeID: React.Dispatch<React.SetStateAction<string>>;
  onSetDragOverTreeID: React.Dispatch<React.SetStateAction<string>>;
  onSetDragOverPlacement: React.Dispatch<React.SetStateAction<ExplorerRowDropPlacement | null>>;
  onSetDragPayload: React.Dispatch<React.SetStateAction<ExplorerDragPayload | null>>;
  getKanbanDragItemsForRow: (row: ExplorerTreeNode) => ExplorerEntityDragItem[];
  getExplorerItemRowsForPayload: (payload: ExplorerDragPayload | null) => ExplorerTreeNode[];
  getReorderRowsForTarget: (source: ExplorerTreeNode, target: ExplorerTreeNode) => ExplorerTreeNode[];
  canPlaceExplorerFolderAtTarget: (source: ExplorerTreeNode | undefined, target: ExplorerTreeNode) => boolean;
  canPlaceExplorerItemsAtTarget: (payload: ExplorerDragPayload | null, target: ExplorerTreeNode) => boolean;
  reorderExplorerRows: (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => Promise<boolean>;
  placeExplorerFolderAtTarget: (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => Promise<boolean>;
  placeExplorerItemsAtTarget: (payload: ExplorerDragPayload | null, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => Promise<boolean>;
  moveFolder: (folderID: string, parentFolderID: string | undefined, options?: { position?: number; expandTarget?: boolean; parentProvided?: boolean; targetExpanded?: boolean }) => Promise<void>;
  assignExplorerPayloadItemsToFolder: (targetFolderID: string, itemType: CompanyExplorerItemType, payload: ExplorerDragPayload) => Promise<void>;
};

function findScrollableAncestor(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return element;
}

export const CompanyExplorerTree: React.FC<CompanyExplorerTreeProps> = ({
  error,
  accent,
  surfaceBackground,
  surfaceText,
  rowIconColor,
  dropRowBackground,
  selectedRowBackground,
  rowRuleColor,
  ruleColor,
  folderToggleColor,
  scrollbarAccent,
  scrollbarTrack,
  isDarkTheme,
  elevatedControls = false,
  topControlsAccessory,
  hideTopControls,
  useParentScroll,
  treeViewportRef,
  treeKeyboardActiveRef,
  treeRows,
  virtualizedTree,
  expanded,
  selectedTreeID,
  selectedTreeIDs,
  explorerSearchQuery,
  explorerSearchActive,
  explorerSearchResult,
  draggingTreeID,
  dragOverTreeID,
  dragOverPlacement,
  dragPayload,
  renaming,
  renameInputRef,
  cancelRenameOnBlurRef,
  onTreeKeyDown,
  onScrollTopChange,
  onCloseContextMenu,
  onOpenContextMenu,
  onSetExplorerSearchQuery,
  onSelectExplorerSearchResult,
  onSelectTreeRow,
  onStartRenamingRow,
  onCommitRename,
  onSetRenaming,
  onSetExpanded,
  onSetDraggingTreeID,
  onSetDragOverTreeID,
  onSetDragOverPlacement,
  onSetDragPayload,
  getKanbanDragItemsForRow,
  getExplorerItemRowsForPayload,
  getReorderRowsForTarget,
  canPlaceExplorerFolderAtTarget,
  canPlaceExplorerItemsAtTarget,
  reorderExplorerRows,
  placeExplorerFolderAtTarget,
  placeExplorerItemsAtTarget,
  moveFolder,
  assignExplorerPayloadItemsToFolder,
}) => {
  const handleRowSelection = (row: ExplorerTreeNode, event?: React.MouseEvent, options?: { selectionIntent?: "activate" | "navigate" }) => {
    if (explorerSearchActive) {
      onSelectExplorerSearchResult(row);
      return;
    }
    onSelectTreeRow(row, event, options);
  };
  const topControlsStyle: React.CSSProperties = elevatedControls
    ? {
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "grid",
        gap: 8,
        padding: "9px 9px 10px",
        borderBottom: "1px solid rgba(255, 255, 255, 0.58)",
        background: "linear-gradient(180deg, rgba(248, 250, 252, 0.92) 0%, rgba(242, 244, 248, 0.72) 100%)",
        backdropFilter: "blur(14px) saturate(1.08)",
        WebkitBackdropFilter: "blur(14px) saturate(1.08)",
      }
    : {
        position: "sticky",
        top: 0,
        zIndex: 5,
        padding: "13px 10px 8px",
        borderBottom: `1px solid ${ruleColor}`,
        background: surfaceBackground,
        display: "grid",
        gap: 7,
      };
  const titleStyle: React.CSSProperties = elevatedControls
    ? {
        minHeight: 30,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        border: "1px solid rgba(255, 255, 255, 0.78)",
        borderRadius: 9,
        background: "linear-gradient(145deg, rgba(255, 255, 255, 0.94) 0%, rgba(246, 247, 251, 0.9) 100%)",
        color: "#111111",
        boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.22), -5px -5px 12px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
        fontSize: 11.5,
        fontWeight: 760,
        letterSpacing: 0,
      }
    : {
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: 0,
        color: accent,
      };
  const searchShellStyle: React.CSSProperties = elevatedControls
    ? {
        position: "relative",
        display: "block",
        minWidth: 0,
        height: 32,
        border: "1px solid rgba(255, 255, 255, 0.78)",
        borderRadius: 9,
        background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(246, 247, 251, 0.92) 100%)",
        boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.22), -5px -5px 12px rgba(255, 255, 255, 0.9), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
      }
    : {
        position: "relative",
        display: "block",
        minWidth: 0,
        height: 25,
      };
  const searchInputStyle: React.CSSProperties = elevatedControls
    ? {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: "none",
        borderRadius: 9,
        background: "transparent",
        color: surfaceText,
        fontSize: 11,
        fontWeight: 560,
        padding: "0 30px 0 10px",
        outline: "none",
      }
    : {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: `1px solid ${ruleColor}`,
        background: isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.94)",
        color: surfaceText,
        fontSize: 11,
        fontWeight: 500,
        padding: "0 28px 0 8px",
        outline: "none",
      };
  const searchIconStyle: React.CSSProperties = {
    position: "absolute",
    right: elevatedControls ? 9 : 8,
    top: elevatedControls ? 9 : 5,
    color: folderToggleColor,
    pointerEvents: "none",
  };

  return (
    <div
      className="company-explorer-scroll"
      ref={treeViewportRef}
      tabIndex={0}
      onKeyDown={onTreeKeyDown}
      onScroll={(event) => {
        if (!useParentScroll) onScrollTopChange((event.currentTarget as HTMLDivElement).scrollTop);
      }}
      onDragOver={(event) => {
        if (!dragPayload) return;
        const viewport = event.currentTarget as HTMLDivElement;
        const scrollTarget = useParentScroll ? findScrollableAncestor(viewport) : viewport;
        const bounds = scrollTarget.getBoundingClientRect();
        const edgeSize = 42;
        const step = 18;
        const y = event.clientY - bounds.top;
        if (y < edgeSize) {
          const next = Math.max(0, scrollTarget.scrollTop - step);
          if (next !== scrollTarget.scrollTop) {
            scrollTarget.scrollTop = next;
            onScrollTopChange(next);
          }
        } else if (y > bounds.height - edgeSize) {
          const next = Math.min(scrollTarget.scrollHeight - bounds.height, scrollTarget.scrollTop + step);
          if (next !== scrollTarget.scrollTop) {
            scrollTarget.scrollTop = next;
            onScrollTopChange(next);
          }
        }
      }}
      onMouseEnter={() => {
        treeKeyboardActiveRef.current = true;
      }}
      onMouseDownCapture={(event) => {
        treeKeyboardActiveRef.current = true;
        treeViewportRef.current?.focus({ preventScroll: true });
        if (event.button === 0) onCloseContextMenu();
      }}
      onContextMenu={(event) => onOpenContextMenu(event)}
      style={{
        overflowY: useParentScroll ? "visible" : "auto",
        overflowX: useParentScroll ? "visible" : "hidden",
        minWidth: 0,
        outline: "none",
        scrollbarGutter: useParentScroll ? undefined : "stable",
        ["--company-explorer-scroll-accent" as string]: scrollbarAccent,
        ["--company-explorer-scroll-track" as string]: scrollbarTrack,
      }}
    >
      {!hideTopControls && (
        <div style={topControlsStyle}>
          <div style={titleStyle}>Explorer</div>
          {topControlsAccessory}
          <div data-frame-interactive="true" style={searchShellStyle}>
            <input
              aria-label="Search Explorer"
              value={explorerSearchQuery}
              onChange={(event) => onSetExplorerSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onSetExplorerSearchQuery("");
                  event.currentTarget.blur();
                }
                if (event.key === "Enter" && explorerSearchResult) {
                  event.preventDefault();
                  onSelectExplorerSearchResult(explorerSearchResult);
                }
              }}
              placeholder="Search Explorer"
              style={searchInputStyle}
            />
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={searchIconStyle}>
              <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}
      {error && <div style={{ padding: "7px 10px", borderBottom: `1px solid ${ruleColor}`, color: "#b00020", fontSize: 11, fontWeight: 700 }}>Error: {error}</div>}
      {explorerSearchActive && treeRows.length === 0 && (
        <div style={{ padding: "10px", borderBottom: `1px solid ${rowRuleColor}`, color: folderToggleColor, fontSize: 11, fontWeight: 700 }}>No matches</div>
      )}
      <div data-company-explorer-tree-rows-start="true" style={{ height: virtualizedTree.topSpacer }} />
      {virtualizedTree.rows.map((row) => (
        <CompanyExplorerTreeRow
          key={row.id}
          row={row}
          treeRows={treeRows}
          expanded={expanded}
          selectedTreeID={selectedTreeID}
          selectedTreeIDs={selectedTreeIDs}
          draggingTreeID={draggingTreeID}
          dragOverTreeID={dragOverTreeID}
          dragOverPlacement={dragOverPlacement}
          dragPayload={dragPayload}
          renaming={renaming}
          renameInputRef={renameInputRef}
          cancelRenameOnBlurRef={cancelRenameOnBlurRef}
          accent={accent}
          surfaceBackground={surfaceBackground}
          surfaceText={surfaceText}
          rowIconColor={rowIconColor}
          dropRowBackground={dropRowBackground}
          selectedRowBackground={selectedRowBackground}
          rowRuleColor={rowRuleColor}
          folderToggleColor={folderToggleColor}
          isDarkTheme={isDarkTheme}
          isSearchActive={explorerSearchActive}
          onSelectTreeRow={handleRowSelection}
          onOpenContextMenu={onOpenContextMenu}
          onStartRenamingRow={onStartRenamingRow}
          onCommitRename={onCommitRename}
          onSetRenaming={onSetRenaming}
          onSetExpanded={onSetExpanded}
          onSetDraggingTreeID={onSetDraggingTreeID}
          onSetDragOverTreeID={onSetDragOverTreeID}
          onSetDragOverPlacement={onSetDragOverPlacement}
          onSetDragPayload={onSetDragPayload}
          getKanbanDragItemsForRow={getKanbanDragItemsForRow}
          getExplorerItemRowsForPayload={getExplorerItemRowsForPayload}
          getReorderRowsForTarget={getReorderRowsForTarget}
          canPlaceExplorerFolderAtTarget={canPlaceExplorerFolderAtTarget}
          canPlaceExplorerItemsAtTarget={canPlaceExplorerItemsAtTarget}
          reorderExplorerRows={reorderExplorerRows}
          placeExplorerFolderAtTarget={placeExplorerFolderAtTarget}
          placeExplorerItemsAtTarget={placeExplorerItemsAtTarget}
          moveFolder={moveFolder}
          assignExplorerPayloadItemsToFolder={assignExplorerPayloadItemsToFolder}
        />
      ))}
      <div style={{ height: virtualizedTree.bottomSpacer }} />
    </div>
  );
};
