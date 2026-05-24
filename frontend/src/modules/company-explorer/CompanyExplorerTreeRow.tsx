import React from "react";
import type { CompanyExplorerItemType } from "../folders/companyExplorerFolders";
import {
  attachStackedDragPreview,
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
  serializeExplorerEntityDragPayload,
  type ExplorerEntityDragItem,
} from "../kanban/shared";
import type { SelectionIntent } from "../selectionCoordinator";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "./CompanyExplorerIcons";
import {
  EXPLORER_DRAG_MIME,
  getExplorerDragPayloadForSelection,
  getExplorerDropIntent,
  getExplorerRowReorderPlacement,
  readExplorerDragPayload,
  TREE_BASE_LEFT_PX,
  TREE_INDENT_PX,
  TREE_TOGGLE_SLOT_PX,
} from "./companyExplorerDragDrop";
import type {
  ExplorerDragPayload,
  ExplorerRenameDraft,
  ExplorerRowDropPlacement,
  ExplorerTreeNode,
} from "./companyExplorerTypes";
import { COMPANY_EXPLORER_TREE_ROW_HEIGHT } from "./useCompanyExplorerVirtualTree";
import {
  getExplorerDropPayloadItemType,
  resolveExplorerDropTarget,
  resolveExplorerRootDropTarget,
} from "./treePresentation";

type CompanyExplorerTreeRowProps = {
  row: ExplorerTreeNode;
  treeRows: ExplorerTreeNode[];
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
  accent: string;
  surfaceBackground: string;
  surfaceText: string;
  rowIconColor: string;
  dropRowBackground: string;
  selectedRowBackground: string;
  rowRuleColor: string;
  folderToggleColor: string;
  isDarkTheme: boolean;
  isSearchActive: boolean;
  onSelectTreeRow: (row: ExplorerTreeNode, event?: React.MouseEvent, options?: { selectionIntent?: SelectionIntent }) => void;
  onOpenContextMenu: (event: React.MouseEvent, row?: ExplorerTreeNode | null) => void;
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

export const CompanyExplorerTreeRow: React.FC<CompanyExplorerTreeRowProps> = ({
  row,
  treeRows,
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
  accent,
  surfaceBackground,
  surfaceText,
  rowIconColor,
  dropRowBackground,
  selectedRowBackground,
  rowRuleColor,
  folderToggleColor,
  isDarkTheme,
  isSearchActive,
  onSelectTreeRow,
  onOpenContextMenu,
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
  const isFolder = row.kind === "folder";
  const isOpen = expanded.has(row.id);
  const isSelected = selectedTreeID === row.id || selectedTreeIDs.has(row.id);
  const suppressModifiedClickRef = React.useRef(false);
  const rowDragPayload = isSearchActive ? null : getExplorerDragPayloadForSelection(row, selectedTreeIDs, treeRows);
  const isDragging = draggingTreeID === row.id;
  const isDropTarget = dragOverTreeID === row.id;
  const rowFrameGradient = "linear-gradient(135deg, rgba(92, 238, 255, 0.92), rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86))";
  const selectedFrameSurface = isDarkTheme
    ? "linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.78) 46%, rgba(58, 44, 92, 0.72))"
    : "linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(228, 251, 255, 0.64) 46%, rgba(247, 240, 255, 0.72))";
  const rowBackground = isDropTarget
    ? dropRowBackground
    : isSelected
      ? `${selectedFrameSurface} padding-box, ${rowFrameGradient} border-box`
      : undefined;
  const rowBoxShadow = isDropTarget && dragOverPlacement
    ? (dragOverPlacement === "before" ? `inset 0 2px 0 ${accent}` : `inset 0 -2px 0 ${accent}`)
    : isSelected
      ? "0 0 0 1px rgba(120, 224, 255, 0.16), 0 0 14px rgba(183, 124, 255, 0.22), inset 1px 1px 0 rgba(255, 255, 255, 0.82)"
      : `inset 0 -1px 0 ${rowRuleColor}`;

  return (
    <div
      className="company-explorer-row"
      data-company-explorer-row-id={row.id}
      draggable={!isSearchActive && !!rowDragPayload && renaming?.treeID !== row.id}
      onMouseDown={(event) => {
        if (event.button !== 0 || renaming?.treeID === row.id) return;
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return;
        suppressModifiedClickRef.current = true;
        onSelectTreeRow(row, event, { selectionIntent: "navigate" });
      }}
      onClick={(event) => {
        if (suppressModifiedClickRef.current) {
          suppressModifiedClickRef.current = false;
          return;
        }
        onSelectTreeRow(row, event);
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      onDragStart={(event) => {
        if (!rowDragPayload) {
          event.preventDefault();
          return;
        }
        const kanbanDragItems = getKanbanDragItemsForRow(row);
        const explorerDragRows = getExplorerItemRowsForPayload(rowDragPayload);
        if (!selectedTreeIDs.has(row.id)) onSelectTreeRow(row, undefined, { selectionIntent: "navigate" });
        onSetDraggingTreeID(row.id);
        onSetDragPayload(rowDragPayload);
        event.dataTransfer.effectAllowed = row.kind === "folder" ? "move" : "copyMove";
        const serialized = JSON.stringify(rowDragPayload);
        event.dataTransfer.setData(EXPLORER_DRAG_MIME, serialized);
        if (kanbanDragItems.length > 0) {
          const kanbanPayload = serializeExplorerEntityDragPayload(kanbanDragItems.length === 1
            ? { itemType: "node", nodeID: kanbanDragItems[0].nodeID, label: kanbanDragItems[0].label }
            : { itemType: "node_batch", nodes: kanbanDragItems });
          event.dataTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, kanbanPayload);
          attachStackedDragPreview(
            event.dataTransfer,
            kanbanDragItems.map((item) => ({ label: item.label, color: rowIconColor })),
            KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
            "Explorer nodes",
          );
        } else if (explorerDragRows.length > 1) {
          attachStackedDragPreview(
            event.dataTransfer,
            explorerDragRows.map((item) => ({ label: item.label, color: rowIconColor })),
            rowIconColor,
            row.kind === "logic_gate" ? "Explorer logic gates" : "Explorer items",
          );
        }
        event.dataTransfer.setData("text/plain", kanbanDragItems.length > 1 ? `${kanbanDragItems.length} nodes` : row.label);
      }}
      onDragEnd={() => {
        onSetDraggingTreeID("");
        onSetDragOverTreeID("");
        onSetDragOverPlacement(null);
        onSetDragPayload(null);
      }}
      onDragOver={(event) => {
        const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
        const sourceRow = treeRows.find((item) => item.id === draggingTreeID);
        const placement = row.kind === "folder" ? getExplorerDropIntent(event) : getExplorerRowReorderPlacement(event);
        const isDraggedItemRow = payload?.kind !== "folder" && getExplorerItemRowsForPayload(payload).some((item) => item.id === row.id);
        if (isDraggedItemRow) return;
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && sourceRow.id !== row.id && getReorderRowsForTarget(sourceRow, row).length > 0) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(placement);
          return;
        }
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && canPlaceExplorerFolderAtTarget(sourceRow, row)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(placement);
          return;
        }
        if (payload?.kind !== "folder" && placement !== "inside" && canPlaceExplorerItemsAtTarget(payload, row)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(placement);
          return;
        }
        const dropTarget = resolveExplorerDropTarget(row, payload) ?? resolveExplorerRootDropTarget(row, payload);
        if (!dropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onSetDragOverTreeID(row.id);
        onSetDragOverPlacement(null);
      }}
      onDragLeave={() => {
        onSetDragOverTreeID((current) => (current === row.id ? "" : current));
        onSetDragOverPlacement(null);
      }}
      onDrop={(event) => {
        const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
        const sourceRow = treeRows.find((item) => item.id === draggingTreeID);
        const placement = dragOverPlacement ?? (row.kind === "folder" ? getExplorerDropIntent(event) : getExplorerRowReorderPlacement(event));
        const dropTarget = resolveExplorerDropTarget(row, payload) ?? resolveExplorerRootDropTarget(row, payload);
        const isDraggedItemRow = payload?.kind !== "folder" && getExplorerItemRowsForPayload(payload).some((item) => item.id === row.id);
        onSetDragOverTreeID("");
        onSetDragOverPlacement(null);
        if (isDraggedItemRow) return;
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && sourceRow.id !== row.id && getReorderRowsForTarget(sourceRow, row).length > 0) {
          event.preventDefault();
          void reorderExplorerRows(sourceRow, row, placement);
          return;
        }
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && canPlaceExplorerFolderAtTarget(sourceRow, row)) {
          event.preventDefault();
          void placeExplorerFolderAtTarget(sourceRow, row, placement);
          return;
        }
        if (payload?.kind !== "folder" && placement !== "inside" && canPlaceExplorerItemsAtTarget(payload, row)) {
          event.preventDefault();
          void placeExplorerItemsAtTarget(payload, row, placement);
          return;
        }
        if (!dropTarget || !payload) return;
        event.preventDefault();
        if (payload.kind === "folder" && payload.folderID) {
          void moveFolder(payload.folderID, dropTarget.folderID, { targetExpanded: expanded.has(dropTarget.treeID) });
          return;
        }
        void assignExplorerPayloadItemsToFolder(dropTarget.folderID, getExplorerDropPayloadItemType(payload) ?? dropTarget.folderKind, payload);
      }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 6,
        minHeight: COMPANY_EXPLORER_TREE_ROW_HEIGHT,
        padding: "4px 8px",
        paddingLeft: TREE_BASE_LEFT_PX + row.depth * TREE_INDENT_PX,
        fontSize: 12,
        cursor: "default",
        opacity: isDragging ? 0.55 : 1,
        ["--company-explorer-hover-bg" as string]: isDarkTheme ? "rgba(255,255,255,0.07)" : "rgba(71, 85, 105, 0.12)",
        ["--company-explorer-selected-bg" as string]: selectedRowBackground,
        background: rowBackground,
        border: "1px solid transparent",
        borderRadius: 7,
        boxShadow: rowBoxShadow,
        transition: "background 120ms ease, box-shadow 140ms ease",
      }}
    >
      {isFolder && !isSearchActive ? (
        <button
          draggable={false}
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSetExpanded((previous) => {
              const next = new Set(previous);
              if (next.has(row.id)) next.delete(row.id);
              else next.add(row.id);
              return next;
            });
          }}
          style={{ border: "none", background: "transparent", width: TREE_TOGGLE_SLOT_PX, height: 20, cursor: "pointer", color: folderToggleColor, display: "grid", placeItems: "center", padding: 0, flexShrink: 0 }}
        >
          <ExplorerDisclosureIcon open={isOpen} color={folderToggleColor} />
        </button>
      ) : <span style={{ width: TREE_TOGGLE_SLOT_PX, flexShrink: 0 }} />}
      <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
      {renaming?.treeID === row.id ? (
        <input
          ref={renameInputRef}
          value={renaming.value}
          onChange={(event) => onSetRenaming((current) => (current ? { ...current, value: event.target.value } : current))}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (renaming) void onCommitRename({ ...renaming, value: event.currentTarget.value });
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelRenameOnBlurRef.current = true;
              onSetRenaming(null);
            }
          }}
          onBlur={(event) => {
            if (cancelRenameOnBlurRef.current) {
              cancelRenameOnBlurRef.current = false;
              return;
            }
            if (renaming) void onCommitRename({ ...renaming, value: event.currentTarget.value });
          }}
          style={{
            minWidth: 0,
            width: "100%",
            border: `1px solid ${accent}`,
            background: surfaceBackground,
            color: surfaceText,
            font: "inherit",
            fontSize: 12,
            padding: "1px 4px",
            outline: "none",
          }}
        />
      ) : (
        <span
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartRenamingRow(row);
          }}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default", userSelect: "none" }}
        >
          {row.label}
        </span>
      )}
    </div>
  );
};
