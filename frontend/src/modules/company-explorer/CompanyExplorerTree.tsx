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
  treeViewportRef: React.RefObject<HTMLDivElement>;
  treeKeyboardActiveRef: React.MutableRefObject<boolean>;
  treeRows: ExplorerTreeNode[];
  virtualizedTree: ExplorerVirtualizedTree;
  expanded: Set<string>;
  selectedTreeID: string;
  selectedTreeIDs: Set<string>;
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
  treeViewportRef,
  treeKeyboardActiveRef,
  treeRows,
  virtualizedTree,
  expanded,
  selectedTreeID,
  selectedTreeIDs,
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
}) => (
  <div
    className="company-explorer-scroll"
    ref={treeViewportRef}
    tabIndex={0}
    onKeyDown={onTreeKeyDown}
    onScroll={(event) => onScrollTopChange((event.currentTarget as HTMLDivElement).scrollTop)}
    onMouseEnter={() => {
      treeKeyboardActiveRef.current = true;
    }}
    onMouseDownCapture={(event) => {
      treeKeyboardActiveRef.current = true;
      treeViewportRef.current?.focus({ preventScroll: true });
      if (event.button === 0) onCloseContextMenu();
    }}
    onContextMenu={(event) => onOpenContextMenu(event)}
    style={{ overflowY: "auto", overflowX: "hidden", minWidth: 0, outline: "none", scrollbarGutter: "stable", ["--company-explorer-scroll-accent" as string]: scrollbarAccent, ["--company-explorer-scroll-track" as string]: scrollbarTrack }}
  >
    <div style={{ padding: "9px 10px", borderBottom: `1px solid ${ruleColor}`, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Company Explorer</div>
    {error && <div style={{ padding: "7px 10px", borderBottom: `1px solid ${ruleColor}`, color: "#b00020", fontSize: 11, fontWeight: 700 }}>Error: {error}</div>}
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
        onSelectTreeRow={onSelectTreeRow}
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
