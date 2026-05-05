import type React from "react";
import type { CompanyExplorerItemType } from "../folders/companyExplorerFolders";
import type { ExplorerEntityDragItem } from "../kanban/shared";
import { ExplorerRowIcon } from "./CompanyExplorerIcons";
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
  explorerSearchQuery: string;
  explorerSearchResults: ExplorerTreeNode[];
  explorerSearchOpen: boolean;
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
  onSetExplorerSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
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
  explorerSearchQuery,
  explorerSearchResults,
  explorerSearchOpen,
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
  onSetExplorerSearchFocused,
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
}) => (
  <div
    className="company-explorer-scroll"
    ref={treeViewportRef}
    tabIndex={0}
    onKeyDown={onTreeKeyDown}
    onScroll={(event) => onScrollTopChange((event.currentTarget as HTMLDivElement).scrollTop)}
    onDragOver={(event) => {
      if (!dragPayload) return;
      const viewport = event.currentTarget as HTMLDivElement;
      const bounds = viewport.getBoundingClientRect();
      const edgeSize = 42;
      const step = 18;
      const y = event.clientY - bounds.top;
      if (y < edgeSize) {
        const next = Math.max(0, viewport.scrollTop - step);
        if (next !== viewport.scrollTop) {
          viewport.scrollTop = next;
          onScrollTopChange(next);
        }
      } else if (y > bounds.height - edgeSize) {
        const next = Math.min(viewport.scrollHeight - bounds.height, viewport.scrollTop + step);
        if (next !== viewport.scrollTop) {
          viewport.scrollTop = next;
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
    style={{ overflowY: "auto", overflowX: "hidden", minWidth: 0, outline: "none", scrollbarGutter: "stable", ["--company-explorer-scroll-accent" as string]: scrollbarAccent, ["--company-explorer-scroll-track" as string]: scrollbarTrack }}
  >
    <div style={{ position: "sticky", top: 0, zIndex: 5, padding: "13px 10px 8px", borderBottom: `1px solid ${ruleColor}`, background: surfaceBackground, display: "grid", gap: 7 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Company Explorer</div>
      <div data-frame-interactive="true" style={{ position: "relative", display: "block", minWidth: 0, height: 25 }}>
        <input
          aria-label="Search Company Explorer"
          value={explorerSearchQuery}
          onFocus={() => onSetExplorerSearchFocused(true)}
          onBlur={() => window.setTimeout(() => onSetExplorerSearchFocused(false), 120)}
          onChange={(event) => onSetExplorerSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onSetExplorerSearchQuery("");
              onSetExplorerSearchFocused(false);
              event.currentTarget.blur();
            }
            if (event.key === "Enter" && explorerSearchResults[0]) {
              event.preventDefault();
              onSelectExplorerSearchResult(explorerSearchResults[0]);
            }
          }}
          placeholder="Search Company Explorer"
          style={{ width: "100%", height: "100%", boxSizing: "border-box", border: `1px solid ${ruleColor}`, background: isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.94)", color: surfaceText, fontSize: 11, fontWeight: 700, padding: "0 28px 0 8px", outline: "none" }}
        />
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ position: "absolute", right: 8, top: 5, color: folderToggleColor, pointerEvents: "none" }}>
          <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {explorerSearchOpen && (
          <section style={{ position: "absolute", top: 29, left: 0, right: 0, maxHeight: 260, overflowY: "auto", border: `1px solid ${ruleColor}`, borderRadius: 8, background: surfaceBackground, boxShadow: isDarkTheme ? "0 12px 28px rgba(0,0,0,0.42)" : "0 6px 20px rgba(0,0,0,0.14)", padding: "4px 0", zIndex: 8 }}>
            {explorerSearchResults.length === 0 ? (
              <div style={{ padding: "8px 10px", color: folderToggleColor, fontSize: 11, fontWeight: 700 }}>No matches</div>
            ) : explorerSearchResults.map((row) => (
              <button
                key={row.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectExplorerSearchResult(row)}
                style={{ width: "100%", minHeight: 30, display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto", alignItems: "center", gap: 7, border: "none", background: row.id === selectedTreeID ? selectedRowBackground : "transparent", color: surfaceText, cursor: "pointer", padding: "5px 9px", textAlign: "left" }}
              >
                <ExplorerRowIcon kind={row.kind} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700 }}>{row.label}</span>
                <span style={{ color: folderToggleColor, fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{row.kind === "logic_gate" ? "Logic" : row.kind}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
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
